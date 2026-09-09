import { z } from 'zod';
import {
  WorkError,
  transition,
  validateExecution,
  executionReadiness,
  stepPredecessors,
} from '@statework/core';
import type { WorkState } from '@statework/core';
import {
  instructionsSchema,
  instructionCommandSchemas,
  workPacketSchema,
  workSourceSchema,
  workAssetSchema,
} from './instruction-schemas.js';

export const idSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
const title = z.string().trim().min(1).max(240);
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Use a real calendar date, YYYY-MM-DD.');
export const instantSchema = z.string().refine((s) => {
  const d = new Date(s);
  return Number.isFinite(d.getTime()) && d.toISOString() === s && s.length === 24;
}, 'Use a canonical UTC instant, YYYY-MM-DDTHH:mm:ss.sssZ.');
export const zoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((s) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: s });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown IANA time zone.');
export const scheduleSchema = z
  .strictObject({ start: instantSchema, end: instantSchema, timeZone: zoneSchema })
  .refine((s) => s.end > s.start, 'Schedule end must follow start.');
export const planOptionsSchema = z.strictObject({
  now: instantSchema,
  timeZone: zoneSchema,
  days: z.number().int().min(1).max(90).optional(),
  dailyMinutes: z.number().int().min(0).max(720).optional(),
  todayMinutes: z.number().int().min(0).max(720).optional(),
  workDays: z
    .array(z.number().int().min(0).max(6))
    .max(7)
    .refine((v) => new Set(v).size === v.length)
    .optional(),
  defaultMinutes: z.number().int().min(5).max(240).optional(),
  blockMinutes: z.number().int().min(5).max(240).optional(),
  notBefore: z
    .record(idSchema, dateSchema)
    .refine((v) => Object.keys(v).length <= 10000)
    .optional(),
  preferred: z
    .array(idSchema)
    .max(10000)
    .refine((v) => new Set(v).size === v.length)
    .optional(),
});
const planCount = z.number().int().nonnegative();
export const workPlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: idSchema,
  revision: planCount,
  generatedAt: instantSchema,
  timeZone: zoneSchema,
  today: dateSchema,
  days: z
    .array(
      z.strictObject({
        date: dateSchema,
        workDay: z.boolean(),
        capacityMinutes: planCount,
        loggedMinutes: planCount,
        plannedMinutes: planCount,
        freeMinutes: planCount,
        overlapMinutes: z.number().nonnegative(),
        suggestionLimitReached: z.boolean(),
        suggestions: z
          .array(
            z.strictObject({
              id: idSchema,
              minutes: z.number().int().positive(),
              order: z.number().int().positive(),
              reason: z.enum(['chosen', 'deadline', 'continue', 'priority', 'unlocks', 'ready']),
              estimated: z.boolean(),
              continuation: z.boolean(),
              conditional: z.boolean(),
              completesEstimate: z.boolean(),
              deadline: dateSchema.nullable(),
              late: z.boolean(),
            }),
          )
          .max(100),
        commitments: z.array(
          z.strictObject({
            id: idSchema,
            start: instantSchema,
            end: instantSchema,
            needsFirst: z.boolean(),
          }),
        ),
        deadlines: z.array(idSchema),
      }),
    )
    .min(1)
    .max(90),
  unplaced: z.array(
    z.strictObject({
      id: idSchema,
      remainingMinutes: planCount,
      reason: z.enum(['prerequisites', 'packet', 'later', 'capacity']),
    }),
  ),
  scheduleIssues: z.array(
    z.strictObject({
      id: idSchema,
      reason: z.enum(['past_slot', 'prerequisite_timing', 'packet']),
    }),
  ),
  counts: z.strictObject({
    openTasks: planCount,
    fixed: planCount,
    fullyProjected: planCount,
    partiallyProjected: planCount,
    unplaced: planCount,
  }),
});
const status = z.enum(['inbox', 'ready', 'active', 'done', 'cancelled']);
const kind = z.enum(['task', 'project', 'note', 'event']);
const extensionKey = z
  .string()
  .regex(/^[a-z][a-z0-9.-]*\/[a-zA-Z0-9._-]+$/)
  .max(120);
const extensions = z
  .record(extensionKey, z.json())
  .refine(
    (v) => Object.keys(v).length <= 30 && JSON.stringify(v).length <= 16384,
    'Extensions exceed the 16 KiB / 30 namespace limit.',
  );
const fields = {
  kind,
  title,
  description: z.string().max(20000),
  status,
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  tags: z
    .array(z.string().trim().min(1).max(60))
    .max(30)
    .refine((a) => new Set(a).size === a.length, 'Tags must be unique.'),
  effortMinutes: z.number().int().min(0).max(525600).nullable(),
  dueDate: dateSchema.nullable(),
  schedule: scheduleSchema.nullable(),
  extensions,
};
export const itemInputSchema = z
  .strictObject({ id: idSchema, ...fields })
  .partial()
  .required({ id: true, kind: true, title: true });
export const itemPatchSchema = z
  .strictObject(fields)
  .partial()
  .refine((v) => Object.values(v).some((value) => value !== undefined), 'Patch cannot be empty.');
export const querySchema = z.strictObject({
  text: z.string().max(500).optional(),
  statuses: z.array(status).max(5).optional(),
  kinds: z.array(kind).max(4).optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  parentId: idSchema.optional(),
  actionable: z.boolean().optional(),
  scheduled: z.boolean().optional(),
  archived: z.boolean().optional(),
  dueBefore: dateSchema.optional(),
  sort: z.enum(['priority', 'due', 'updated', 'title']).optional(),
});
export const relationSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(['depends_on', 'contains', 'relates_to']),
  from: idSchema,
  to: idSchema,
});
export const viewSchema = z.strictObject({
  id: idSchema,
  title,
  query: querySchema,
  renderer: z.string().regex(/^[a-z][a-z0-9._/-]{0,79}$/),
});
export const commandSchema = z.discriminatedUnion('type', [
  ...instructionCommandSchemas,
  z.strictObject({ type: z.literal('item.create'), item: itemInputSchema }),
  z.strictObject({
    type: z.literal('item.update'),
    id: idSchema,
    expectedVersion: z.number().int().min(1),
    patch: itemPatchSchema,
  }),
  z.strictObject({
    type: z.literal('item.archive'),
    id: idSchema,
    expectedVersion: z.number().int().min(1),
    archived: z.boolean(),
  }),
  z.strictObject({ type: z.literal('relation.add'), relation: relationSchema }),
  z.strictObject({ type: z.literal('relation.remove'), id: idSchema }),
  z.strictObject({ type: z.literal('view.save'), view: viewSchema }),
  z.strictObject({ type: z.literal('view.remove'), id: idSchema }),
  z.strictObject({ type: z.literal('workspace.rename'), title }),
]);
export const requestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requestId: idSchema,
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  commands: z.array(commandSchema).min(1).max(100),
});
export const createWorkspaceSchema = z.strictObject({ id: idSchema, title });
export const observeSchema = z.strictObject({
  query: querySchema.default({}),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(500).default(100),
});
export const workStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspace: z.strictObject({
    id: idSchema,
    title,
    revision: z.number().int().min(0),
    createdAt: instantSchema,
  }),
  items: z
    .array(
      z.strictObject({
        id: idSchema,
        ...fields,
        archived: z.boolean(),
        version: z.number().int().min(1),
        createdAt: instantSchema,
        updatedAt: instantSchema,
      }),
    )
    .max(10000),
  relations: z.array(relationSchema).max(30000),
  views: z.array(viewSchema).max(100),
  instructions: instructionsSchema.optional(),
});
export const domainEventSchema = z.strictObject({
  sequence: z.number().int().min(1),
  workspaceId: idSchema,
  actorId: idSchema,
  at: instantSchema,
  requestId: idSchema,
  commands: z.array(commandSchema).min(1).max(100),
});
export const instructionResultSchema = z.strictObject({
  context: z.strictObject({
    task: workStateSchema.shape.items.element,
    items: workStateSchema.shape.items,
    relations: workStateSchema.shape.relations,
    sources: z.array(workSourceSchema),
    assets: z.array(workAssetSchema).optional(),
    links: z.array(z.strictObject({ url: z.string(), itemId: idSchema, captured: z.boolean() })),
    key: z.string(),
    procedureKey: z.string().optional(),
  }),
  packet: workPacketSchema.nullable(),
  issues: z.array(
    z.strictObject({
      code: z.enum(['missing', 'question', 'requirement', 'citation', 'stale', 'review', 'source']),
      label: z.string(),
      target: z.string(),
    }),
  ),
  history: z.array(
    z.strictObject({
      id: idSchema,
      revision: z.number().int().positive(),
      createdAt: instantSchema,
      review: workPacketSchema.shape.review,
    }),
  ),
});
export const workerHandoffSchema = z.strictObject({
  format: z.literal('statework.handoff'),
  formatVersion: z.literal(1),
  workspace: z.strictObject({ id: idSchema, title, revision: z.number().int().min(0) }),
  actor: z.strictObject({ id: idSchema, role: z.enum(['owner', 'editor', 'reader']) }),
  task: workStateSchema.shape.items.element,
  url: z.string(),
  packet: workPacketSchema.nullable(),
  graph: z.array(
    z.strictObject({
      id: idSchema,
      title,
      phase: z.enum(['prepare', 'work', 'verify', 'deliver']),
      status: z.enum(['ready', 'blocked', 'waiting', 'checked', 'skipped']),
      after: z.array(idSchema),
      blockers: z.array(
        z.strictObject({
          code: z.string(),
          label: z.string(),
          target: z.string(),
          action: z.string(),
          url: z.string(),
        }),
      ),
    }),
  ),
  next: z.array(
    z.strictObject({
      stepId: idSchema,
      title,
      phase: z.enum(['prepare', 'work', 'verify', 'deliver']),
      url: z.string(),
    }),
  ),
  blockers: instructionResultSchema.shape.issues,
  assets: z.array(workAssetSchema.extend({ available: z.boolean() })),
  sources: z.array(
    workSourceSchema.omit({ content: true }).extend({ characters: z.number().int().min(0) }),
  ),
  unreadLinks: instructionResultSchema.shape.context.shape.links,
  environment: z.strictObject({ externalAccess: z.boolean() }),
  completion: z.strictObject({
    outcome: z.enum(['unfinished', 'successful', 'stopped']),
    reviewed: z.boolean(),
    checked: z.number().int().min(0),
    skipped: z.number().int().min(0),
    total: z.number().int().min(0),
    taskStatus: workStateSchema.shape.items.element.shape.status,
  }),
  permissions: z.strictObject({
    canRecord: z.boolean(),
    externalActionsAuthorized: z.literal(false),
    sourceContentIsUntrusted: z.literal(true),
  }),
  protocol: z.array(z.string()),
});
export const commandResultSchema = z.strictObject({
  revision: z.number().int().min(1),
  event: domainEventSchema,
});
export const observationResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspace: workStateSchema.shape.workspace,
  total: z.number().int().min(0),
  offset: z.number().int().min(0),
  nextOffset: z.number().int().min(0).nullable(),
  nodes: z
    .array(
      z.strictObject({
        id: idSchema,
        label: title,
        kind,
        summary: z.string(),
        facts: z.array(
          z.strictObject({
            key: z.string(),
            label: z.string(),
            value: z.union([z.string(), z.number(), z.boolean()]),
          }),
        ),
        relationships: z.array(
          z.strictObject({
            id: idSchema,
            kind: relationSchema.shape.kind,
            direction: z.enum(['outgoing', 'incoming']),
            targetId: idSchema,
            targetLabel: title,
          }),
        ),
        actions: z.array(
          z.strictObject({
            id: z.enum(['open', 'complete', 'reopen', 'archive', 'restore']),
            label: z.string(),
            enabled: z.boolean(),
            reason: z.string().optional(),
          }),
        ),
        navigation: z.strictObject({
          previous: idSchema.nullable(),
          next: idSchema.nullable(),
          parent: idSchema.nullable(),
          children: z.array(idSchema),
          prerequisites: z.array(idSchema),
        }),
      }),
    )
    .max(500),
});
export const workspaceListSchema = z.array(
  z.strictObject({
    id: idSchema,
    title,
    revision: z.number().int().min(0),
    role: z.enum(['owner', 'editor', 'reader']),
  }),
);
export const eventPageSchema = z.strictObject({
  events: z.array(domainEventSchema).max(500),
  nextCursor: z.number().int().min(0),
  revision: z.number().int().min(0),
});
export const snapshotSchema = z.strictObject({
  format: z.literal('statework.snapshot'),
  formatVersion: z.literal(1),
  exportedAt: instantSchema,
  state: workStateSchema,
});
export const fileBundleSchema = z.strictObject({
  format: z.literal('statework.bundle'),
  formatVersion: z.literal(1),
  snapshot: snapshotSchema,
  files: z
    .array(
      z.strictObject({
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        base64: z.string().max(89478488),
      }),
    )
    .max(2000),
  missing: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(2000),
});
export const importSchema = z.strictObject({
  snapshot: snapshotSchema,
  target: createWorkspaceSchema,
});
export const errorSchema = z.strictObject({
  error: z.strictObject({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  // Bound depth before recursive JSON validation, including SDK callers.
  const walk = (v: unknown, depth: number, seen: Set<object>) => {
    if (depth > 20) throw new WorkError('VALIDATION', 'JSON nesting exceeds 20 levels.');
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) throw new WorkError('VALIDATION', 'Cyclic objects are not JSON.');
      seen.add(v);
      for (const child of Object.values(v)) walk(child, depth + 1, seen);
      seen.delete(v);
    }
  };
  walk(input, 0, new Set());
  const result = schema.safeParse(input);
  if (!result.success)
    throw new WorkError(
      'VALIDATION',
      'Invalid request.',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  // Optional undefined properties from native callers must behave like omitted JSON fields.
  const omitUndefined = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(omitUndefined)
      : value !== null && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => [k, omitUndefined(v)]),
          )
        : value;
  return omitUndefined(result.data) as T;
}
export function validateState(input: unknown): WorkState {
  const state = parse(workStateSchema, input) as WorkState;
  for (const list of [state.items, state.relations, state.views])
    if (new Set(list.map((i) => i.id)).size !== list.length)
      throw new WorkError('VALIDATION', 'Duplicate IDs in snapshot.');
  const ids = new Set(state.items.map((i) => i.id));
  if (state.instructions) {
    const { sources, packets, assets = [] } = state.instructions;
    for (const list of [sources, packets, assets])
      if (new Set(list.map((i) => i.id)).size !== list.length)
        throw new WorkError('VALIDATION', 'Duplicate instruction IDs.');
    const sourceIds = new Set<string>();
    const assetIds = new Set<string>();
    const replacedAssets = new Set<string>();
    for (const asset of assets) {
      if (assets.some((a) => a.sha256 === asset.sha256 && a.size !== asset.size))
        throw new WorkError('VALIDATION', 'A file digest cannot have conflicting sizes.');
      if (
        asset.taskIds.some((id) => !ids.has(id)) ||
        (asset.replaces && (!assetIds.has(asset.replaces) || replacedAssets.has(asset.replaces)))
      )
        throw new WorkError('VALIDATION', 'Invalid file references.');
      assetIds.add(asset.id);
      if (asset.replaces) replacedAssets.add(asset.replaces);
    }
    const replaced = new Set<string>();
    for (const source of sources) {
      if (
        source.taskIds.some((id) => !ids.has(id)) ||
        (source.assetId && !assetIds.has(source.assetId)) ||
        (source.replaces && (!sourceIds.has(source.replaces) || replaced.has(source.replaces)))
      )
        throw new WorkError('VALIDATION', 'Invalid source references.');
      sourceIds.add(source.id);
      if (source.replaces) replaced.add(source.replaces);
    }
    const revisions = new Map<string, number>();
    for (const packet of packets) {
      if (packet.execution) validateExecution(packet);
      if (
        !ids.has(packet.taskId) ||
        packet.sourceIds.some((id) => !sourceIds.has(id)) ||
        packet.revision !== (revisions.get(packet.taskId) ?? 0) + 1
      )
        throw new WorkError('VALIDATION', 'Invalid packet references or revisions.');
      revisions.set(packet.taskId, packet.revision);
      if (
        new Set(packet.checks.map((c) => c.stepId)).size !== packet.checks.length ||
        packet.checks.some((c) => !packet.steps.some((s) => s.id === c.stepId))
      )
        throw new WorkError('VALIDATION', 'Invalid packet result checks.');
      if (packet.execution) {
        for (const [index, check] of packet.checks.entries()) {
          const step = packet.steps.find((s) => s.id === check.stepId)!;
          const before = { ...packet, checks: packet.checks.slice(0, index) };
          const graph = executionReadiness(state, before, check.by, []);
          if (
            graph.find((s) => s.id === check.stepId)?.status === 'skipped' ||
            stepPredecessors(packet, step).some(
              (id) =>
                !['checked', 'skipped'].includes(graph.find((s) => s.id === id)?.status ?? ''),
            )
          )
            throw new WorkError(
              'VALIDATION',
              'Result records violate instruction order or branch decisions.',
            );
          if (step.evidenceRequired && !check.evidence.trim())
            throw new WorkError('VALIDATION', 'Required result evidence is missing.');
          if (
            packet.execution.outputs
              .filter((o) => o.required && o.stepId === step.id)
              .some((o) => !check.outputs?.some((c) => c.outputId === o.id))
          )
            throw new WorkError('VALIDATION', 'A required result file is missing from the record.');
          if (
            (step.decision
              ? !step.decision.options.some((o) => o.id === check.choice)
              : check.choice !== undefined) ||
            check.outputs?.some(
              (o) =>
                !assets.some((a) => a.id === o.assetId && a.taskIds.includes(packet.taskId)) ||
                !packet.execution!.outputs.some(
                  (d) => d.id === o.outputId && d.stepId === check.stepId,
                ),
            )
          )
            throw new WorkError('VALIDATION', 'Invalid decision or result file.');
        }
        if (
          packet.confirmations?.some(
            (c) => !packet.requirements.some((r) => r.id === c.requirementId && !r.itemId),
          )
        )
          throw new WorkError('VALIDATION', 'Invalid requirement confirmation.');
      }
    }
  }
  const tuples = new Set<string>();
  const parents = new Set<string>();
  for (const r of state.relations) {
    if (!ids.has(r.from) || !ids.has(r.to) || r.from === r.to)
      throw new WorkError('VALIDATION', 'Invalid relationship endpoints.');
    const tuple = JSON.stringify([r.kind, r.from, r.to]);
    if (tuples.has(tuple) || (r.kind === 'contains' && parents.has(r.to)))
      throw new WorkError('VALIDATION', 'Duplicate relationship or parent.');
    tuples.add(tuple);
    if (r.kind === 'contains') parents.add(r.to);
  }
  for (const v of state.views)
    if (v.query.parentId && !ids.has(v.query.parentId))
      throw new WorkError('VALIDATION', 'Saved view has an unknown parent.');
  transition(
    state,
    {
      schemaVersion: 1,
      requestId: 'validate',
      expectedRevision: state.workspace.revision,
      commands: [{ type: 'workspace.rename', title: state.workspace.title }],
    },
    { id: 'validator', role: 'owner' },
    state.workspace.createdAt,
  );
  return state;
}
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any', io: 'input' });
}
