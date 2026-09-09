import { it, expect, afterEach } from 'vitest';
import {
  MemoryStore,
  WorkService,
  blankPacket,
  parse,
  instructionResultSchema,
} from '@statework/sdk';
import { createServer } from '@statework/server';
import type { PacketAssistant } from '@statework/node';
const apps: Awaited<ReturnType<typeof createServer>>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
it('imports portable source-rich snapshots above the normal command body limit', async () => {
  const { app, c, headers } = await setup();
  for (let i = 0; i < 8; i++)
    c.execute('w', {
      schemaVersion: 1,
      requestId: `source-${i}`,
      expectedRevision: c.snapshot('w').workspace.revision,
      commands: [
        {
          type: 'source.capture',
          source: {
            id: `source-${i}`,
            taskIds: ['task'],
            title: `Section ${i}`,
            locator: `Handbook ${i}`,
            content: 'Evidence '.repeat(18000),
            kind: 'note',
            coverage: 'complete',
            replaces: null,
          },
        },
      ],
    });
  const snapshot = c.export('w');
  expect(JSON.stringify(snapshot).length).toBeGreaterThan(1_048_576);
  const imported = await app.inject({
    method: 'POST',
    url: '/v1/import',
    headers: headers(),
    payload: { snapshot, target: { id: 'copy', title: 'Copy' } },
  });
  expect(imported.statusCode).toBe(201);
  expect(imported.json().instructions.sources).toHaveLength(8);
});
async function setup(assistant?: PacketAssistant) {
  const store = new MemoryStore(),
    service = new WorkService(store),
    c = service.connect('owner');
  c.create({ id: 'w', title: 'Workshop' });
  c.execute('w', {
    schemaVersion: 1,
    requestId: 'seed',
    expectedRevision: 0,
    commands: [{ type: 'item.create', item: { id: 'task', kind: 'task', title: 'Count bolts' } }],
  });
  store.grant('w', 'reader', 'reader');
  store.grant('w', 'second', 'editor');
  const app = await createServer({
    service,
    authenticate: (t) => (['owner', 'reader', 'second'].includes(t) ? t : undefined),
    packetAssistant: assistant,
  });
  apps.push(app);
  const headers = (actor = 'owner') => ({
    host: '127.0.0.1:4180',
    authorization: `Bearer ${actor}`,
  });
  return { app, c, headers };
}
it('publishes read-only context and research brief and enforces source/assistant roles', async () => {
  const { app, c, headers } = await setup();
  const before = c.snapshot('w');
  const result = await app.inject({
    url: '/v1/workspaces/w/instructions/task',
    headers: headers('reader'),
  });
  expect(result.statusCode).toBe(200);
  expect(parse(instructionResultSchema, result.json()).context.task.id).toBe('task');
  expect(
    (
      await app.inject({ url: '/v1/workspaces/w/instructions/task/prompt', headers: headers() })
    ).json().prompt,
  ).toContain('authorized connectors');
  expect(
    (await app.inject({ url: '/v1/workspaces/w/assistant', headers: headers() })).json().available,
  ).toBe(false);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/workspaces/w/instructions/task/draft',
        headers: headers(),
      })
    ).statusCode,
  ).toBe(404);
  for (const url of [
    '/v1/workspaces/w/instructions/task/draft',
    '/v1/workspaces/w/sources/extract',
    '/v1/workspaces/w/sources/fetch',
  ])
    expect(
      (await app.inject({ method: 'POST', url, headers: headers('reader'), payload: {} }))
        .statusCode,
    ).toBe(403);
  expect(c.snapshot('w')).toEqual(before);
});
it('returns drafts without changing work, isolates jobs by actor and cancels safely', async () => {
  let resolve: ((v: ReturnType<typeof blankPacket>) => void) | undefined;
  let signal: AbortSignal | undefined;
  const assistant: PacketAssistant = {
    status: () => ({ available: true, name: 'Fixture', message: 'Fixture' }),
    draft: (_context, s) => {
      signal = s;
      return new Promise((res) => {
        resolve = res;
      });
    },
  };
  const { app, c, headers } = await setup(assistant);
  const before = c.snapshot('w');
  const started = await app.inject({
    method: 'POST',
    url: '/v1/workspaces/w/instructions/task/draft',
    headers: headers(),
  });
  expect(started.statusCode).toBe(202);
  const id = started.json().id;
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/workspaces/w/instructions/task/draft',
        headers: headers(),
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (await app.inject({ url: `/v1/workspaces/w/drafts/${id}`, headers: headers('second') }))
      .statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: `/v1/workspaces/w/drafts/${id}`,
        headers: headers(),
      })
    ).json().state,
  ).toBe('cancelled');
  expect(signal?.aborted).toBe(true);
  resolve!(blankPacket(before, 'task', 'draft'));
  await Promise.resolve();
  expect(
    (await app.inject({ url: `/v1/workspaces/w/drafts/${id}`, headers: headers() })).json().packet,
  ).toBeNull();
  expect(c.snapshot('w')).toEqual(before);
});
it('surfaces failed jobs and validates local source extraction without saving', async () => {
  const assistant: PacketAssistant = {
    status: () => ({ available: true, name: 'Fixture', message: 'Fixture' }),
    draft: async () => {
      throw new Error('private backend details');
    },
  };
  const { app, c, headers } = await setup(assistant);
  const before = c.snapshot('w');
  const started = await app.inject({
    method: 'POST',
    url: '/v1/workspaces/w/instructions/task/draft',
    headers: headers(),
  });
  await Promise.resolve();
  const result = await app.inject({
    url: `/v1/workspaces/w/drafts/${started.json().id}`,
    headers: headers(),
  });
  expect(result.json().state).toBe('failed');
  expect(result.json().error).not.toContain('private backend');
  const extracted = await app.inject({
    method: 'POST',
    url: '/v1/workspaces/w/sources/extract',
    headers: headers(),
    payload: { name: 'work.txt', base64: Buffer.from('Count two bolts.').toString('base64') },
  });
  expect(extracted.statusCode).toBe(200);
  expect(extracted.json().content).toBe('Count two bolts.');
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/workspaces/w/sources/extract',
        headers: headers(),
        payload: { name: 'work.txt', base64: '???' },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/workspaces/w/sources/fetch',
        headers: headers(),
        payload: { url: 'http://127.0.0.1/' },
      })
    ).statusCode,
  ).toBe(403);
  expect(c.snapshot('w')).toEqual(before);
});
