import { isFinished, WorkError } from './model.js';
import type { WorkState } from './model.js';
import type { PacketInput, PacketIssue, PacketStep, WorkPacket } from './instructions.js';

export interface StepDecision {
  prompt: string;
  options: { id: string; label: string }[];
}
export interface ExecutionContract {
  version: 1;
  /** At least one declared successful finish must be checked; a stopped branch is not success. */
  completion: { anyOf: string[] };
  coverage: {
    inputs: 'unknown' | 'checked';
    procedure: 'unknown' | 'checked';
    acceptance: 'unknown' | 'checked';
    note: string;
  };
  outputs: { id: string; label: string; description: string; stepId: string; required: boolean }[];
}
export interface RequirementConfirmation {
  requirementId: string;
  available: boolean;
  evidence: string;
  at: string;
  by: string;
}
export type StepStatus = 'ready' | 'blocked' | 'waiting' | 'checked' | 'skipped';
export interface StepReadiness {
  id: string;
  title: string;
  phase: NonNullable<PacketStep['phase']>;
  status: StepStatus;
  after: string[];
  blockers: { code: string; label: string; target: string; action: string; url: string }[];
}
export interface WorkerEnvironment {
  /** Only this call's declaration. It never grants access or persists a confirmation. */
  externalAccess?: boolean;
  availableAssetIds?: string[];
}
/** Read-only caller context; an omitted worker never inherits another person's access. */
export interface WorkerContext {
  actorId?: string;
  environment?: WorkerEnvironment;
}
export function stepPredecessors(packet: PacketInput, step: PacketStep): string[] {
  const index = packet.steps.findIndex((s) => s.id === step.id);
  const after = packet.execution
    ? (step.after ?? (index > 0 ? [packet.steps[index - 1]!.id] : []))
    : index > 0
      ? [packet.steps[index - 1]!.id]
      : [];
  return [...new Set([...after, ...(step.when ? [step.when.stepId] : [])])];
}
/** Files needed by this action: its original references and results on its dependency path. */
export function requiredStepAssets(packet: WorkPacket, stepId: string): Set<string> {
  const ancestors = new Set([stepId]);
  const queue = [stepId];
  for (let i = 0; i < queue.length; i++) {
    const step = packet.steps.find((s) => s.id === queue[i]);
    if (!step) continue;
    for (const parent of stepPredecessors(packet, step))
      if (!ancestors.has(parent)) {
        ancestors.add(parent);
        queue.push(parent);
      }
  }
  return new Set([
    ...(packet.steps.find((s) => s.id === stepId)?.references ?? [])
      .filter((r) => r.essential && r.kind === 'asset' && r.targetId)
      .map((r) => r.targetId!),
    ...packet.checks
      .filter((c) => ancestors.has(c.stepId))
      .flatMap((c) => (c.outputs ?? []).map((o) => o.assetId)),
  ]);
}
/** Graph validity is enforced even for drafts; missing facts remain editable gaps. */
export function validateExecution(packet: PacketInput, state?: WorkState): void {
  const ids = new Set(packet.steps.map((s) => s.id));
  const visited = new Set<string>(),
    active = new Set<string>();
  const visit = (step: PacketStep) => {
    if (active.has(step.id)) throw new WorkError('CYCLE', 'Instruction order contains a cycle.');
    if (visited.has(step.id)) return;
    active.add(step.id);
    for (const id of stepPredecessors(packet, step)) {
      if (!ids.has(id))
        throw new WorkError('VALIDATION', 'Instruction order references an unknown step.');
      visit(packet.steps.find((s) => s.id === id)!);
    }
    if (
      step.when &&
      !packet.steps
        .find((s) => s.id === step.when!.stepId)
        ?.decision?.options.some((o) => o.id === step.when!.optionId)
    )
      throw new WorkError('VALIDATION', 'Conditional step references an unknown decision option.');
    active.delete(step.id);
    visited.add(step.id);
  };
  packet.steps.forEach(visit);
  if (
    !packet.execution &&
    packet.steps.some((s) => s.after || s.when || s.decision || s.references?.length)
  )
    throw new WorkError(
      'VALIDATION',
      'Enable the versioned execution contract before using graph steps or references.',
    );
  for (const output of packet.execution?.outputs ?? [])
    if (!ids.has(output.stepId))
      throw new WorkError('VALIDATION', 'Output references an unknown step.');
  for (const id of packet.execution?.completion.anyOf ?? [])
    if (!ids.has(id))
      throw new WorkError('VALIDATION', 'Successful finish references an unknown step.');
  for (const r of packet.requirements) {
    if (r.itemId === packet.taskId)
      throw new WorkError('CYCLE', 'A task cannot require its own completion.');
    if (state && r.itemId) {
      // A prerequisite cannot be an ancestor container or a task that depends on this task.
      const blocked = new Set([packet.taskId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const edge of state.relations)
          if (
            ((edge.kind === 'contains' && blocked.has(edge.to)) ||
              (edge.kind === 'depends_on' && blocked.has(edge.to))) &&
            !blocked.has(edge.from)
          ) {
            blocked.add(edge.from);
            changed = true;
          }
      }
      if (blocked.has(r.itemId))
        throw new WorkError(
          'CYCLE',
          'A prerequisite cannot require an enclosing project or dependent task.',
        );
    }
  }
}
export function executionIssues(state: WorkState, packet: PacketInput): PacketIssue[] {
  const issues: PacketIssue[] = [];
  if (!packet.execution) return issues;
  const add = (code: PacketIssue['code'], label: string, target: string) =>
    issues.push({ code, label, target });
  if (!packet.execution.completion.anyOf.length)
    add('missing', 'Choose the action that establishes a successful finish.', 'completion');
  for (const key of ['inputs', 'procedure', 'acceptance'] as const)
    if (packet.execution.coverage[key] !== 'checked')
      add('missing', `Check ${key} coverage.`, `coverage-${key}`);
  if (!packet.execution.coverage.note.trim())
    add('missing', 'Record what was checked and any limits.', 'coverage');
  const assets = state.instructions?.assets ?? [];
  const sources = state.instructions?.sources ?? [];
  for (const step of packet.steps) {
    if (step.decision && (!step.decision.prompt.trim() || step.decision.options.length < 2))
      add('missing', 'Define the decision and its alternatives.', step.id);
    for (const ref of step.references ?? []) {
      if (ref.kind === 'asset') {
        const asset = assets.find((a) => a.id === ref.targetId);
        if (!asset) add('source', `${ref.label}: attach the original file.`, step.id);
        else if (assets.some((a) => a.replaces === asset.id))
          add('stale', `${ref.label}: a newer file is available.`, step.id);
      } else if (ref.kind === 'source') {
        if (
          !sources.some((s) => s.id === ref.targetId) ||
          !packet.sourceIds.includes(ref.targetId ?? '')
        )
          add('source', `${ref.label}: capture the reference.`, step.id);
      } else if (!ref.url) add('source', `${ref.label}: provide the destination.`, step.id);
      if (!ref.location.trim())
        add(
          'missing',
          `${ref.label}: identify the relevant page, section or file contents.`,
          step.id,
        );
    }
  }
  for (const output of packet.execution.outputs)
    if (!output.description.trim())
      add(
        'missing',
        `${output.label}: define the required file and acceptance criteria.`,
        output.id,
      );
  return issues;
}
export function executionReadiness(
  state: WorkState,
  packet: WorkPacket,
  actorId: string,
  procedureIssues: PacketIssue[],
  environment: WorkerEnvironment = {},
): StepReadiness[] {
  if (packet.execution) validateExecution(packet);
  const rows = new Map<string, StepReadiness>();
  const checks = new Map(packet.checks.map((c) => [c.stepId, c]));
  const read = (step: PacketStep): StepReadiness => {
    if (rows.has(step.id)) return rows.get(step.id)!;
    const after = stepPredecessors(packet, step);
    const predecessors = after.map((id) => read(packet.steps.find((s) => s.id === id)!));
    const row: StepReadiness = {
      id: step.id,
      title: step.title,
      phase: step.phase ?? 'work',
      status: 'ready',
      after,
      blockers: [],
    };
    rows.set(step.id, row);
    const decision = step.when ? checks.get(step.when.stepId) : undefined;
    if (
      (step.when && decision && decision.choice !== step.when.optionId) ||
      (predecessors.length > 0 && predecessors.every((p) => p.status === 'skipped'))
    ) {
      row.status = 'skipped';
      return row;
    }
    if (checks.has(step.id)) {
      row.status = 'checked';
      return row;
    }
    if (procedureIssues.length) {
      row.status = 'blocked';
      row.blockers.push({
        code: 'instructions',
        label: 'Review the work instructions.',
        target: 'packet',
        action: 'Resolve the listed evidence and procedure gaps.',
        url: '',
      });
      return row;
    }
    if (predecessors.some((p) => p.status !== 'checked' && p.status !== 'skipped')) {
      row.status = 'waiting';
      row.blockers.push({
        code: 'order',
        label: 'Earlier results needed.',
        target: step.id,
        action: 'Finish the connected earlier actions.',
        url: '',
      });
      return row;
    }
    // Requirements explicitly assigned to actions are local; unassigned requirements apply globally.
    const assigned = new Set(packet.steps.flatMap((s) => s.requires));
    for (const r of packet.requirements.filter(
      (r) => !assigned.has(r.id) || step.requires.includes(r.id),
    )) {
      const confirmation = packet.confirmations
        ?.filter((c) => c.requirementId === r.id && (r.scope === 'workspace' || c.by === actorId))
        .at(-1);
      const available = r.itemId
        ? state.items.some((i) => i.id === r.itemId && isFinished(i))
        : packet.execution
          ? !!confirmation?.available
          : r.confirmed;
      if (!available)
        row.blockers.push({
          code: 'requirement',
          label: r.label,
          target: r.id,
          action: r.detail,
          url: r.url,
        });
    }
    for (const ref of step.references ?? []) {
      if (!ref.essential) continue;
      if (ref.kind === 'external' && !environment.externalAccess)
        row.blockers.push({
          code: 'access',
          label: ref.label,
          target: ref.id,
          action: 'Attach the required contents or confirm access in the worker environment.',
          url: ref.url,
        });
    }
    for (const assetId of requiredStepAssets(packet, step.id)) {
      if (environment.availableAssetIds && !environment.availableAssetIds.includes(assetId))
        row.blockers.push({
          code: 'file',
          label:
            step.references?.find((r) => r.kind === 'asset' && r.targetId === assetId)?.label ??
            state.instructions?.assets?.find((a) => a.id === assetId)?.name ??
            'Required result file',
          target: assetId,
          action: 'Restore or attach the exact original file or earlier result.',
          url: '',
        });
    }
    if (row.blockers.length) row.status = 'blocked';
    return row;
  };
  return packet.steps.map(read);
}
export function dependentSteps(packet: PacketInput, stepId: string): Set<string> {
  const affected = new Set([stepId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of packet.steps)
      if (!affected.has(step.id) && stepPredecessors(packet, step).some((id) => affected.has(id))) {
        affected.add(step.id);
        changed = true;
      }
  }
  return affected;
}
