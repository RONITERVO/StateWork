import { expect, it } from 'vitest';
import { WorkService, MemoryStore, packetCompleteCommand, validateState } from '@statework/sdk';
import { connectedExample } from '../examples/connected-work.mjs';
import { packetDeskView } from '../packages/reference/src/spatial/packet-view.js';

it('a fresh office worker produces the exact fictional handover using only portable app data', async () => {
  const original = await connectedExample();
  const bundle = original.work.exportBundle(original.workspace);
  original.service.close();
  const service = new WorkService(new MemoryStore());
  const worker = service.connect('fresh-worker');
  await worker.importBundle(bundle, { id: 'copy', title: 'Independent worker' });
  const handoff = worker.handoff('copy', 'office');
  expect(handoff.next.map((s) => s.stepId)).toEqual(['write']);
  expect(handoff.environment.externalAccess).toBe(false);
  expect(handoff.assets.every((a) => a.available)).toBe(true);
  const step = handoff.packet!.steps[0]!;
  const rule = worker.source('copy', step.references!.find((r) => r.kind === 'source')!.targetId!);
  expect(rule.content).toContain('Preserve their input order');
  const bytes = worker.asset(
    'copy',
    step.references!.find((r) => r.kind === 'asset')!.targetId!,
  ).bytes;
  const rows = new TextDecoder()
    .decode(bytes)
    .trim()
    .split('\n')
    .map((line) => line.split('|'))
    .filter((row) => row[1] === 'OPEN');
  const output = `Open: ${rows.length}\n${rows.map((row) => `${row[0]} - ${row[2]}`).join('\n')}\n`;
  expect(output).toBe('Open: 2\nA1 - Review layout\nC3 - Confirm date\n');
  await worker.attach(
    'copy',
    {
      requestId: 'output',
      expectedRevision: 0,
      asset: {
        id: 'handover',
        taskIds: ['office'],
        name: 'handover.txt',
        mediaType: 'text/plain',
        description: 'Verified synthetic handover',
        locator: 'Generated from the app-provided queue',
        replaces: null,
      },
    },
    new TextEncoder().encode(output),
  );
  worker.execute('copy', {
    schemaVersion: 1,
    requestId: 'check',
    expectedRevision: 1,
    commands: [
      {
        type: 'packet.check',
        id: handoff.packet!.id,
        stepId: 'write',
        checked: true,
        evidence: 'Both OPEN records and the closed-record exclusion checked against queue.txt.',
        outputs: [{ outputId: 'handover', assetId: 'handover' }],
      },
    ],
  });
  worker.execute('copy', {
    schemaVersion: 1,
    requestId: 'finish',
    expectedRevision: 2,
    commands: [packetCompleteCommand(worker.snapshot('copy'), handoff.packet!.id)],
  });
  expect(worker.handoff('copy', 'office').completion.taskStatus).toBe('done');
  expect(validateState(worker.snapshot('copy'))).toEqual(worker.snapshot('copy'));
  const forged = worker.snapshot('copy');
  forged.instructions!.packets.find((p) => p.taskId === 'office')!.checks[0]!.outputs = [];
  expect(() => validateState(forged)).toThrow('required result file');
  service.close();
});

it('a fresh CAD worker has the complete fictional geometry but must confirm their own working app', async () => {
  const original = await connectedExample();
  const service = new WorkService(new MemoryStore());
  const worker = service.connect('fresh-cad-worker');
  await worker.importBundle(original.work.exportBundle(original.workspace), {
    id: 'copy',
    title: 'Independent CAD worker',
  });
  original.service.close();
  expect(worker.handoff('copy', 'cad').graph[0]?.blockers.map((b) => b.target)).toEqual([
    'cad-app',
  ]);
  const spec = worker.source('copy', 'cad-spec').content;
  for (const fact of [
    '40 mm along X',
    '30 mm along Y',
    '4 mm along Z',
    'diameter 6 mm',
    '(10,15)',
    'STEP AP214',
  ])
    expect(spec).toContain(fact);
  expect(new TextDecoder().decode(worker.asset('copy', 'plate-drawing').bytes)).toContain(
    'Ø6 THROUGH',
  );
  worker.execute('copy', {
    schemaVersion: 1,
    requestId: 'confirm',
    expectedRevision: 0,
    commands: [
      {
        type: 'packet.confirm',
        id: 'cad-packet',
        requirementId: 'cad-app',
        available: true,
        evidence: 'Fixture assumption: all required CAD applications are accessible.',
      },
    ],
  });
  expect(worker.handoff('copy', 'cad').next.map((s) => s.stepId)).toEqual(['model']);
  expect(worker.handoff('copy', 'cad').completion.taskStatus).toBe('ready');
  const state = worker.snapshot('copy');
  const handoff = worker.handoff('copy', 'cad');
  const desk = packetDeskView(state, 'cad', 0, 0, true, true, handoff);
  expect(desk.body).toContain('WORK · READY');
  expect(packetDeskView(state, 'cad', 0, 999, true, true, handoff).canCheck).toBe(true);
  expect(packetDeskView(state, 'cad', 1, 999, true, true, handoff).canCheck).toBe(false);
  expect(packetDeskView(state, 'cad', 0, 999, true, false, handoff).canCheck).toBe(false);
  const stale = structuredClone(handoff);
  stale.workspace.revision--;
  expect(packetDeskView(state, 'cad', 0, 999, true, true, stale).canCheck).toBe(false);
  // Readiness is verified here; no actual CAD model is made or marked checked.
  service.close();
});
