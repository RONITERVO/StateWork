import type { Command } from '@statework/core';
import type { WorkConnection } from '@statework/sdk';
/** Original, fictional sample work. Never overwrites an existing workspace. */
export function seedDemo(connection: WorkConnection): void {
  if (connection.list().some((w) => w.id === 'welcome')) return;
  connection.create({ id: 'welcome', title: 'A little room to think' });
  const day = (offset: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const items = [
    {
      id: 'launch',
      kind: 'project',
      title: 'Make space for good work',
      description:
        'A small example workspace. Explore the same work as a list, board, timeline, or map. Create your own space when you are ready.',
      status: 'active',
      priority: 2,
      tags: ['studio'],
    },
    {
      id: 'outline',
      kind: 'task',
      title: 'Sketch the first useful version',
      description:
        'Write down the smallest thing that would make next week easier. Start with the work, then choose a view.',
      status: 'active',
      priority: 3,
      tags: ['studio', 'focus'],
      dueDate: day(1),
      effortMinutes: 45,
    },
    {
      id: 'research',
      kind: 'task',
      title: 'Collect the loose ends',
      description:
        'Gather notes and questions into one place. Link them to the work they belong to.',
      status: 'ready',
      priority: 2,
      tags: ['studio'],
      dueDate: day(2),
      effortMinutes: 25,
    },
    {
      id: 'prototype',
      kind: 'task',
      title: 'Build something you can try',
      description: 'This depends on the first sketch. Open its connections to navigate there.',
      status: 'ready',
      priority: 2,
      tags: ['studio', 'making'],
      dueDate: day(4),
      effortMinutes: 90,
    },
    {
      id: 'walk',
      kind: 'task',
      title: 'Take a walk, leave the phone',
      description: 'A bit of space between one thing and the next.',
      status: 'ready',
      priority: 1,
      tags: ['personal'],
      effortMinutes: 20,
    },
    {
      id: 'notes',
      kind: 'note',
      title: 'What a calmer week could feel like',
      description:
        'One next action. A little less switching. Clear stopping points. An interface that follows the way you think.',
      status: 'inbox',
      priority: 0,
      tags: ['personal', 'ideas'],
    },
    {
      id: 'review',
      kind: 'event',
      title: 'Friday review',
      description: 'What moved forward? What can wait? Make room for the next week.',
      status: 'ready',
      priority: 1,
      tags: ['studio'],
      schedule: {
        start: `${day(3)}T13:00:00.000Z`,
        end: `${day(3)}T13:30:00.000Z`,
        timeZone: 'Europe/Helsinki',
      },
    },
    {
      id: 'desk',
      kind: 'task',
      title: 'Clear a corner of the desk',
      description: 'Done is a useful place to begin.',
      status: 'done',
      priority: 0,
      tags: ['personal'],
      effortMinutes: 10,
    },
  ] as const;
  const commands: Command[] = items.map((item) => ({
    type: 'item.create',
    item: { ...item, tags: [...item.tags] },
  }));
  for (const id of ['outline', 'research', 'prototype', 'review'])
    commands.push({
      type: 'relation.add',
      relation: { id: `parent-${id}`, kind: 'contains', from: 'launch', to: id },
    });
  commands.push(
    {
      type: 'relation.add',
      relation: { id: 'needs-outline', kind: 'depends_on', from: 'prototype', to: 'outline' },
    },
    {
      type: 'relation.add',
      relation: { id: 'idea-link', kind: 'relates_to', from: 'notes', to: 'launch' },
    },
    {
      type: 'view.save',
      view: {
        id: 'next',
        title: 'One next step',
        query: { actionable: true, sort: 'priority' },
        renderer: 'focus',
      },
    },
    {
      type: 'view.save',
      view: { id: 'studio', title: 'At the studio', query: { tags: ['studio'] }, renderer: 'list' },
    },
  );
  connection.execute('welcome', {
    schemaVersion: 1,
    requestId: 'welcome-seed-v1',
    expectedRevision: 0,
    commands,
  });
}
