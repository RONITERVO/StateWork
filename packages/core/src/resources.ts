import { WorkError } from './model.js';
import type { Principal, WorkState } from './model.js';
import type { PacketInput, WorkPacket } from './instructions.js';

/** Exact original file identity. Bytes belong to the host store, never to event JSON. */
export interface AssetInput {
  id: string;
  /** Mutable organizational associations; identity, bytes and capture provenance stay fixed. */
  taskIds: string[];
  name: string;
  mediaType: string;
  size: number;
  sha256: string;
  description: string;
  locator: string;
  replaces: string | null;
}
export interface WorkAsset extends AssetInput {
  capturedAt: string;
  capturedBy: string;
  /** Reversible active-file disposition. Identity, original bytes and history are retained. */
  archive?: { at: string; by: string; reason: string };
}
export interface WorkReference {
  id: string;
  label: string;
  kind: 'source' | 'asset' | 'external';
  targetId: string | null;
  url: string;
  location: string;
  page: number | null;
  seconds: number | null;
  essential: boolean;
  purpose: 'instruction' | 'input' | 'example';
}
export function registerAsset(
  state: WorkState,
  asset: AssetInput,
  actor: Principal,
  at: string,
): void {
  const data = (state.instructions ??= { sources: [], packets: [] });
  const assets = (data.assets ??= []);
  if (assets.length >= 2000) throw new WorkError('LIMIT', 'This workspace supports 2,000 files.');
  if (assets.some((a) => a.id === asset.id))
    throw new WorkError('CONFLICT', 'File ID already exists.');
  if (assets.some((a) => a.sha256 === asset.sha256 && a.size !== asset.size))
    throw new WorkError('VALIDATION', 'A file digest cannot have conflicting sizes.');
  if (asset.taskIds.some((id) => !state.items.some((i) => i.id === id)))
    throw new WorkError('NOT_FOUND', 'File task is unavailable.');
  if (
    asset.replaces &&
    (!assets.some((a) => a.id === asset.replaces) ||
      assets.some((a) => a.replaces === asset.replaces))
  )
    throw new WorkError('CONFLICT', 'Replace the latest existing file revision.');
  assets.push({ ...asset, capturedAt: at, capturedBy: actor.id });
}

/** Every file explicitly used by a packet, including originals behind captured evidence. */
export function packetAssetIds(state: WorkState, packet: PacketInput | WorkPacket): Set<string> {
  const sourceIds = new Set(packet.sourceIds);
  const assetIds = new Set<string>();
  for (const part of [...packet.steps, ...packet.requirements, ...packet.questions])
    for (const citation of part.citations) sourceIds.add(citation.sourceId);
  for (const step of packet.steps)
    for (const reference of step.references ?? []) {
      if (!reference.targetId) continue;
      if (reference.kind === 'asset') assetIds.add(reference.targetId);
      if (reference.kind === 'source') sourceIds.add(reference.targetId);
    }
  for (const source of state.instructions?.sources ?? [])
    if (source.assetId && sourceIds.has(source.id)) assetIds.add(source.assetId);
  if ('checks' in packet)
    for (const check of packet.checks)
      for (const output of check.outputs ?? []) assetIds.add(output.assetId);
  return assetIds;
}

export function archiveAsset(
  state: WorkState,
  id: string,
  archived: boolean,
  reason: string,
  actor: Principal,
  at: string,
): void {
  const asset = state.instructions?.assets?.find((a) => a.id === id);
  if (!asset) throw new WorkError('NOT_FOUND', 'File is unavailable to this workspace.');
  if (archived) {
    const latest = new Map((state.instructions?.packets ?? []).map((p) => [p.taskId, p]));
    const packetIds = [...latest.values()]
      .filter((packet) => packetAssetIds(state, packet).has(id))
      .map((packet) => packet.id);
    if (packetIds.length)
      throw new WorkError(
        'BLOCKED',
        'This file is used by current instructions or results. Revise those references before archiving it.',
        { assetId: id, packetIds },
      );
    asset.archive ??= { at, by: actor.id, reason };
  } else delete asset.archive;
}

/** Move organizational associations without replacing originals or rewriting packet history. */
export function relinkAsset(state: WorkState, id: string, taskIds: string[]): void {
  const asset = state.instructions?.assets?.find((a) => a.id === id);
  if (!asset) throw new WorkError('NOT_FOUND', 'File is unavailable to this workspace.');
  if (taskIds.some((taskId) => !state.items.some((item) => item.id === taskId)))
    throw new WorkError('NOT_FOUND', 'File task is unavailable.');
  const packetIds = (state.instructions?.packets ?? [])
    .filter(
      (packet) =>
        !taskIds.includes(packet.taskId) &&
        packet.checks.some((check) => check.outputs?.some((output) => output.assetId === id)),
    )
    .map((packet) => packet.id);
  if (packetIds.length)
    throw new WorkError(
      'BLOCKED',
      'Keep the task associations used by recorded result files, including earlier packet revisions.',
      { assetId: id, packetIds },
    );
  asset.taskIds = [...taskIds];
}

/** Same stable address for every UI; locators do not authorize external actions. */
export function workDeepLink(workspaceId: string, taskId: string, stepId?: string): string {
  return `/instructions/?workspace=${encodeURIComponent(workspaceId)}&task=${encodeURIComponent(taskId)}${stepId ? `&step=${encodeURIComponent(stepId)}` : ''}`;
}
