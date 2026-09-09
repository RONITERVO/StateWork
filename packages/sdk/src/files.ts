import { WorkError } from '@statework/core';

export const FILE_LIMIT = 64 * 1024 * 1024;
export const WORKSPACE_FILE_LIMIT = 256 * 1024 * 1024;
export function encodeFile(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function decodeFile(value: string): Uint8Array {
  if (value.length > Math.ceil(FILE_LIMIT / 3) * 4)
    throw new WorkError('LIMIT', 'File exceeds 64 MiB.');
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new WorkError('VALIDATION', 'File encoding is invalid.');
  }
  if (btoa(binary) !== value || binary.length > FILE_LIMIT)
    throw new WorkError('VALIDATION', 'File encoding or size is invalid.');
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
export async function fileDigest(bytes: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))),
    (n) => n.toString(16).padStart(2, '0'),
  ).join('');
}
