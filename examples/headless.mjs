import { MemoryStore, WorkService, defaultProfile, textAdapter } from '@statework/sdk';

const service = new WorkService(new MemoryStore());
const work = service.connect('me');
work.create({ id: 'personal', title: 'My work' });
const request = {
  schemaVersion: 1,
  requestId: 'first-plan',
  expectedRevision: 0,
  commands: [
    {
      type: 'item.create',
      item: {
        id: 'outline',
        kind: 'task',
        title: 'Write the outline',
        status: 'ready',
        effortMinutes: 25,
      },
    },
    {
      type: 'item.create',
      item: { id: 'draft', kind: 'task', title: 'Make a first draft', status: 'ready' },
    },
    {
      type: 'relation.add',
      relation: { id: 'draft-needs-outline', kind: 'depends_on', from: 'draft', to: 'outline' },
    },
  ],
};
const first = work.execute('personal', request);
const retry = work.execute('personal', request);
if (first.revision !== retry.revision) throw new Error('Retry unexpectedly mutated work.');
console.log(
  textAdapter.render(work.observe('personal', { query: { actionable: true } }), defaultProfile),
);
work.execute('personal', {
  schemaVersion: 1,
  requestId: 'finish-outline',
  expectedRevision: 1,
  commands: [{ type: 'item.update', id: 'outline', expectedVersion: 1, patch: { status: 'done' } }],
});
console.log('\nAfter finishing the prerequisite:\n');
console.log(
  textAdapter.render(work.observe('personal', { query: { actionable: true } }), defaultProfile),
);
console.log(
  '\nTwo committed batches; exact retry did not create a third:',
  work.events('personal').events.length,
);
service.close();
