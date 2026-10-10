import { WorkError } from './model.js';
import type { Principal, WorkState } from './model.js';

export type FactKind = 'chosen' | 'attended' | 'submitted' | 'accepted' | 'decision';
export interface FactInput {
  id: string;
  itemId: string;
  key: string;
  kind: FactKind;
  value: string;
  occurredAt: string;
  sourceIds: string[];
  replaces: string | null;
}
export interface WorkFact extends FactInput {
  recordedAt: string;
  recordedBy: string;
}
export interface SourceVerificationInput {
  id: string;
  sourceId: string;
  observedAt: string;
  validUntil: string;
  result: 'unchanged' | 'changed' | 'unavailable';
  evidence: string;
}
export interface SourceVerification extends SourceVerificationInput {
  recordedAt: string;
  recordedBy: string;
}
/** Provider-neutral fields. Credentials and provider payloads never belong here. */
export interface CalendarIntent {
  title: string;
  actionUrl: string;
  schedule: { start: string; end: string; timeZone: string } | null;
  dueDate: string | null;
  /** Provider-normalized recurrence, not expanded by core. */
  recurrence: string[];
}
export interface CalendarBindingInput {
  id: string;
  itemId: string;
  provider: string;
  calendarId: string;
  eventId: string;
  remoteVersion: string;
  observedAt: string;
  sourceIds: string[];
  baseline: CalendarIntent;
  stopWhen: { itemId: string; key: string; kind: FactKind; value: string } | null;
}
export interface CalendarBinding extends CalendarBindingInput {
  recordedAt: string;
  recordedBy: string;
}
export interface WorkKnowledge {
  facts: WorkFact[];
  verifications: SourceVerification[];
  calendars: CalendarBinding[];
}
export type KnowledgeCommand =
  | { type: 'fact.record'; fact: FactInput }
  | { type: 'source.verify'; verification: SourceVerificationInput }
  | { type: 'source.relink'; id: string; taskIds: string[]; reason: string }
  | { type: 'calendar.record'; binding: CalendarBindingInput };

export function currentFacts(state: WorkState): WorkFact[] {
  const facts = state.knowledge?.facts ?? [];
  const replaced = new Set(facts.map((f) => f.replaces));
  return facts.filter((f) => !replaced.has(f.id));
}
export function sourceFreshness(state: WorkState, sourceId: string, now: string) {
  const source = state.instructions?.sources.find((s) => s.id === sourceId);
  const latest = (state.knowledge?.verifications ?? [])
    .filter((v) => v.sourceId === sourceId)
    .at(-1);
  const replaced = state.instructions?.sources.some((s) => s.replaces === sourceId);
  const status = !source
    ? 'missing'
    : replaced
      ? 'superseded'
      : !latest
        ? 'historical'
        : latest.observedAt > now
          ? 'historical'
          : latest.result !== 'unchanged'
            ? 'needs-check'
            : now >= latest.validUntil
              ? 'needs-check'
              : 'verified';
  return {
    status,
    capturedAt: source?.capturedAt ?? null,
    observedAt: latest?.observedAt ?? null,
    validUntil: latest?.validUntil ?? null,
    verificationId: latest?.id ?? null,
  };
}
export function validateKnowledge(state: WorkState): void {
  const k = state.knowledge;
  if (!k) return;
  const itemIds = new Set(state.items.map((i) => i.id));
  const sourceIds = new Set(state.instructions?.sources.map((s) => s.id) ?? []);
  const sourcesExist = (ids: string[]) => ids.length > 0 && ids.every((id) => sourceIds.has(id));
  for (const list of [k.facts, k.verifications, k.calendars]) {
    if (new Set(list.map((v) => v.id)).size !== list.length)
      throw new WorkError('VALIDATION', 'Duplicate knowledge IDs.');
    if (list.length > 10000)
      throw new WorkError('LIMIT', 'Knowledge collection exceeds 10,000 records.');
  }
  const facts = new Map<string, WorkFact>();
  const replaced = new Set<string>();
  const activeKeys = new Map<string, string>();
  for (const f of k.facts) {
    const prev = f.replaces ? facts.get(f.replaces) : undefined;
    const key = JSON.stringify([f.itemId, f.kind, f.key]);
    if (
      !itemIds.has(f.itemId) ||
      !sourcesExist(f.sourceIds) ||
      f.occurredAt > f.recordedAt ||
      (f.replaces &&
        (!prev ||
          replaced.has(f.replaces) ||
          prev.itemId !== f.itemId ||
          prev.kind !== f.kind ||
          prev.key !== f.key)) ||
      (activeKeys.has(key) && f.replaces !== activeKeys.get(key))
    )
      throw new WorkError(
        'VALIDATION',
        'Fact needs existing evidence and the latest matching predecessor.',
      );
    if (f.replaces) replaced.add(f.replaces);
    activeKeys.set(key, f.id);
    facts.set(f.id, f);
  }
  const lastObserved = new Map<string, string>();
  for (const v of k.verifications) {
    if (
      !sourceIds.has(v.sourceId) ||
      v.observedAt > v.recordedAt ||
      v.validUntil <= v.observedAt ||
      v.observedAt < (lastObserved.get(v.sourceId) ?? '')
    )
      throw new WorkError('VALIDATION', 'Invalid source verification chronology or source.');
    lastObserved.set(v.sourceId, v.observedAt);
  }
  const remoteIds = new Set<string>();
  for (const b of k.calendars) {
    const identity = JSON.stringify([b.provider, b.calendarId, b.eventId]);
    if (
      !itemIds.has(b.itemId) ||
      !sourcesExist(b.sourceIds) ||
      b.observedAt > b.recordedAt ||
      (b.stopWhen && !itemIds.has(b.stopWhen.itemId)) ||
      remoteIds.has(identity)
    )
      throw new WorkError('VALIDATION', 'Invalid or duplicate calendar binding.');
    remoteIds.add(identity);
  }
}
export function applyKnowledgeCommand(
  state: WorkState,
  command: KnowledgeCommand,
  actor: Principal,
  at: string,
): void {
  if (command.type === 'source.relink') {
    const source = state.instructions?.sources.find((s) => s.id === command.id);
    if (!source || command.taskIds.some((id) => !state.items.some((i) => i.id === id)))
      throw new WorkError('NOT_FOUND', 'Source or associated work is unavailable.');
    // Exact text, capture identity and citations survive. Changes remain in batch history.
    source.taskIds = [...command.taskIds];
    return;
  }
  const k = (state.knowledge ??= { facts: [], verifications: [], calendars: [] });
  const attribution = { recordedAt: at, recordedBy: actor.id };
  if (command.type === 'fact.record') k.facts.push({ ...command.fact, ...attribution });
  if (command.type === 'source.verify')
    k.verifications.push({ ...command.verification, ...attribution });
  if (command.type === 'calendar.record') {
    const b = command.binding;
    const index = k.calendars.findIndex((v) => v.id === b.id);
    const old = k.calendars[index];
    if (
      old &&
      (old.itemId !== b.itemId ||
        old.provider !== b.provider ||
        old.calendarId !== b.calendarId ||
        old.eventId !== b.eventId ||
        b.observedAt < old.observedAt)
    )
      throw new WorkError(
        'CONFLICT',
        'A calendar identity cannot be rebound or moved backwards in time.',
      );
    if (old) k.calendars[index] = { ...b, ...attribution };
    else k.calendars.push({ ...b, ...attribution });
  }
  validateKnowledge(state);
}

export interface CalendarComparison {
  bindingId: string;
  desired: CalendarIntent;
  observed: { event: CalendarIntent | null; version: string; observedAt: string };
}
const calendarKey = (c: CalendarIntent) =>
  JSON.stringify([
    c.title,
    c.actionUrl,
    c.schedule ? [c.schedule.start, c.schedule.end, c.schedule.timeZone] : null,
    c.dueDate,
    [...c.recurrence].sort(),
  ]);
/** A comparison, never a provider write or authorization to send one. */
export function reconcileCalendar(state: WorkState, comparison: CalendarComparison, now: string) {
  const binding = state.knowledge?.calendars.find((b) => b.id === comparison.bindingId);
  if (!binding) throw new WorkError('NOT_FOUND', 'Record an observed calendar binding first.');
  const { observed, desired } = comparison;
  if (observed.observedAt > now || observed.observedAt < binding.observedAt)
    throw new WorkError('CONFLICT', 'Use a new provider observation before reconciliation.');
  const stop = binding.stopWhen;
  const shouldStop =
    !!stop &&
    currentFacts(state).some(
      (f) =>
        f.itemId === stop.itemId &&
        f.key === stop.key &&
        f.kind === stop.kind &&
        f.value === stop.value,
    );
  const localChanged = calendarKey(desired) !== calendarKey(binding.baseline);
  const remoteChanged =
    observed.event !== null && calendarKey(observed.event) !== calendarKey(binding.baseline);
  const action =
    observed.event === null
      ? shouldStop
        ? 'stopped'
        : 'remote-missing'
      : shouldStop
        ? remoteChanged
          ? 'conflict'
          : observed.event.recurrence.length
            ? 'stop-series'
            : 'cancel-event'
        : calendarKey(desired) === calendarKey(observed.event)
          ? 'in-sync'
          : localChanged && remoteChanged
            ? 'conflict'
            : localChanged
              ? 'update-remote'
              : 'review-remote';
  return {
    format: 'statework.calendar-comparison' as const,
    formatVersion: 1 as const,
    workspaceId: state.workspace.id,
    revision: state.workspace.revision,
    bindingId: binding.id,
    provider: binding.provider,
    calendarId: binding.calendarId,
    eventId: binding.eventId,
    action,
    shouldStop,
    localChanged,
    remoteChanged,
    expectedRemoteVersion: observed.version,
    observedAt: observed.observedAt,
    externalActionsAuthorized: false as const,
    guidance:
      'Review the comparison. Re-read the provider and use its concurrency token before an authorized write. Record the successful readback; never recreate a missing event automatically.',
  };
}
