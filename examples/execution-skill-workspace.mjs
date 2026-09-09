// Public fictional fixture. Delivery means a local file copy; no network or real work.
import { WorkService, MemoryStore, blankPacket, packetContext } from '@statework/sdk';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const fixtureNow = '2026-09-09T08:00:00.000Z';
export const fixtureInput =
  'K7|OPEN|Replace café sign\r\nB4|CLOSED|Archive sample\r\n\r\nM2|OPEN|Check blue label\r\nL3|open|Ignore lowercase status\r\nA9|OPEN|Pack spare cable\r\n';
const specification =
  'Read the complete UTF-8 queue.txt. Each nonempty line has ID|status|title. Select only exact uppercase OPEN status; preserve row order and title characters. Ignore empty lines and all other statuses. Write handover.txt as UTF-8 without BOM and with LF newlines: Open: N on the first line, then ID - title for each selected row. Finish with one newline; add no commentary. Reopen the saved file and compare all input rows, count, order, Unicode, encoding and newline bytes. Attach the prepared and verified handover. Preparation and verification are authorized before review. Delivery remains required but needs a separate authorized fixture reviewer to approve the exact SHA-256 and destination local-outbox/handover.txt. The worker must not invent reviewer approval. The reviewer supplies an attached UTF-8 reviewer-approval.txt containing Approved-SHA256: <lowercase hex> and Destination: local-outbox/handover.txt, each followed by LF. After actual approval, confirm the worker-scoped reviewer-approval requirement with that evidence. Recheck the unchanged hash, copy the file into the run directory’s local-outbox/handover.txt, and read the copy back. Attach receipt.txt containing Delivered-SHA256: <lowercase hex> and Destination: local-outbox/handover.txt, each followed by LF. This outbox is fictional and local only; never use a network destination. Only an observed matching copy and receipt permit the delivery check and successful task completion.';

export async function executionSkillExample(
  service = new WorkService(new MemoryStore(), () => fixtureNow),
) {
  const work = service.connect('fixture-author');
  const workspace = 'execution-skill-example';
  work.create({ id: workspace, title: 'Execution skill — fictional local review' });
  let serial = 0;
  const run = (commands) =>
    work.execute(workspace, {
      schemaVersion: 1,
      requestId: `fixture-${++serial}`,
      expectedRevision: work.snapshot(workspace).workspace.revision,
      commands,
    });
  run([
    ...[
      ['urgent-handover', 'Finish today’s fictional handover', 'active', 3, '2026-09-09', 15],
      ['later-labels', 'Optional label practice next week', 'ready', 0, '2026-09-16', 30],
    ].map(([id, title, status, priority, dueDate, effortMinutes]) => ({
      type: 'item.create',
      item: { id, kind: 'task', title, status, priority, dueDate, effortMinutes },
    })),
    {
      type: 'source.capture',
      source: {
        id: 'handover-spec',
        taskIds: ['urgent-handover'],
        title: 'Fictional handover specification',
        kind: 'note',
        locator: 'Fictional evaluation author, complete specification',
        content: specification,
        coverage: 'complete',
        replaces: null,
      },
    },
  ]);
  await work.attach(
    workspace,
    {
      requestId: `fixture-${++serial}`,
      expectedRevision: work.snapshot(workspace).workspace.revision,
      asset: {
        id: 'queue',
        taskIds: ['urgent-handover'],
        name: 'queue.txt',
        mediaType: 'text/plain',
        description: 'Complete fictional ordered input, UTF-8 with CRLF.',
        locator: 'Fictional evaluation author, original bytes',
        replaces: null,
      },
    },
    new TextEncoder().encode(fixtureInput),
  );
  const ref = (kind, targetId, label) => ({
    id: `${targetId}-ref`,
    kind,
    targetId,
    label,
    url: '',
    location: 'Complete original',
    page: null,
    seconds: null,
    essential: true,
    purpose: 'input',
  });
  const packet = blankPacket(work.snapshot(workspace), 'urgent-handover', 'handover-packet');
  packet.contextKey = packetContext(work.snapshot(workspace), 'urgent-handover').procedureKey;
  packet.outcome = 'Verified handover delivered to the fictional local outbox after actual review.';
  packet.finish =
    'Retain handover.txt, reviewer-approval.txt and receipt.txt; delivery must be checked.';
  packet.requirements = [
    {
      id: 'reviewer-approval',
      kind: 'person',
      itemId: null,
      scope: 'worker',
      label: 'Reviewer approval of these exact bytes and local destination',
      detail:
        'Obtain the authorized fixture reviewer’s actual approval file for this unchanged hash and local-outbox/handover.txt. Do not self-approve.',
      check:
        'Read the reviewer’s approval artifact and compare its hash and destination with the verified result.',
      confirmed: false,
      url: '',
      citations: [],
    },
  ];
  packet.steps = [
    {
      id: 'prepare',
      title: 'Prepare handover.txt',
      after: [],
      requires: [],
      instruction:
        'Read queue.txt and the complete specification, then create and attach handover.txt.',
      expected: 'Exact requested UTF-8 output exists as an attached local artifact.',
    },
    {
      id: 'verify',
      title: 'Reopen and verify every output byte',
      after: ['prepare'],
      requires: [],
      instruction:
        'Reopen the saved handover, check every input row and exact output format, compute SHA-256, and attach the same checked bytes. Prepare a review package; await actual reviewer approval.',
      expected:
        'Saved bytes match the full specification; review package identifies hash and local destination.',
    },
    {
      id: 'deliver',
      title: 'Deliver approved bytes to fictional local outbox',
      after: ['verify'],
      requires: ['reviewer-approval'],
      instruction:
        'After actual reviewer approval, compare hash and destination, copy unchanged bytes to local-outbox/handover.txt within the private run directory, read them back, and attach receipt.txt in the specified format.',
      expected: 'The observed local copy has the approved hash and an attached delivery receipt.',
    },
  ].map((step) => ({
    ...step,
    phase: step.id,
    minutes: 5,
    actionUrl: '',
    evidenceRequired: true,
    references: [
      ref('source', 'handover-spec', 'Full specification'),
      ...(step.id === 'deliver' ? [] : [ref('asset', 'queue', 'Original queue')]),
    ],
    ifBlocked:
      'Preserve prepared work and record the exact missing input, failed comparison or pending review. Do not check delivery or mark done while it is pending.',
    citations: [
      { sourceId: 'handover-spec', quote: specification, location: 'Complete specification' },
    ],
  }));
  packet.execution = {
    version: 1,
    completion: { anyOf: ['deliver'] },
    coverage: {
      inputs: 'checked',
      procedure: 'checked',
      acceptance: 'checked',
      note: 'Fixture author checked original bytes, transformation rules, approval boundary and local delivery receipt.',
    },
    outputs: [
      ['handover', 'Prepared handover.txt', 'prepare'],
      ['verified-handover', 'Reopened and byte-verified handover.txt', 'verify'],
      ['delivery-receipt', 'Receipt for approved bytes read back from local outbox', 'deliver'],
    ].map(([id, label, stepId]) => ({
      id,
      label,
      description: `${label}; matches the complete specification.`,
      stepId,
      required: true,
    })),
  };
  run([
    { type: 'packet.save', packet, expectedPacketId: null },
    { type: 'packet.review', id: packet.id },
  ]);
  return { service, work, workspace };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { service, work, workspace } = await executionSkillExample();
  try {
    const contents = JSON.stringify(work.exportBundle(workspace), null, 2) + '\n';
    if (process.argv[2]) writeFileSync(resolve(process.argv[2]), contents, { flag: 'wx' });
    else process.stdout.write(contents);
  } finally {
    service.close();
  }
}
