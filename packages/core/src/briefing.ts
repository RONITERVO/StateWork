import { WorkError, isFinished } from './model.js';
import type { Principal, WorkState } from './model.js';
import { latestPacket, packetIssues } from './instructions.js';
import { workerHandoff } from './handoff.js';
import { currentFacts, sourceFreshness } from './knowledge.js';
import { workDeepLink } from './resources.js';
import type { WorkerEnvironment } from './execution.js';
import { queryItems } from './observe.js';

export interface BriefOptions {
  taskId?: string;
  text?: string;
  section?: 'overview' | 'steps' | 'sources' | 'facts' | 'questions' | 'calendar';
  offset?: number;
  limit?: number;
  expectedRevision?: number;
  includeInherited?: boolean;
}
export interface BriefEntry {
  id: string;
  label: string;
  kind: string;
  state: string;
  detail: string;
  url: string;
  at: string | null;
  sourceIds: string[];
}
const short = (text: string) => (text.length > 240 ? text.slice(0, 239) + '…' : text);
export function assertReadRevision(state: WorkState, revision?: number) {
  if (revision !== undefined && revision !== state.workspace.revision)
    throw new WorkError('CONFLICT', 'Work changed. Refresh the brief before loading more detail.', {
      currentRevision: state.workspace.revision,
    });
}
/** Small, read-only projection. Exact instructions remain in step/source reads. */
export function workBrief(
  state: WorkState,
  actor: Principal,
  now: string,
  options: BriefOptions = {},
  environment: WorkerEnvironment = {},
) {
  assertReadRevision(state, options.expectedRevision);
  const section = options.section ?? 'overview',
    offset = options.offset ?? 0,
    limit = options.limit ?? 8;
  const task = options.taskId ? state.items.find((i) => i.id === options.taskId) : undefined;
  if (options.taskId && !task) throw new WorkError('NOT_FOUND', 'Work item not found.');
  const packet = task ? latestPacket(state, task.id) : undefined;
  const handoff = task ? workerHandoff(state, actor, environment)(task.id) : undefined;
  const issues =
    task && packet
      ? packetIssues(state, packet)
      : task?.kind === 'task'
        ? [{ code: 'missing', label: 'Build and review the instructions.', target: 'packet' }]
        : [];
  const issueList = [
    ...new Map(
      [
        ...issues,
        ...(handoff?.graph ?? []).filter((s) => s.status === 'blocked').flatMap((s) => s.blockers),
      ].map((i) => [JSON.stringify([i.code, i.target, i.label]), i]),
    ).values(),
  ];
  const allFacts = currentFacts(state);
  const facts = allFacts.filter((f) => f.itemId === task?.id);
  const explicitSources = new Set(packet?.sourceIds ?? []);
  const sources = (handoff?.sources ?? []).filter(
    (s) =>
      options.includeInherited || explicitSources.has(s.id) || s.taskIds.includes(task?.id ?? ''),
  );
  const factsSources = facts.flatMap((f) => f.sourceIds);
  const sourceIds = [...new Set([...sources.map((s) => s.id), ...factsSources])];
  const freshness = sourceIds.map((id) => sourceFreshness(state, id, now));
  let entries: BriefEntry[] = [];
  const url = (id: string, step?: string) => workDeepLink(state.workspace.id, id, step);
  const base = (
    id: string,
    label: string,
    kind: string,
    status: string,
    detail = '',
    link = '',
  ): BriefEntry => ({
    id,
    label: short(label),
    kind,
    state: status,
    detail: short(detail),
    url: link,
    at: null,
    sourceIds: [],
  });
  if (!task) {
    const text = (options.text ?? '').trim().toLowerCase();
    const matches = new Set(
      (state.instructions?.sources ?? [])
        .filter((s) => text && s.locator.toLowerCase().includes(text))
        .flatMap((s) => s.taskIds),
    );
    entries = state.items
      .filter(
        (i) =>
          !i.archived &&
          (!text ||
            matches.has(i.id) ||
            `${i.id} ${i.title} ${i.description} ${i.tags.join(' ')}`.toLowerCase().includes(text)),
      )
      .sort(
        (a, b) =>
          Number(isFinished(a)) - Number(isFinished(b)) ||
          b.priority - a.priority ||
          a.id.localeCompare(b.id, 'en'),
      )
      .map((i) =>
        base(
          i.id,
          i.title,
          i.kind,
          i.status,
          '',
          `/brief/?workspace=${encodeURIComponent(state.workspace.id)}&task=${encodeURIComponent(i.id)}`,
        ),
      );
  } else if (section === 'steps') {
    entries = (handoff?.graph ?? []).map((s) =>
      base(s.id, s.title, 'step', s.status, '', url(task.id, s.id)),
    );
  } else if (section === 'sources') {
    entries = sourceIds.map((id) => {
      const source = state.instructions?.sources.find((s) => s.id === id);
      const f = sourceFreshness(state, id, now);
      return {
        ...base(id, source?.title ?? id, 'source', f.status, source?.locator ?? ''),
        at: f.observedAt ?? f.capturedAt,
        sourceIds: [id],
      };
    });
  } else if (section === 'facts') {
    entries = facts.map((f) => ({
      ...base(f.id, f.key, f.kind, 'recorded', f.value),
      at: f.occurredAt,
      sourceIds: f.sourceIds,
    }));
  } else if (section === 'questions') {
    entries = (packet?.questions ?? []).map((q) =>
      base(
        q.id,
        q.question,
        'question',
        q.answer ? 'answered' : 'open',
        q.answer || q.resolve,
        q.url,
      ),
    );
  } else if (section === 'calendar') {
    entries = (state.knowledge?.calendars ?? [])
      .filter((b) => b.itemId === task.id)
      .map((b) => ({
        ...base(
          b.id,
          b.baseline.title,
          'calendar',
          'recorded',
          `${b.provider} · ${b.stopWhen ? 'Stop condition recorded' : 'No stop condition'}`,
          b.baseline.actionUrl,
        ),
        at: b.observedAt,
        sourceIds: b.sourceIds,
      }));
    for (const key of Object.keys(task.extensions).filter((k) =>
      k.startsWith('statework.calendar/'),
    ))
      entries.push(
        base(
          key,
          'Earlier calendar record',
          'calendar',
          'legacy',
          'Read the item record and verify the provider before creating a binding.',
        ),
      );
  } else {
    entries = issueList.map((i, n) =>
      base(`issue-${n}`, i.label, 'blocker', i.code, '', url(task.id)),
    );
    entries.push(
      ...(packet?.questions ?? [])
        .filter((q) => !q.answer)
        .map((q) => base(q.id, q.question, 'question', 'open', q.resolve, q.url)),
    );
    const related = new Set(
      state.relations.filter((r) => r.kind === 'contains' && r.from === task.id).map((r) => r.to),
    );
    const required = new Set(
      state.relations.filter((r) => r.kind === 'depends_on' && r.from === task.id).map((r) => r.to),
    );
    entries.push(
      ...state.items
        .filter((i) => related.has(i.id) || required.has(i.id))
        .map((i) =>
          base(
            i.id,
            i.title,
            required.has(i.id) ? 'prerequisite' : i.kind,
            i.status,
            '',
            `/brief/?workspace=${encodeURIComponent(state.workspace.id)}&task=${encodeURIComponent(i.id)}`,
          ),
        ),
    );
    entries.push(
      ...facts.map((f) => ({
        ...base(f.id, f.key, f.kind, 'recorded', f.value),
        at: f.occurredAt,
        sourceIds: f.sourceIds,
      })),
    );
  }
  const next = task && !isFinished(task) ? handoff?.next[0] : undefined;
  const child =
    task && !isFinished(task) && task.kind === 'project'
      ? queryItems(
          state,
          { parentId: task.id, actionable: true },
          { actorId: actor.id, environment },
        )[0]
      : undefined;
  return {
    format: 'statework.brief' as const,
    formatVersion: 1 as const,
    workspace: {
      id: state.workspace.id,
      title: state.workspace.title,
      revision: state.workspace.revision,
    },
    generatedAt: now,
    task: task
      ? {
          id: task.id,
          title: task.title,
          kind: task.kind,
          status: task.status,
          version: task.version,
          url: url(task.id),
          packetId: packet?.id ?? null,
        }
      : null,
    section,
    total: entries.length,
    offset,
    nextOffset: offset + limit < entries.length ? offset + limit : null,
    entries: entries.slice(offset, offset + limit),
    next: next
      ? { taskId: task!.id, stepId: next.stepId, label: short(next.title), url: next.url }
      : child
        ? { taskId: child.id, stepId: null, label: short(child.title), url: url(child.id) }
        : null,
    counts: {
      steps: packet?.steps.length ?? 0,
      ready: handoff?.next.length ?? 0,
      blockers: issueList.length,
      questions: packet?.questions.filter((q) => !q.answer).length ?? 0,
      facts: facts.length,
      sources: sourceIds.length,
      historical: freshness.filter((f) => f.status === 'historical').length,
      needsCheck: freshness.filter((f) =>
        ['needs-check', 'superseded', 'missing'].includes(f.status),
      ).length,
    },
    notice:
      'This is an index, not complete instructions. Load the selected step and its evidence before acting. Historical evidence does not establish current progress. External actions require authorization.',
  };
}
export type WorkBrief = ReturnType<typeof workBrief>;

export function workStep(
  state: WorkState,
  actor: Principal,
  taskId: string,
  stepId: string,
  environment: WorkerEnvironment = {},
  revision?: number,
) {
  assertReadRevision(state, revision);
  const h = workerHandoff(state, actor, environment)(taskId);
  const step = h.packet?.steps.find((s) => s.id === stepId);
  if (!step || !h.packet) throw new WorkError('NOT_FOUND', 'Step not found.');
  const requirements = h.packet.requirements.filter(
    (r) => step.requires.includes(r.id) || !h.packet!.steps.some((s) => s.requires.includes(r.id)),
  );
  const sourceIds = new Set(
    [...step.citations, ...requirements.flatMap((r) => r.citations)].map((c) => c.sourceId),
  );
  for (const r of step.references ?? [])
    if (r.kind === 'source' && r.targetId) sourceIds.add(r.targetId);
  const assetIds = new Set(
    (step.references ?? []).filter((r) => r.kind === 'asset').map((r) => r.targetId),
  );
  const check = h.packet.checks.find((c) => c.stepId === stepId) ?? null;
  for (const output of check?.outputs ?? []) assetIds.add(output.assetId);
  h.sources.forEach((s) => {
    if (sourceIds.has(s.id) && s.assetId) assetIds.add(s.assetId);
  });
  return {
    format: 'statework.step' as const,
    formatVersion: 1 as const,
    workspace: h.workspace,
    taskId,
    packetId: h.packet.id,
    packetRevision: h.packet.revision,
    outcome: h.packet.outcome,
    finish: h.packet.finish,
    step,
    check,
    readiness: h.graph.find((s) => s.id === stepId)!,
    requirements,
    blockers: h.blockers,
    outputs: h.packet.execution?.outputs.filter((o) => o.stepId === stepId) ?? [],
    sources: h.sources.filter((s) => sourceIds.has(s.id)),
    assets: h.assets.filter((a) => assetIds.has(a.id)),
    externalActionsAuthorized: false as const,
  };
}
