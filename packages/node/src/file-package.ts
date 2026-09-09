import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { FILE_LIMIT, WorkError, filePackageSchema, parse } from '@statework/sdk';
import type { WorkConnection } from '@statework/sdk';

export const FILE_PACKAGE_MANIFEST_LIMIT = 128 * 1024 * 1024;
export const FILE_PACKAGE_MANIFEST = 'manifest.json';

function ordinaryDirectory(path: string): string {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new WorkError(
      'VALIDATION',
      'Package directories must be ordinary directories, not links.',
    );
  return realpathSync(path);
}

/** Read an exact, bounded ordinary file without following a final symlink or growing allocation. */
function readBounded(path: string, limit: number): Uint8Array {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink())
    throw new WorkError('VALIDATION', 'Package entries must be ordinary files, not links.');
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino)
      throw new WorkError('VALIDATION', 'A package entry changed while being opened.');
    if (stat.size > limit) throw new WorkError('LIMIT', 'A package entry exceeds its byte limit.');
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) throw new WorkError('VALIDATION', 'A package entry was truncated.');
      offset += count;
    }
    if (readSync(fd, Buffer.alloc(1), 0, 1, offset) || fstatSync(fd).size !== stat.size)
      throw new WorkError('VALIDATION', 'A package entry changed while being read.');
    return bytes;
  } finally {
    closeSync(fd);
  }
}
/** Read one explicitly chosen local original within the supported per-file bound. */
export function readOriginalFile(path: string): Uint8Array {
  return readBounded(resolve(path), FILE_LIMIT);
}

function writeNew(path: string, bytes: string | Uint8Array): void {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Creates only a NEW directory. A package becomes importable when its manifest is committed last. */
export function exportFilePackage(
  connection: WorkConnection,
  workspaceId: string,
  directory: string,
) {
  const requested = resolve(directory);
  const parent = realpathSync(dirname(requested));
  const destination = join(parent, basename(requested));
  // Exclusive reservation prevents overwriting an existing directory, file or dangling symlink.
  mkdirSync(destination, { mode: 0o700 });
  const created = lstatSync(destination);
  try {
    mkdirSync(join(destination, 'blobs'), { mode: 0o700 });
    return connection.exportFilePackage(workspaceId, (manifest, read) => {
      let bytes = 0;
      for (const digest of manifest.files) {
        const content = read(digest);
        writeNew(join(destination, 'blobs', digest), content);
        bytes += content.byteLength;
      }
      const json = JSON.stringify(manifest);
      if (Buffer.byteLength(json) > FILE_PACKAGE_MANIFEST_LIMIT)
        throw new WorkError('LIMIT', 'The package manifest exceeds 128 MiB.');
      const temporary = join(destination, `.manifest-${randomUUID()}.tmp`);
      writeNew(temporary, json);
      renameSync(temporary, join(destination, FILE_PACKAGE_MANIFEST));
      return {
        directory: destination,
        files: manifest.files.length,
        bytes,
        missing: manifest.missing,
      };
    });
  } catch (error) {
    // Only remove the exact new directory owned by this operation, never a substituted link.
    const current = lstatSync(destination, { throwIfNoEntry: false });
    if (
      current?.isDirectory() &&
      !current.isSymbolicLink() &&
      current.dev === created.dev &&
      current.ino === created.ino &&
      realpathSync(destination) === destination
    )
      rmSync(destination, { recursive: true });
    throw error;
  }
}

/** Validate every original while inserting one file at a time in the new workspace transaction. */
export function importFilePackage(
  connection: WorkConnection,
  directory: string,
  target: { id: string; title: string },
) {
  const root = ordinaryDirectory(resolve(directory));
  const blobs = ordinaryDirectory(join(root, 'blobs'));
  if (blobs !== join(root, 'blobs'))
    throw new WorkError('VALIDATION', 'Package files must remain inside the package directory.');
  const manifest = parse(
    filePackageSchema,
    JSON.parse(
      Buffer.from(
        readBounded(join(root, FILE_PACKAGE_MANIFEST), FILE_PACKAGE_MANIFEST_LIMIT),
      ).toString('utf8'),
    ),
  );
  return connection.importFilePackage(manifest, target, {
    read(digest) {
      // Recheck the parent on every read; identifiers are already restricted to SHA-256 hex.
      if (ordinaryDirectory(join(root, 'blobs')) !== blobs)
        throw new WorkError('VALIDATION', 'The package directory changed during import.');
      return readBounded(join(blobs, digest), FILE_LIMIT);
    },
    digest: (bytes) => createHash('sha256').update(bytes).digest('hex'),
  });
}
