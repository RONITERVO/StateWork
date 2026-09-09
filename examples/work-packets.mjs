import {
  MemoryStore,
  WorkService,
  blankPacket,
  packetIssues,
  latestPacket,
  packetCompleteCommand,
} from '@statework/sdk';
const service = new WorkService(new MemoryStore());
const work = service.connect('author');
work.create({ id: 'workshop', title: 'Fictional workshop' });
let revision = 0,
  request = 0;
const execute = (commands) => {
  revision = work.execute('workshop', {
    schemaVersion: 1,
    requestId: `example-${++request}`,
    expectedRevision: revision,
    commands,
  }).revision;
};
execute([
  { type: 'item.create', item: { id: 'kit', kind: 'task', title: 'Prepare kit', status: 'ready' } },
  {
    type: 'source.capture',
    source: {
      id: 'procedure',
      taskIds: ['kit'],
      title: 'Kit procedure',
      locator: 'Workshop handbook, section 2',
      content:
        'Place two M6 bolts in the blue tray. Count exactly two bolts. If one is missing, take it from drawer A. Leave the tray on shelf B.',
      kind: 'note',
      coverage: 'complete',
      replaces: null,
    },
  },
]);
const draft = blankPacket(work.snapshot('workshop'), 'kit', 'packet-1');
draft.outcome = 'Two M6 bolts in the blue tray on shelf B.';
draft.finish = 'Count two bolts, verify the tray is blue, and place it on shelf B.';
Object.assign(draft.steps[0], {
  title: 'Count bolts',
  instruction: 'Place two M6 bolts in the blue tray.',
  expected: 'Exactly two M6 bolts in the tray.',
  ifBlocked: 'Take a missing bolt from drawer A.',
  citations: [
    { sourceId: 'procedure', quote: 'Place two M6 bolts in the blue tray.', location: 'Section 2' },
  ],
});
execute([{ type: 'packet.save', packet: draft, expectedPacketId: null }]);
console.log(
  'Before review:',
  packetIssues(work.snapshot('workshop'), latestPacket(work.snapshot('workshop'), 'kit')),
);
// Fictional example acts as the human reviewer and worker. A model must not self-approve.
execute([{ type: 'packet.review', id: draft.id }]);
execute([
  {
    type: 'packet.check',
    id: draft.id,
    stepId: draft.steps[0].id,
    checked: true,
    evidence: 'Counted two M6 bolts.',
  },
]);
execute([packetCompleteCommand(work.snapshot('workshop'), draft.id)]);
console.log('Complete:', work.instructions('workshop', 'kit').packet);
service.close();
