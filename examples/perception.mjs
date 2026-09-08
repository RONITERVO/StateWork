import {
  MemoryStore,
  WorkService,
  defaultProfile,
  negotiate,
  spatialAdapter,
  textAdapter,
  cueFor,
} from '@statework/sdk';
const service = new WorkService(new MemoryStore());
const work = service.connect('me');
work.create({ id: 'work', title: 'The same work, different senses' });
work.execute('work', {
  schemaVersion: 1,
  requestId: 'seed',
  expectedRevision: 0,
  commands: [
    {
      type: 'item.create',
      item: {
        id: 'water',
        kind: 'task',
        title: 'Water the plants',
        status: 'ready',
        extensions: { 'example.org/context': { room: 'studio' } },
      },
    },
  ],
});
const observation = work.observe('work');
// The host converts this into device output. This demo does not activate any hardware.
const tactile = {
  id: 'example.org/tactile',
  contractVersion: 1,
  output: ['haptic'],
  input: ['switch'],
  requires: ['haptic-device'],
  render: (observation) =>
    observation.nodes.map((node) => ({ ...cueFor(node), pulseMilliseconds: [40, 80, 40] })),
};
const preference = {
  ...defaultProfile,
  output: ['haptic', 'text'],
  input: ['switch'],
  motion: 'none',
};
const negotiation = negotiate(tactile, preference, []);
console.log('Hardware availability:', negotiation);
console.log('Text fallback:', textAdapter.render(observation, preference));
console.log('Tactile cue DATA, not delivered:', tactile.render(observation));
console.log(
  'Spatial coordinates with the same IDs:',
  spatialAdapter.render(observation, defaultProfile),
);
console.log(
  'A switch or gaze adapter can follow navigation.next, then invoke a permitted action by ID.',
);
service.close();
