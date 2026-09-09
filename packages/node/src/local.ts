import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { WorkService } from '@statework/sdk';
import { SqliteStore } from './sqlite.js';
export function openLocal(directory = process.env.STATEWORK_HOME ?? '.statework') {
  const home = resolve(directory);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const quota = process.env.STATEWORK_WORKSPACE_FILE_LIMIT_BYTES;
  if (quota !== undefined && !/^[1-9]\d*$/.test(quota))
    throw new Error('STATEWORK_WORKSPACE_FILE_LIMIT_BYTES must be a positive integer byte count.');
  const store = new SqliteStore(
    join(home, 'statework.sqlite'),
    quota === undefined ? {} : { workspaceFileLimit: Number(quota) },
  );
  const tokenPath = join(home, 'local-token');
  let token: string;
  if (existsSync(tokenPath)) {
    token = readFileSync(tokenPath, 'utf8').trim();
    if (!store.authenticate(token)) {
      store.close();
      throw new Error(
        'Local token is invalid or revoked. Use a separate STATEWORK_HOME or restore the matching database and token.',
      );
    }
  } else {
    token = store.issueToken('local-owner', 'Local personal connection');
    writeFileSync(tokenPath, token + '\n', { mode: 0o600, flag: 'wx' });
  }
  return { home, store, token, tokenPath, service: new WorkService(store) };
}
