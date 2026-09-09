import { it, expect } from 'vitest';
import { WorkService, MemoryStore, WorkError } from '@statework/sdk';

it('applies organization rules inside atomic commands and rechecks changed policy on retries', () => {
  const store = new MemoryStore();
  let allowed = true;
  const service = new WorkService(store, undefined, {
    beforeExecute: ({ state, request, actor }) => {
      state.workspace.title = 'Cannot mutate the stored state through policy input';
      if (
        !allowed ||
        (actor.role !== 'owner' && request.commands.some((c) => c.type === 'packet.review'))
      )
        throw new WorkError('FORBIDDEN', 'Organization policy requires an authorized reviewer.');
    },
  });
  const c = service.connect('owner');
  c.create({ id: 'w', title: 'Policy workspace' });
  const request = {
    schemaVersion: 1,
    requestId: 'request',
    expectedRevision: 0,
    commands: [{ type: 'item.create', item: { id: 'task', kind: 'task', title: 'Work' } }],
  };
  const first = c.execute('w', request);
  expect(c.snapshot('w').workspace.title).toBe('Policy workspace');
  allowed = false;
  expect(() => c.execute('w', request)).toThrow('Organization policy');
  allowed = true;
  expect(c.execute('w', request)).toEqual(first);
  store.grant('w', 'editor', 'editor');
  expect(() =>
    service.connect('editor').execute('w', {
      schemaVersion: 1,
      requestId: 'review',
      expectedRevision: 1,
      commands: [{ type: 'packet.review', id: 'no-packet' }],
    }),
  ).toThrow('authorized reviewer');
  expect(c.events('w').events).toHaveLength(1);
  service.close();
});
it('rejects accidental asynchronous authorization hooks and disallowed imports', () => {
  const service = new WorkService(new MemoryStore(), undefined, {
    beforeExecute: async () => {},
    beforeImport: () => {
      throw new WorkError('FORBIDDEN', 'External records require approval.');
    },
  });
  const c = service.connect('owner');
  c.create({ id: 'w', title: 'Work' });
  expect(() =>
    c.execute('w', {
      schemaVersion: 1,
      requestId: 'request',
      expectedRevision: 0,
      commands: [{ type: 'workspace.rename', title: 'Changed' }],
    }),
  ).toThrow('synchronously');
  expect(c.snapshot('w').workspace.revision).toBe(0);
  expect(() => c.import(c.export('w'), { id: 'copy', title: 'Copy' })).toThrow('require approval');
  expect(c.list()).toHaveLength(1);
  service.close();
});
