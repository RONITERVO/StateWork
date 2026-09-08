import { it, expect } from 'vitest';
import { WorkClient, MemoryStore, WorkService } from '@statework/sdk';
it('calls fetch without an illegal receiver and retries an ambiguous command with the same request ID', async () => {
  const connection = new WorkService(new MemoryStore()).connect('owner');
  connection.create({ id: 'w', title: 'Work' });
  let attempts = 0;
  const fetcher: typeof fetch = async function (this: unknown, _input, init) {
    expect(this).toBeUndefined();
    const result = connection.execute('w', JSON.parse(init!.body as string));
    attempts++;
    if (attempts === 1) throw new TypeError('Connection lost after the server committed.');
    return new Response(JSON.stringify(result), { status: 200 });
  };
  const client = new WorkClient('http://127.0.0.1:4180', 'test', fetcher);
  const result = await client.execute('w', {
    schemaVersion: 1,
    requestId: 'retry',
    expectedRevision: 0,
    commands: [{ type: 'item.create', item: { id: 'a', title: 'Only once', kind: 'task' } }],
  });
  expect(result.revision).toBe(1);
  expect(attempts).toBe(2);
  expect(connection.snapshot('w').items).toHaveLength(1);
  expect(connection.events('w').events).toHaveLength(1);
});
