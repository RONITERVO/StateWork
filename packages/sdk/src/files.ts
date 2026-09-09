import { WorkError } from '@statework/core';

export const FILE_LIMIT = 128 * 1024 * 1024;
export const WORKSPACE_FILE_LIMIT = 2 * 1024 * 1024 * 1024;
/** The original JSON format stays bounded independently of local storage. */
export const INLINE_FILE_LIMIT = 64 * 1024 * 1024;
export const INLINE_BUNDLE_LIMIT = 256 * 1024 * 1024;
export const FILE_BASE64_LIMIT = Math.ceil(FILE_LIMIT / 3) * 4;
export const INLINE_BASE64_LIMIT = Math.ceil(INLINE_FILE_LIMIT / 3) * 4;
export const FILE_PACKAGE_HELP =
  'Inline JSON bundles support 64 MiB per file and 256 MiB total. Use package-export and package-import for a portable directory containing every original file.';
export interface FileStorageOptions {
  /** Trusted host quota for unique stored bytes; never read from workspace data. */
  workspaceFileLimit?: number;
}
export function fileStorageLimits(options: FileStorageOptions = {}) {
  const workspaceBytes = options.workspaceFileLimit ?? WORKSPACE_FILE_LIMIT;
  if (
    !Number.isSafeInteger(workspaceBytes) ||
    workspaceBytes < 1 ||
    workspaceBytes > 64 * 1024 ** 3
  )
    throw new WorkError(
      'VALIDATION',
      'Workspace file quota must be an integer from 1 byte to 64 GiB.',
    );
  return Object.freeze({ fileBytes: FILE_LIMIT, workspaceBytes });
}
export function encodeFile(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function decodeFile(value: string): Uint8Array {
  if (value.length > Math.ceil(FILE_LIMIT / 3) * 4)
    throw new WorkError('LIMIT', 'File exceeds 128 MiB.');
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
