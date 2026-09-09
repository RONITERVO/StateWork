import { WorkError, isFinished } from './model.js';
import type { Command, Principal, Relation, WorkItem, WorkState } from './model.js';
import { registerAsset } from './resources.js';
import type { AssetInput, WorkAsset, WorkReference } from './resources.js';
import type {
  ExecutionContract,
  RequirementConfirmation,
  StepDecision,
  WorkerContext,
} from './execution.js';
import {
  dependentSteps,
  executionIssues,
  executionReadiness,
  requiredStepAssets,
  validateExecution,
} from './execution.js';

export interface SourceInput {
  id: string;
  taskIds: string[];
  title: string;
  locator: string;
  content: string;
  kind: 'page' | 'file' | 'email' | 'note';
  coverage: 'complete' | 'excerpt' | 'unreadable';
  replaces: string | null;
  assetId?: string;
}
export interface WorkSource extends SourceInput {
  capturedAt: string;
  capturedBy: string;
}
export interface Citation {
  sourceId: string;
  quote: string;
  location: string;
}
export interface PacketRequirement {
  id: string;
  label: string;
  detail: string;
  kind: 'task' | 'account' | 'software' | 'person' | 'material' | 'information';
  itemId: string | null;
  url: string;
  check: string;
  confirmed: boolean;
  citations: Citation[];
  scope?: 'worker' | 'workspace';
}
export interface PacketStep {
  id: string;
  title: string;
  instruction: string;
  expected: string;
  ifBlocked: string;
  minutes: number | null;
  actionUrl: string;
  requires: string[];
  citations: Citation[];
  after?: string[];
  phase?: 'prepare' | 'work' | 'verify' | 'deliver';
  references?: WorkReference[];
  when?: { stepId: string; optionId: string };
  decision?: StepDecision;
  evidenceRequired?: boolean;
}
export interface PacketQuestion {
  id: string;
  question: string;
  resolve: string;
  url: string;
  answer: string;
  citations: Citation[];
}
export interface PacketInput {
  id: string;
  taskId: string;
  contextKey: string;
  title: string;
  outcome: string;
  requirements: PacketRequirement[];
  steps: PacketStep[];
  finish: string;
  questions: PacketQuestion[];
  sourceIds: string[];
  origin: 'manual' | 'codex' | 'import';
  execution?: ExecutionContract;
}
export interface WorkPacket extends PacketInput {
  revision: number;
  createdAt: string;
  createdBy: string;
  review: { at: string; by: string } | null;
  checks: {
    stepId: string;
    at: string;
    by: string;
    evidence: string;
    choice?: string;
    outputs?: { outputId: string; assetId: string }[];
  }[];
  confirmations?: RequirementConfirmation[];
}
export interface Instructions {
  sources: WorkSource[];
  packets: WorkPacket[];
  assets?: WorkAsset[];
}
export type InstructionCommand =
  | { type: 'asset.register'; asset: AssetInput }
  | { type: 'source.capture'; source: SourceInput }
  | { type: 'packet.save'; packet: PacketInput; expectedPacketId: string | null }
  | { type: 'packet.review'; id: string }
  | {
      type: 'packet.check';
      id: string;
      stepId: string;
      checked: boolean;
      evidence: string;
      choice?: string;
      outputs?: { outputId: string; assetId: string }[];
    }
  | {
      type: 'packet.confirm';
      id: string;
      requirementId: string;
      available: boolean;
      evidence: string;
    };
export interface PacketContext {
  task: WorkItem;
  items: WorkItem[];
  relations: Relation[];
  sources: WorkSource[];
  assets?: WorkAsset[];
  links: { url: string; itemId: string; captured: boolean }[];
  key: string;
  procedureKey?: string;
}
export interface PacketIssue {
  code: 'missing' | 'question' | 'requirement' | 'citation' | 'stale' | 'review' | 'source';
  label: string;
  target: string;
}
export function instructionUrl(value: string): boolean {
  if (/[\s\u0000-\u001f\\]/.test(value)) return false;
  return (
    /^https?:\/\/[^/@?#]+(?:[/?#].*)?$/i.test(value) ||
    /^mailto:[^?@]+@[^?@]+(?:\?.*)?$/i.test(value)
  );
}
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
};
/** A deterministic change detector, not a security digest. Exact evidence remains in captures. */
function contextKey(value: unknown): string {
  let hash = 0xcbf29ce484222325n;
  for (const c of canonical(value))
    hash = BigInt.asUintN(64, (hash ^ BigInt(c.codePointAt(0)!)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, '0');
}
export function packetContext(state: WorkState, taskId: string): PacketContext {
  const task = state.items.find((i) => i.id === taskId);
  if (!task) throw new WorkError('NOT_FOUND', 'Task not found.');
  const ids = new Set([taskId]);
  // Ancestors and transitive prerequisites, plus direct child work and related notes.
  const follow = new Map<string, string[]>();
  for (const r of state.relations) {
    const from = r.kind === 'contains' ? r.to : r.kind === 'depends_on' ? r.from : null;
    const to = r.kind === 'contains' ? r.from : r.to;
    if (from) {
      const list = follow.get(from) ?? [];
      list.push(to);
      follow.set(from, list);
    }
  }
  const queue = [taskId];
  for (let i = 0; i < queue.length; i++)
    for (const target of follow.get(queue[i]!) ?? [])
      if (!ids.has(target)) {
        ids.add(target);
        queue.push(target);
      }
  for (const r of state.relations) {
    if (r.kind === 'contains' && r.from === taskId) ids.add(r.to);
    if (r.kind === 'relates_to' && (r.from === taskId || r.to === taskId))
      ids.add(r.from === taskId ? r.to : r.from);
  }
  const items = state.items
    .filter((i) => ids.has(i.id))
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const relations = state.relations
    .filter((r) => ids.has(r.from) && ids.has(r.to))
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const allSources = state.instructions?.sources ?? [];
  const replaced = new Set(allSources.map((s) => s.replaces).filter(Boolean));
  const sources = allSources.filter(
    (s) => !replaced.has(s.id) && s.taskIds.some((id) => ids.has(id)),
  );
  const links: PacketContext['links'] = [];
  for (const item of items) {
    const text = `${item.description}\n${JSON.stringify(item.extensions)}`;
    for (const found of text.matchAll(/https?:\/\/[^\s<>"\\]+/g)) {
      const url = found[0].replace(/[),.;]+$/, '');
      if (instructionUrl(url) && !links.some((l) => l.url === url))
        links.push({
          url,
          itemId: item.id,
          captured: sources.some((s) => s.locator === url && s.coverage === 'complete'),
        });
    }
  }
  const keyData = {
    items: items.map((i) => ({
      id: i.id,
      title: i.title,
      description: i.description,
      kind: i.kind,
      archived: i.archived,
      extensions: Object.fromEntries(
        Object.entries(i.extensions).filter(([k]) => k !== 'statework.planning/progress'),
      ),
      status: i.id === taskId ? null : i.status,
    })),
    relations,
    sources: sources.map((s) => s.id).sort(),
  };
  const key = contextKey(keyData);
  const procedureKey = contextKey({
    ...keyData,
    items: keyData.items.map((i) => ({ ...i, status: null })),
  });
  const assets = (state.instructions?.assets ?? []).filter((a) =>
    a.taskIds.some((id) => ids.has(id)),
  );
  return { task, items, relations, sources, assets, links, key, procedureKey };
}
export function latestPacket(state: WorkState, taskId: string): WorkPacket | undefined {
  return state.instructions?.packets.filter((p) => p.taskId === taskId).at(-1);
}
export function packetIssues(
  state: WorkState,
  packet: PacketInput | WorkPacket,
  includeReview = true,
): PacketIssue[] {
  const issues: PacketIssue[] = [];
  const add = (code: PacketIssue['code'], label: string, target = '') => {
    if (!issues.some((i) => i.code === code && i.label === label && i.target === target))
      issues.push({ code, label, target });
  };
  const context = packetContext(state, packet.taskId);
  if (packet.contextKey !== (packet.execution ? context.procedureKey : context.key))
    add('stale', 'Task, requirements or sources changed. Revise and review this packet.');
  if (!packet.outcome.trim()) add('missing', 'Define the finished result.', 'outcome');
  if (!packet.finish.trim()) add('missing', 'Define the final acceptance check.', 'finish');
  if (!packet.steps.length) add('missing', 'Add the actions to perform.', 'steps');
  for (const step of packet.steps) {
    for (const [field, label] of [
      ['instruction', 'Exact action'],
      ['expected', 'Result check'],
      ['ifBlocked', 'Recovery instructions'],
    ] as const)
      if (!step[field].trim()) add('missing', `${step.title}: ${label} needed.`, step.id);
    if (!step.citations.length)
      add(
        'citation',
        `${step.title}: add supporting evidence or a captured author instruction.`,
        step.id,
      );
    for (const id of step.requires)
      if (!packet.requirements.some((r) => r.id === id))
        add('requirement', `${step.title}: unknown requirement.`, step.id);
  }
  for (const r of packet.requirements) {
    const item = r.itemId ? state.items.find((i) => i.id === r.itemId) : undefined;
    if (!r.detail.trim() || !r.check.trim())
      add('missing', `${r.label}: describe access and how to check it.`, r.id);
    if (!packet.execution && (r.itemId ? !item || !isFinished(item) : !r.confirmed))
      add('requirement', `${r.label}: needs confirmation.`, r.id);
    if (r.itemId === packet.taskId)
      add('requirement', 'A task cannot require its own completion.', r.id);
  }
  for (const r of context.relations.filter(
    (r) => r.kind === 'depends_on' && r.from === packet.taskId,
  ))
    if (!packet.requirements.some((req) => req.itemId === r.to))
      add(
        'requirement',
        `Include prerequisite: ${state.items.find((i) => i.id === r.to)?.title ?? r.to}.`,
        r.to,
      );
  for (const q of packet.questions) if (!q.answer.trim()) add('question', q.question, q.id);
  const sourceMap = new Map((state.instructions?.sources ?? []).map((s) => [s.id, s]));
  const replaced = new Set((state.instructions?.sources ?? []).map((s) => s.replaces));
  for (const id of packet.sourceIds) {
    const source = sourceMap.get(id);
    if (!source || source.coverage === 'unreadable' || !source.content.trim())
      add('source', 'Source contents are unavailable.', id);
    if (
      source?.coverage === 'excerpt' &&
      !packet.questions.some((q) => q.id === `coverage-${id}` && q.answer.trim())
    )
      add(
        'source',
        `Check missing diagrams or context in ${source.title}, then record the coverage decision.`,
        id,
      );
    if (replaced.has(id)) add('stale', `A newer capture replaces ${source?.title ?? id}.`, id);
  }
  for (const part of [...packet.steps, ...packet.requirements, ...packet.questions])
    for (const cite of part.citations) {
      const source = sourceMap.get(cite.sourceId);
      if (
        !packet.sourceIds.includes(cite.sourceId) ||
        !source ||
        !cite.quote.trim() ||
        !source.content.includes(cite.quote) ||
        !cite.location.trim()
      )
        add('citation', 'Citation must match captured text and include a location.', part.id);
    }
  // Links need an explicit disposition. Captured excerpts and irrelevant links can be resolved by the author in a question.
  for (const link of context.links.filter((l) => !l.captured))
    if (!packet.questions.some((q) => q.url === link.url && q.answer.trim()))
      add('source', 'Read this linked source or record why it is outside this task.', link.url);
  if (includeReview && (!('review' in packet) || !packet.review))
    add('review', 'Review the complete instructions before use.');
  for (const issue of executionIssues(state, packet)) add(issue.code, issue.label, issue.target);
  return issues;
}
export function blankPacket(state: WorkState, taskId: string, id: string): PacketInput {
  const context = packetContext(state, taskId);
  return {
    id,
    taskId,
    contextKey: context.key,
    title: context.task.title,
    outcome: '',
    finish: '',
    origin: 'manual',
    sourceIds: context.sources.map((s) => s.id),
    requirements: context.relations
      .filter((r) => r.kind === 'depends_on' && r.from === taskId)
      .map((r, i) => {
        const item = context.items.find((i) => i.id === r.to)!;
        return {
          id: `need-${i + 1}`,
          label: item.title,
          detail: item.description.length <= 12000 ? item.description : '',
          kind: 'task',
          itemId: item.id,
          url: '',
          check: '',
          confirmed: isFinished(item),
          citations: [],
        };
      }),
    steps: [
      {
        id: 'step-1',
        title: context.task.title,
        instruction: context.task.description.length <= 12000 ? context.task.description : '',
        expected: '',
        ifBlocked: '',
        minutes: context.task.effortMinutes,
        actionUrl: '',
        requires: [],
        citations: [],
      },
    ],
    questions: context.links
      .filter((l) => !l.captured)
      .map((l, i) => ({
        id: `question-${i + 1}`,
        question: 'What does this source require for this task?',
        resolve: 'Capture the relevant contents, or explain why they do not apply.',
        url: l.url,
        answer: '',
        citations: [],
      })),
  };
}
export function applyInstructionCommand(
  state: WorkState,
  command: InstructionCommand,
  actor: Principal,
  at: string,
): void {
  const data = (state.instructions ??= { sources: [], packets: [] });
  if (command.type === 'asset.register') {
    registerAsset(state, command.asset, actor, at);
  } else if (command.type === 'source.capture') {
    if (data.sources.length >= 2000)
      throw new WorkError('LIMIT', 'This workspace supports 2,000 source captures.');
    if (data.sources.some((s) => s.id === command.source.id))
      throw new WorkError('CONFLICT', 'Source ID already exists.');
    for (const id of command.source.taskIds)
      if (!state.items.some((i) => i.id === id))
        throw new WorkError('NOT_FOUND', 'Source task is unavailable.');
    if (command.source.assetId && !data.assets?.some((a) => a.id === command.source.assetId))
      throw new WorkError('NOT_FOUND', 'Original source file is unavailable.');
    if (
      command.source.replaces &&
      (!data.sources.some((s) => s.id === command.source.replaces) ||
        data.sources.some((s) => s.replaces === command.source.replaces))
    )
      throw new WorkError('CONFLICT', 'Replace the latest existing source capture.');
    data.sources.push({ ...command.source, capturedAt: at, capturedBy: actor.id });
  } else if (command.type === 'packet.save') {
    const packet = command.packet;
    validateExecution(packet, state);
    const latest = latestPacket(state, packet.taskId);
    if (
      (latest?.id ?? null) !== command.expectedPacketId ||
      data.packets.some((p) => p.id === packet.id)
    )
      throw new WorkError('CONFLICT', 'Instructions changed. Refresh before saving a revision.');
    if (data.packets.length >= 2000)
      throw new WorkError('LIMIT', 'This workspace supports 2,000 packet revisions.');
    const context = packetContext(state, packet.taskId);
    if (packet.contextKey !== (packet.execution ? context.procedureKey : context.key))
      throw new WorkError('CONFLICT', 'Task context changed. Reconcile the draft before saving.');
    if (packet.sourceIds.some((id) => !data.sources.some((s) => s.id === id)))
      throw new WorkError('NOT_FOUND', 'Packet references an unavailable source.');
    data.packets.push({
      ...packet,
      revision: (latest?.revision ?? 0) + 1,
      createdAt: at,
      createdBy: actor.id,
      review: null,
      checks: [],
    });
  } else {
    const packet = data.packets.find((p) => p.id === command.id);
    if (!packet) throw new WorkError('NOT_FOUND', 'Packet not found.');
    if (latestPacket(state, packet.taskId)?.id !== packet.id)
      throw new WorkError('CONFLICT', 'Open the latest packet revision.');
    if (command.type === 'packet.review') {
      const issues = packetIssues(state, packet, false);
      if (issues.length)
        throw new WorkError('BLOCKED', 'Resolve instruction gaps before review.', issues);
      packet.review = { at, by: actor.id };
    } else if (command.type === 'packet.confirm') {
      const requirement = packet.requirements.find((r) => r.id === command.requirementId);
      if (!packet.execution || !requirement || requirement.itemId)
        throw new WorkError(
          'VALIDATION',
          'Confirm a manual requirement in a connected work packet.',
        );
      if (!command.evidence.trim())
        throw new WorkError('VALIDATION', 'Record how the requirement was checked.');
      packet.confirmations = (packet.confirmations ?? []).filter(
        (c) => c.requirementId !== requirement.id || c.by !== actor.id,
      );
      if (packet.confirmations.length >= 2000)
        throw new WorkError('LIMIT', 'This packet supports 2,000 worker confirmations.');
      packet.confirmations.push({
        requirementId: requirement.id,
        available: command.available,
        evidence: command.evidence,
        at,
        by: actor.id,
      });
    } else {
      if (!packet.steps.some((s) => s.id === command.stepId))
        throw new WorkError('NOT_FOUND', 'Instruction step not found.');
      if (command.checked) {
        const issues = packetIssues(state, packet);
        if (issues.length)
          throw new WorkError(
            'BLOCKED',
            'Resolve instruction gaps before checking results.',
            issues,
          );
        const step = packet.steps.find((s) => s.id === command.stepId)!;
        if (packet.checks.some((c) => c.stepId === command.stepId))
          throw new WorkError(
            'CONFLICT',
            'Undo this result before replacing its evidence or decision.',
          );
        if (packet.execution) {
          const row = executionReadiness(state, packet, actor.id, issues, {
            externalAccess: true,
          }).find((s) => s.id === step.id)!;
          if (row.status !== 'ready')
            throw new WorkError(
              'BLOCKED',
              'Resolve this action’s prerequisites first.',
              row.blockers,
            );
          if (
            step.decision
              ? !step.decision.options.some((o) => o.id === command.choice)
              : command.choice !== undefined
          )
            throw new WorkError(
              'VALIDATION',
              'Select an available decision option only on a decision step.',
            );
          if (step.evidenceRequired && !command.evidence.trim())
            throw new WorkError('BLOCKED', 'Record the required result evidence.');
          for (const output of command.outputs ?? []) {
            if (
              !packet.execution.outputs.some(
                (o) => o.id === output.outputId && o.stepId === step.id,
              ) ||
              !data.assets?.some(
                (a) => a.id === output.assetId && a.taskIds.includes(packet.taskId),
              )
            )
              throw new WorkError(
                'VALIDATION',
                'Result files must match this action’s declared outputs and task.',
              );
          }
          for (const output of packet.execution.outputs.filter(
            (o) => o.required && o.stepId === step.id,
          ))
            if (!command.outputs?.some((o) => o.outputId === output.id))
              throw new WorkError('BLOCKED', `Attach the required output: ${output.label}.`);
        } else {
          const index = packet.steps.findIndex((s) => s.id === command.stepId);
          if (
            packet.steps.slice(0, index).some((s) => !packet.checks.some((c) => c.stepId === s.id))
          )
            throw new WorkError('BLOCKED', 'Check earlier results first.');
        }
      }
      packet.checks = packet.checks.filter((c) => c.stepId !== command.stepId);
      if (command.checked)
        packet.checks.push({
          stepId: command.stepId,
          at,
          by: actor.id,
          evidence: command.evidence,
          ...(command.choice ? { choice: command.choice } : {}),
          ...(command.outputs?.length ? { outputs: command.outputs } : {}),
        });
      else {
        const affected = dependentSteps(packet, command.stepId);
        packet.checks = packet.checks.filter((c) => !affected.has(c.stepId));
        const task = state.items.find((i) => i.id === packet.taskId);
        if (task?.status === 'done') {
          task.status = 'active';
          task.version++;
          task.updatedAt = at;
        }
      }
    }
  }
}
export function packetCompleteCommand(state: WorkState, packetId: string): Command {
  const packet = state.instructions?.packets.find((p) => p.id === packetId);
  if (!packet || latestPacket(state, packet.taskId)?.id !== packetId)
    throw new WorkError('NOT_FOUND', 'Latest packet not found.');
  if (packetIssues(state, packet).length || !packetResultsComplete(state, packet))
    throw new WorkError('BLOCKED', 'Review and check every instruction result first.');
  const task = state.items.find((i) => i.id === packet.taskId)!;
  return {
    type: 'item.update',
    id: task.id,
    expectedVersion: task.version,
    patch: { status: 'done' },
  };
}
export function packetResultsComplete(state: WorkState, packet: WorkPacket): boolean {
  if (!packet.execution)
    return packet.steps.every((s) => packet.checks.some((c) => c.stepId === s.id));
  return (
    packet.execution.completion.anyOf.some((id) => packet.checks.some((c) => c.stepId === id)) &&
    executionReadiness(state, packet, packet.createdBy, []).every(
      (s) => s.status === 'checked' || s.status === 'skipped',
    )
  );
}
/** A current action or a successful checked finish can proceed; future access is step-local.
 * Snapshot-only callers must supply file availability to establish that required bytes exist. */
export function packetActionable(
  state: WorkState,
  packet: WorkPacket,
  worker: WorkerContext = {},
): boolean {
  const issues = packetIssues(state, packet);
  if (issues.length) return false;
  const available = new Set(worker.environment?.availableAssetIds ?? []);
  const steps = executionReadiness(state, packet, worker.actorId ?? '', issues, {
    ...worker.environment,
    availableAssetIds: [...available],
  });
  if (packetResultsComplete(state, packet))
    return (
      !packet.execution ||
      steps.every(
        (step) =>
          step.status === 'skipped' ||
          [...requiredStepAssets(packet, step.id)].every((id) => available.has(id)),
      )
    );
  return steps.some((step) => step.status === 'ready');
}
