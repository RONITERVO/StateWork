#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openLocal, seedDemo } from '@statework/node';
import { textAdapter, defaultProfile, WorkError } from '@statework/sdk';
import type { Role } from '@statework/core';
const [op, ...args] = process.argv.slice(2);
const help = `StateWork — local work graph\n\n  list\n  create <workspace-id> <title>\n  demo\n  observe <workspace-id> [query.json]\n  snapshot <workspace-id>\n  instructions <workspace-id> <task-id>\n  handoff <workspace-id> <task-id> [environment.json]\n  files <workspace-id>\n  source <workspace-id> <source-id>\n  file-attach <workspace-id> <task-id> <file> [description]\n  file-export <workspace-id> <asset-id> <new-file>\n  file-restore <workspace-id> <asset-id> <original-file>\n  bundle-export <workspace-id> <new-file.json>\n  bundle-import <bundle.json> <new-workspace-id> <title>\n  command <workspace-id> <request.json|->\n  events <workspace-id> [after]\n  export <workspace-id> <new-file.json>\n  import <snapshot.json> <new-workspace-id> <title>\n  backup <new-file.sqlite>\n  grant <workspace-id> <actor-id> <reader|editor|owner>\n  token <actor-id> <label>\n\nSTATEWORK_HOME selects the local data directory. Commands and MCP use the same domain and database.\nToken/grant are trusted provisioning operations for developers with local filesystem access.\n`;
if (!op || op === 'help' || op === '--help') {
  process.stdout.write(help);
  process.exit(0);
}
const local = openLocal();
const actor = process.env.STATEWORK_TOKEN
  ? local.store.authenticate(process.env.STATEWORK_TOKEN)
  : 'local-owner';
const json = (path: string) => JSON.parse(readFileSync(path === '-' ? 0 : path, 'utf8')) as unknown;
const arg = (index: number) => {
  if (!args[index])
    throw new WorkError('VALIDATION', `Missing argument ${index + 1}. Run statework help.`);
  return args[index]!;
};
try {
  if (!actor) throw new WorkError('UNAUTHORIZED', 'Invalid token.');
  const connection = local.service.connect(actor);
  let result: unknown;
  switch (op) {
    case 'list':
      result = connection.list();
      break;
    case 'create':
      result = connection.create({ id: arg(0), title: arg(1) });
      break;
    case 'demo':
      seedDemo(connection);
      result = connection.list();
      break;
    case 'observe': {
      const observation = connection.observe(arg(0), { query: args[1] ? json(args[1]) : {} });
      process.stdout.write(textAdapter.render(observation, defaultProfile) + '\n');
      break;
    }
    case 'snapshot':
      result = connection.snapshot(arg(0));
      break;
    case 'instructions':
      result = connection.instructions(arg(0), arg(1));
      break;
    case 'handoff':
      result = connection.handoff(arg(0), arg(1), args[2] ? json(args[2]) : {});
      break;
    case 'files':
      result = connection.assetManifest(arg(0));
      break;
    case 'source':
      result = connection.source(arg(0), arg(1));
      break;
    case 'file-export': {
      const { asset, bytes } = connection.asset(arg(0), arg(1));
      writeFileSync(arg(2), bytes, { flag: 'wx', mode: 0o600 });
      result = { written: resolve(arg(2)), sha256: asset.sha256, size: bytes.byteLength };
      break;
    }
    case 'file-attach': {
      const workspaceId = arg(0),
        taskId = arg(1),
        path = resolve(arg(2));
      result = await connection.attach(
        workspaceId,
        {
          requestId: randomUUID(),
          expectedRevision: connection.snapshot(workspaceId).workspace.revision,
          asset: {
            id: randomUUID(),
            taskIds: [taskId],
            name: basename(path),
            mediaType: 'application/octet-stream',
            description: args[3] ?? '',
            locator: basename(path),
            replaces: null,
          },
        },
        new Uint8Array(readFileSync(path)),
      );
      break;
    }
    case 'file-restore':
      result = await connection.restoreAsset(arg(0), arg(1), new Uint8Array(readFileSync(arg(2))));
      break;
    case 'command':
      result = connection.execute(arg(0), json(arg(1)));
      break;
    case 'events':
      result = connection.events(arg(0), Number(args[1] ?? 0));
      break;
    case 'export':
      writeFileSync(arg(1), JSON.stringify(connection.export(arg(0)), null, 2) + '\n', {
        flag: 'wx',
        mode: 0o600,
      });
      result = { written: resolve(arg(1)) };
      break;
    case 'bundle-export':
      writeFileSync(arg(1), JSON.stringify(connection.exportBundle(arg(0))), {
        flag: 'wx',
        mode: 0o600,
      });
      result = { written: resolve(arg(1)) };
      break;
    case 'bundle-import':
      result = await connection.importBundle(json(arg(0)), { id: arg(1), title: arg(2) });
      break;
    case 'import':
      result = connection.import(json(arg(0)), { id: arg(1), title: arg(2) });
      break;
    case 'backup': {
      if (process.env.STATEWORK_TOKEN)
        throw new WorkError(
          'FORBIDDEN',
          'Backup requires the trusted local host, without STATEWORK_TOKEN.',
        );
      if (existsSync(arg(0))) throw new WorkError('CONFLICT', 'Backup destination already exists.');
      await local.store.backup(resolve(arg(0)));
      result = { written: resolve(arg(0)) };
      break;
    }
    case 'grant': {
      if (process.env.STATEWORK_TOKEN)
        throw new WorkError(
          'FORBIDDEN',
          'Provisioning requires the trusted local host, without STATEWORK_TOKEN.',
        );
      const role = arg(2);
      if (!['owner', 'editor', 'reader'].includes(role))
        throw new WorkError('VALIDATION', 'Unknown role.');
      local.service.connect(arg(1));
      local.store.grant(arg(0), arg(1), role as Role);
      result = { granted: true };
      break;
    }
    case 'token': {
      if (process.env.STATEWORK_TOKEN)
        throw new WorkError(
          'FORBIDDEN',
          'Provisioning requires the trusted local host, without STATEWORK_TOKEN.',
        );
      local.service.connect(arg(0));
      result = { token: local.store.issueToken(arg(0), arg(1)), actorId: arg(0) };
      break;
    }
    default:
      throw new WorkError('VALIDATION', `Unknown command: ${op}. Run statework help.`);
  }
  if (result !== undefined) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (error) {
  process.stderr.write(
    JSON.stringify(
      error instanceof WorkError
        ? { error: { code: error.code, message: error.message, details: error.details } }
        : {
            error: {
              code: 'ERROR',
              message: error instanceof Error ? error.message : String(error),
            },
          },
    ) + '\n',
  );
  process.exitCode = 1;
} finally {
  local.service.close();
}
