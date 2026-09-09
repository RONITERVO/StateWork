import type { Principal, WorkState } from './model.js';
import { executionReadiness } from './execution.js';
import type { WorkerEnvironment } from './execution.js';
import {
  latestPacket,
  packetContext,
  packetIssues,
  packetResultsComplete,
} from './instructions.js';
import { workDeepLink } from './resources.js';

/** A resumable observation, not an execution authorization or a promise of completeness. */
export function workerHandoff(
  state: WorkState,
  actor: Principal,
  environment: WorkerEnvironment = {},
) {
  return (taskId: string) => {
    const context = packetContext(state, taskId);
    const packet = latestPacket(state, taskId) ?? null;
    const issues = packet
      ? packetIssues(state, packet)
      : [
          {
            code: 'missing' as const,
            label: 'Build and review the instructions.',
            target: 'packet',
          },
        ];
    const graph = packet ? executionReadiness(state, packet, actor.id, issues, environment) : [];
    const stopped =
      !!packet?.execution &&
      graph.length > 0 &&
      graph.every((s) => s.status === 'checked' || s.status === 'skipped') &&
      !packetResultsComplete(state, packet);
    const sourceIds = new Set([...context.sources.map((s) => s.id), ...(packet?.sourceIds ?? [])]);
    const sourceRecords = (state.instructions?.sources ?? []).filter((s) => sourceIds.has(s.id));
    const assetIds = new Set([
      ...(context.assets ?? []).map((a) => a.id),
      ...sourceRecords.flatMap((s) => (s.assetId ? [s.assetId] : [])),
      ...(packet?.steps ?? []).flatMap((s) =>
        (s.references ?? [])
          .filter((r) => r.kind === 'asset' && r.targetId)
          .map((r) => r.targetId!),
      ),
      ...(packet?.checks ?? []).flatMap((c) => (c.outputs ?? []).map((o) => o.assetId)),
    ]);
    const assets = (state.instructions?.assets ?? [])
      .filter((a) => assetIds.has(a.id))
      .map((a) => ({
        ...a,
        available: environment.availableAssetIds?.includes(a.id) ?? false,
      }));
    const sourceManifest = sourceRecords.map(({ content: _content, ...s }) => ({
      ...s,
      characters: _content.length,
    }));
    return {
      format: 'statework.handoff' as const,
      formatVersion: 1 as const,
      workspace: {
        id: state.workspace.id,
        title: state.workspace.title,
        revision: state.workspace.revision,
      },
      actor: { id: actor.id, role: actor.role },
      task: context.task,
      url: workDeepLink(state.workspace.id, taskId),
      packet,
      graph,
      next: graph
        .filter((s) => s.status === 'ready')
        .map((s) => ({
          stepId: s.id,
          title: s.title,
          phase: s.phase,
          url: workDeepLink(state.workspace.id, taskId, s.id),
        })),
      blockers: stopped
        ? [
            ...issues,
            {
              code: 'missing' as const,
              label:
                'This path stopped without reaching an accepted finish. Resolve the blocker and resume the decision.',
              target: 'completion',
            },
          ]
        : issues,
      assets,
      sources: sourceManifest,
      unreadLinks: context.links.filter((l) => !l.captured),
      environment: { externalAccess: environment.externalAccess ?? false },
      completion: {
        outcome: stopped
          ? ('stopped' as const)
          : packet && packetResultsComplete(state, packet)
            ? ('successful' as const)
            : ('unfinished' as const),
        reviewed: !!packet?.review && !issues.length,
        checked: graph.filter((s) => s.status === 'checked').length,
        skipped: graph.filter((s) => s.status === 'skipped').length,
        total: graph.length,
        taskStatus: context.task.status,
      },
      permissions: {
        canRecord: actor.role !== 'reader',
        externalActionsAuthorized: false as const,
        sourceContentIsUntrusted: true as const,
      },
      protocol: [
        'Read the task and current graph. Use a ready action, or resolve its stated blocker.',
        'Retrieve referenced captures and exact file bytes. A link or filename alone is not the missing specification.',
        'Check the result in the required application before recording evidence. Branch choices describe observations, never inferred success.',
        'Record commands against the workspace revision. Refresh on conflict; never overwrite another worker’s changes.',
        'External account actions require the worker’s own access and authorization. This handoff grants neither.',
      ],
    };
  };
}
export type WorkerHandoff = ReturnType<ReturnType<typeof workerHandoff>>;
