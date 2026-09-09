// Fictional specifications for integration tests and learning the contracts. No real coursework.
import { WorkService, MemoryStore, blankPacket, packetContext } from '@statework/sdk';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export async function connectedExample(service = new WorkService(new MemoryStore())) {
  const work = service.connect('example-author');
  const workspace = 'connected-example';
  work.create({ id: workspace, title: 'Connected work — fictional examples' });
  let serial = 0;
  const run = (commands) =>
    work.execute(workspace, {
      schemaVersion: 1,
      requestId: `example-${++serial}`,
      expectedRevision: work.snapshot(workspace).workspace.revision,
      commands,
    });
  const attach = async (id, task, name, mediaType, content, description) => {
    await work.attach(
      workspace,
      {
        requestId: `example-${++serial}`,
        expectedRevision: work.snapshot(workspace).workspace.revision,
        asset: {
          id,
          taskIds: [task],
          name,
          mediaType,
          description,
          locator: 'Original fictional example',
          replaces: null,
        },
      },
      new TextEncoder().encode(content),
    );
  };
  const officeSpec =
    'Read queue.txt. Each nonempty line is an ID, a vertical bar, a status, another vertical bar, and a title. Select only rows whose status is OPEN. Preserve their input order. Produce handover.txt in UTF-8 with LF newlines: first line Open: N (N is the selected row count); then one line per selected row: ID - title. Finish with a newline. No heading, extra commentary, email or external submission. Attach handover.txt and check it against every input row.';
  const cadSpec =
    'Create a new single-body solid part in millimetres. The plate is 40 mm along X, 30 mm along Y, and 4 mm along Z. Its lower-left-bottom corner is (0,0,0). A circular through-hole has diameter 6 mm and centre (10,15) in the XY plane; its axis is parallel to Z. All outer corners are sharp; no fillets, chamfers, draft, material assignment or appearance are required. Start with a fully constrained 40 by 30 mm XY rectangle at the origin, extrude 4 mm in +Z, then sketch the diameter-6 circle at (10,15) and cut through all. Verify one solid body, the three overall dimensions and the hole diameter and centre. Save plate.SLDPRT and plate.step using STEP AP214 millimetres, then reopen the STEP file and verify the same geometry. The attached drawing is a top view; this specification defines depth and orientation. Attach both files locally. No website or delivery account is required. This is a fictional API fixture, not a manufacturing or school assignment.';
  run([
    {
      type: 'item.create',
      item: { id: 'office', kind: 'task', title: 'Prepare handover', status: 'ready' },
    },
    {
      type: 'item.create',
      item: { id: 'cad', kind: 'task', title: 'Model practice plate', status: 'ready' },
    },
    ...[
      ['office', officeSpec],
      ['cad', cadSpec],
    ].map(([task, content]) => ({
      type: 'source.capture',
      source: {
        id: `${task}-spec`,
        taskIds: [task],
        title: `${task} specification`,
        kind: 'note',
        locator: 'Original fictional example specification, section 1',
        content,
        coverage: 'complete',
        replaces: null,
      },
    })),
  ]);
  await attach(
    'queue',
    'office',
    'queue.txt',
    'text/plain',
    'A1|OPEN|Review layout\nB2|CLOSED|Update icon\nC3|OPEN|Confirm date\n',
    'Complete ordered input queue.',
  );
  await attach(
    'plate-drawing',
    'cad',
    'plate-top.svg',
    'image/svg+xml',
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="490" viewBox="0 0 640 490"><rect width="640" height="490" fill="white"/><g fill="none" stroke="black" stroke-width="2"><rect x="100" y="100" width="400" height="300"/><circle cx="200" cy="250" r="30"/><path d="M100 65H500M100 55V90M500 55V90M535 100V400M525 100H545M525 400H545M100 250H200M200 250V400"/></g><g font-family="Arial" font-size="22" fill="black"><text x="275" y="50">40 mm</text><text x="550" y="260">30 mm</text><text x="245" y="235">Ø6 THROUGH</text><text x="130" y="242">10</text><text x="210" y="350">15</text><text x="80" y="435">XY top view · thickness 4 mm (+Z)</text><text x="80" y="467">Fictional example · see full specification</text></g></svg>',
    'Dimensioned top view; original specification supplies Z depth and coordinates.',
  );
  const ref = (id, targetId, label, kind = 'asset') => ({
    id,
    targetId,
    label,
    kind,
    url: '',
    location: 'Complete original file or specification, section 1',
    page: null,
    seconds: null,
    essential: true,
    purpose: 'input',
  });
  const make = (task, outcome, finish, steps, outputs, requirements = []) => {
    const p = blankPacket(work.snapshot(workspace), task, `${task}-packet`);
    p.contextKey = packetContext(work.snapshot(workspace), task).procedureKey;
    p.outcome = outcome;
    p.finish = finish;
    p.requirements = requirements;
    p.execution = {
      version: 1,
      completion: { anyOf: [steps.at(-1).id] },
      coverage: {
        inputs: 'checked',
        procedure: 'checked',
        acceptance: 'checked',
        note: 'Fictional example author checked the complete input bytes, specification and result criteria.',
      },
      outputs,
    };
    p.steps = steps.map((s) => ({
      minutes: null,
      actionUrl: '',
      requires: [],
      ifBlocked:
        'Stop and record the exact missing input or failed check. Do not invent a replacement specification.',
      citations: [
        {
          sourceId: `${task}-spec`,
          quote: task === 'office' ? officeSpec : cadSpec,
          location: 'Original specification, section 1',
        },
      ],
      ...s,
    }));
    run([
      { type: 'packet.save', packet: p, expectedPacketId: null },
      { type: 'packet.review', id: p.id },
    ]);
  };
  make(
    'office',
    'A checked UTF-8 handover file for the open queue.',
    'Keep the verified handover.txt attached to this task.',
    [
      {
        id: 'write',
        title: 'Write handover',
        after: [],
        instruction: officeSpec,
        expected:
          'The file contains each OPEN row once, in source order, with the exact specified format.',
        references: [
          ref('queue-ref', 'queue', 'Queue'),
          ref('office-rule', 'office-spec', 'Format', 'source'),
        ],
        evidenceRequired: true,
      },
    ],
    [
      {
        id: 'handover',
        label: 'Handover file',
        description:
          'handover.txt follows the captured format and includes every OPEN input row exactly once.',
        stepId: 'write',
        required: true,
      },
    ],
  );
  make(
    'cad',
    'A checked plate model in native and neutral formats.',
    'Retain plate.SLDPRT and plate.step after reopening and verifying the neutral file.',
    [
      {
        id: 'model',
        title: 'Model plate',
        after: [],
        instruction: cadSpec,
        expected: 'One solid body: 40 × 30 × 4 mm; through-hole Ø6 at X10 Y15; sharp corners.',
        requires: ['cad-app'],
        references: [
          ref('drawing', 'plate-drawing', 'Top view'),
          ref('cad-rule', 'cad-spec', 'Geometry', 'source'),
        ],
      },
      {
        id: 'verify',
        title: 'Verify exports',
        after: ['model'],
        phase: 'verify',
        instruction:
          'Save plate.SLDPRT and STEP AP214 plate.step in millimetres. Reopen plate.step and compare its body count, dimensions and hole with the specification. Attach both checked files.',
        expected: 'Both files open successfully and contain one solid with the specified geometry.',
        references: [ref('cad-check', 'cad-spec', 'Acceptance', 'source')],
        evidenceRequired: true,
      },
    ],
    [
      {
        id: 'native',
        label: 'Native part',
        description: 'plate.SLDPRT contains the specified single-body part.',
        stepId: 'verify',
        required: true,
      },
      {
        id: 'neutral',
        label: 'Neutral part',
        description: 'plate.step is STEP AP214 in millimetres and passes the reopen check.',
        stepId: 'verify',
        required: true,
      },
    ],
    [
      {
        id: 'cad-app',
        label: 'CAD workspace',
        kind: 'software',
        itemId: null,
        detail: 'Open SOLIDWORKS with permission to create parts and write local files.',
        check: 'A new part can be created and STEP AP214 export is available.',
        confirmed: false,
        url: '',
        citations: [],
        scope: 'worker',
      },
    ],
  );
  return { service, work, workspace };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { service, work, workspace } = await connectedExample();
  const bundle = work.exportBundle(workspace);
  if (process.argv[2])
    writeFileSync(resolve(process.argv[2]), JSON.stringify(bundle, null, 2), { flag: 'wx' });
  else process.stdout.write(JSON.stringify(bundle, null, 2) + '\n');
  service.close();
}
