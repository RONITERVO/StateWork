import { z } from 'zod';
import { WorkError, transition } from '@statework/core';
import type { WorkState } from '@statework/core';

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
});
export const domainEventSchema = z.strictObject({
  sequence: z.number().int().min(1),
  workspaceId: idSchema,
  actorId: idSchema,
  at: instantSchema,
  requestId: idSchema,
  commands: z.array(commandSchema).min(1).max(100),
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
