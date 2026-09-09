import { WorkError } from './model.js';
import type { Principal, WorkState } from './model.js';

/** Immutable file identity. Bytes belong to the host store, never to event JSON. */
export interface AssetInput {
  id: string;
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

/** Same stable address for every UI; locators do not authorize external actions. */
export function workDeepLink(workspaceId: string, taskId: string, stepId?: string): string {
  return `/instructions/?workspace=${encodeURIComponent(workspaceId)}&task=${encodeURIComponent(taskId)}${stepId ? `&step=${encodeURIComponent(stepId)}` : ''}`;
}
