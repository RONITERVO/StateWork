import { z } from 'zod';
import { instructionUrl } from '@statework/core';
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
const label = z.string().trim().min(1).max(240);
const instant = z.string().refine((s) => {
  const d = new Date(s);
  return Number.isFinite(d.getTime()) && d.toISOString() === s && s.length === 24;
});
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  });
const zone = z
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
  });
const ids = (max: number) =>
  z
    .array(id)
    .max(max)
    .refine((v) => new Set(v).size === v.length);
const sourceIds = ids(20).min(1);
const attribution = { recordedAt: instant, recordedBy: id };
const factKind = z.enum(['chosen', 'attended', 'submitted', 'accepted', 'decision']);
export const factInputSchema = z.strictObject({
  id,
  itemId: id,
  key: id,
  kind: factKind,
  value: z.string().trim().min(1).max(2000),
  occurredAt: instant,
  sourceIds,
  replaces: id.nullable(),
});
export const workFactSchema = factInputSchema.extend(attribution);
export const verificationInputSchema = z.strictObject({
  id,
  sourceId: id,
  observedAt: instant,
  validUntil: instant,
  result: z.enum(['unchanged', 'changed', 'unavailable']),
  evidence: z.string().trim().min(1).max(2000),
});
export const sourceVerificationSchema = verificationInputSchema.extend(attribution);
export const calendarIntentSchema = z
  .strictObject({
    title: label,
    actionUrl: z
      .string()
      .max(2048)
      .refine((s) => !s || instructionUrl(s)),
    schedule: z
      .strictObject({ start: instant, end: instant, timeZone: zone })
      .refine((s) => s.end > s.start)
      .nullable(),
    dueDate: date.nullable(),
    recurrence: z
      .array(z.string().trim().min(1).max(1000))
      .max(20)
      .refine((v) => new Set(v).size === v.length),
  })
  .refine((v) => !!v.schedule !== !!v.dueDate, 'Use either a timed event or an all-day date.');
export const calendarBindingInputSchema = z.strictObject({
  id,
  itemId: id,
  provider: id,
  calendarId: z.string().min(1).max(500),
  eventId: z.string().min(1).max(500),
  remoteVersion: z.string().min(1).max(500),
  observedAt: instant,
  sourceIds,
  baseline: calendarIntentSchema,
  stopWhen: z
    .strictObject({ itemId: id, key: id, kind: factKind, value: z.string().min(1).max(2000) })
    .nullable(),
});
export const calendarBindingSchema = calendarBindingInputSchema.extend(attribution);
export const knowledgeSchema = z.strictObject({
  facts: z.array(workFactSchema).max(10000),
  verifications: z.array(sourceVerificationSchema).max(10000),
  calendars: z.array(calendarBindingSchema).max(10000),
});
export const knowledgeCommandSchemas = [
  z.strictObject({ type: z.literal('fact.record'), fact: factInputSchema }),
  z.strictObject({ type: z.literal('source.verify'), verification: verificationInputSchema }),
  z.strictObject({
    type: z.literal('source.relink'),
    id,
    taskIds: ids(100).min(1),
    reason: z.string().trim().min(1).max(2000),
  }),
  z.strictObject({ type: z.literal('calendar.record'), binding: calendarBindingInputSchema }),
] as const;
export const briefOptionsSchema = z.strictObject({
  taskId: id.optional(),
  text: z.string().max(500).optional(),
  section: z.enum(['overview', 'steps', 'sources', 'facts', 'questions', 'calendar']).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(20).optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  includeInherited: z.boolean().optional(),
});
export const readOptionsSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative().optional(),
});
export const sourceReadSchema = readOptionsSchema.extend({
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(16000).optional(),
});
export const calendarComparisonSchema = z.strictObject({
  bindingId: id,
  desired: calendarIntentSchema,
  observed: z.strictObject({
    event: calendarIntentSchema.nullable(),
    version: z.string().min(1).max(500),
    observedAt: instant,
  }),
});
const workspace = z.strictObject({ id, title: label, revision: z.number().int().nonnegative() });
const count = z.number().int().nonnegative();
export const workBriefSchema = z.strictObject({
  format: z.literal('statework.brief'),
  formatVersion: z.literal(1),
  workspace,
  generatedAt: instant,
  task: z
    .strictObject({
      id,
      title: label,
      kind: z.string(),
      status: z.string(),
      version: count,
      url: z.string(),
      packetId: id.nullable(),
    })
    .nullable(),
  section: z.enum(['overview', 'steps', 'sources', 'facts', 'questions', 'calendar']),
  total: count,
  offset: count,
  nextOffset: count.nullable(),
  entries: z
    .array(
      z.strictObject({
        id: z.string(),
        label: z.string().max(240),
        kind: z.string(),
        state: z.string(),
        detail: z.string().max(240),
        url: z.string(),
        at: instant.nullable(),
        sourceIds: ids(20),
      }),
    )
    .max(20),
  next: z
    .strictObject({
      taskId: id,
      stepId: id.nullable(),
      label: z.string().max(240),
      url: z.string(),
    })
    .nullable(),
  counts: z.strictObject({
    steps: count,
    ready: count,
    blockers: count,
    questions: count,
    facts: count,
    sources: count,
    historical: count,
    needsCheck: count,
  }),
  notice: z.string(),
});
export const calendarComparisonResultSchema = z.strictObject({
  format: z.literal('statework.calendar-comparison'),
  formatVersion: z.literal(1),
  workspaceId: id,
  revision: count,
  bindingId: id,
  provider: id,
  calendarId: z.string(),
  eventId: z.string(),
  action: z.enum([
    'stopped',
    'remote-missing',
    'conflict',
    'stop-series',
    'cancel-event',
    'in-sync',
    'update-remote',
    'review-remote',
  ]),
  shouldStop: z.boolean(),
  localChanged: z.boolean(),
  remoteChanged: z.boolean(),
  expectedRemoteVersion: z.string(),
  observedAt: instant,
  externalActionsAuthorized: z.literal(false),
  guidance: z.string(),
});
