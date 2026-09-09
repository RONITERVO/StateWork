import { describe, it, expect, afterEach } from 'vitest';
import {
  MemoryStore,
  WorkService,
  parse,
  workspaceListSchema,
  commandResultSchema,
  observationResultSchema,
  snapshotSchema,
  workPlanSchema,
} from '@statework/sdk';
import { createServer, openapi } from '@statework/server';
const apps: Awaited<ReturnType<typeof createServer>>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
const token = 'test-local-owner-token-012345678901234567890';
const host = { host: '127.0.0.1:4180' };
const headers = { ...host, authorization: `Bearer ${token}` };
async function setup() {
  const store = new MemoryStore(),
    service = new WorkService(store);
  const app = await createServer({
    service,
    authenticate: (t) =>
      t === token
        ? 'owner'
        : t === 'reader-token-012345678901234567890123456'
          ? 'reader'
          : undefined,
    localToken: token,
  });
  apps.push(app);
  return { app, store, service };
}
describe('local HTTP boundary', () => {
  it('enforces a trusted host traffic budget and rejects invalid configuration', async () => {
    const service = new WorkService(new MemoryStore());
    const app = await createServer({
      service,
      authenticate: () => undefined,
      requestsPerMinute: 2,
    });
    apps.push(app);
    expect((await app.inject({ url: '/health', headers: host })).statusCode).toBe(200);
    expect((await app.inject({ url: '/health', headers: host })).statusCode).toBe(200);
    const limited = await app.inject({ url: '/health', headers: host });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.message).toContain('Too many requests');
    await expect(
      createServer({ service, authenticate: () => undefined, requestsPerMinute: 0 }),
    ).rejects.toThrow('request budget');
  });
  it('offers an authenticated read-only plan, with strict options and no history changes', async () => {
    const { app, service, store } = await setup();
    const owner = service.connect('owner');
    owner.create({ id: 'plan', title: 'Plan' });
    owner.execute('plan', {
      schemaVersion: 1,
      requestId: 'seed-plan',
      expectedRevision: 0,
      commands: [{ type: 'item.create', item: { id: 'a', title: 'A', kind: 'task' } }],
    });
    store.grant('plan', 'reader', 'reader');
    const before = owner.snapshot('plan'),
      events = owner.events('plan');
    const payload = { now: '2026-09-09T08:00:00.000Z', timeZone: 'Europe/Helsinki' };
    const request = { method: 'POST' as const, url: '/v1/workspaces/plan/plan', payload };
    expect((await app.inject({ ...request, headers: host })).statusCode).toBe(401);
    const response = await app.inject({
      ...request,
      headers: { ...host, authorization: 'Bearer reader-token-012345678901234567890123456' },
    });
    expect(response.statusCode).toBe(200);
    expect(parse(workPlanSchema, response.json()).days[0]!.suggestions[0]!.id).toBe('a');
    expect(
      (await app.inject({ ...request, headers, payload: { ...payload, days: 91 } })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ ...request, headers, payload: { ...payload, actorId: 'owner' } }))
        .statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ ...request, headers, url: '/v1/workspaces/missing/plan' })).statusCode,
    ).toBe(404);
    expect(owner.snapshot('plan')).toEqual(before);
    expect(owner.events('plan')).toEqual(events);
  });
  it('requires auth and rejects cross-origin requests, DNS rebinding and unsafe bootstrap', async () => {
    const { app } = await setup();
    expect((await app.inject({ url: '/v1/workspaces', headers: host })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: '/v1/workspaces',
          headers: { ...headers, origin: 'https://evil.example' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: '/health', headers: { host: 'evil.example:4180' } })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url: '/local/session', headers: host })).statusCode,
    ).toBe(403);
    const session = await app.inject({
      method: 'POST',
      url: '/local/session',
      headers: {
        ...host,
        origin: 'http://127.0.0.1:4180',
        'sec-fetch-site': 'same-origin',
        'x-statework-local': '1',
      },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().token).toBe(token);
    expect(session.headers['cache-control']).toBe('no-store');
  });
  it('runs the full API loop including retries, errors, observations and isolated imports', async () => {
    const { app } = await setup();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/workspaces',
          headers,
          payload: { id: 'work', title: 'My work' },
        })
      ).statusCode,
    ).toBe(201);
    const payload = {
      schemaVersion: 1,
      requestId: 'r',
      expectedRevision: 0,
      commands: [{ type: 'item.create', item: { id: 'a', kind: 'task', title: 'A' } }],
    };
    const first = await app.inject({
      method: 'POST',
      url: '/v1/workspaces/work/commands',
      headers,
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(() => parse(commandResultSchema, first.json())).not.toThrow();
    expect(
      (
        await app.inject({ method: 'POST', url: '/v1/workspaces/work/commands', headers, payload })
      ).json(),
    ).toEqual(first.json());
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/workspaces/work/commands',
          headers,
          payload: { ...payload, requestId: 'stale' },
        })
      ).statusCode,
    ).toBe(409);
    const obs = await app.inject({
      method: 'POST',
      url: '/v1/workspaces/work/observe',
      headers,
      payload: { query: { actionable: true } },
    });
    expect(obs.json().nodes[0].label).toBe('A');
    expect(() => parse(observationResultSchema, obs.json())).not.toThrow();
    const snapshot = (await app.inject({ url: '/v1/workspaces/work/export', headers })).json();
    expect(() => parse(snapshotSchema, snapshot)).not.toThrow();
    const list = (await app.inject({ url: '/v1/workspaces', headers })).json();
    expect(() => parse(workspaceListSchema, list)).not.toThrow();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/import',
          headers,
          payload: { snapshot, target: { id: 'copy', title: 'Copy' } },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await app.inject({ url: '/v1/workspaces/work/events?after=-1', headers })).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/workspaces/work/commands',
          headers,
          payload: { ...payload, actorId: 'owner' },
        })
      ).statusCode,
    ).toBe(400);
    expect((await app.inject({ url: '/v1/workspaces/missing', headers })).statusCode).toBe(404);
  });
  it('prevents readers and unauthenticated malformed paths from mutating', async () => {
    const { app, store, service } = await setup();
    service.connect('owner').create({ id: 'work', title: 'Work' });
    store.grant('work', 'reader', 'reader');
    const r = await app.inject({
      method: 'POST',
      url: '/v1/workspaces/work/commands',
      headers: { ...host, authorization: 'Bearer reader-token-012345678901234567890123456' },
      payload: {
        schemaVersion: 1,
        requestId: 'r',
        expectedRevision: 0,
        commands: [{ type: 'workspace.rename', title: 'Bad' }],
      },
    });
    expect(r.statusCode).toBe(403);
    expect((await app.inject({ url: '/v1/workspaces/work', headers: host })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/workspaces/work/commands',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: '{bad',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/workspaces',
          headers,
          payload: { id: 'large', title: 'x'.repeat(1_100_000) },
        })
      ).statusCode,
    ).toBe(413);
  });
  it('publishes a versioned OpenAPI contract covering each public operation', () => {
    const spec = openapi();
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths)).toHaveLength(8);
    expect(spec.components.schemas.CommandRequest).toHaveProperty('properties');
    const walk = (node: unknown): void => {
      if (node && typeof node === 'object')
        for (const [key, value] of Object.entries(node)) {
          if (key === '$ref' && typeof value === 'string' && value.startsWith('#/')) {
            let target: unknown = spec;
            for (const segment of value.slice(2).split('/'))
              target = (target as Record<string, unknown>)?.[
                segment.replace(/~1/g, '/').replace(/~0/g, '~')
              ];
            expect(target, `Unresolved schema reference ${value}`).toBeDefined();
          } else walk(value);
        }
    };
    walk(spec);
  });
});
