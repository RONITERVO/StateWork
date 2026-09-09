import { describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  fileDigest,
  MemoryStore,
  packetCompleteCommand,
  validateState,
  WorkService,
} from '@statework/sdk';
import type { Command } from '@statework/sdk';
import { executionSkillExample, fixtureNow } from '../examples/execution-skill-workspace.mjs';

const expectedInput = Buffer.from(
  'K7|OPEN|Replace café sign\r\nB4|CLOSED|Archive sample\r\n\r\nM2|OPEN|Check blue label\r\nL3|open|Ignore lowercase status\r\nA9|OPEN|Pack spare cable\r\n',
  'utf8',
);
const expectedOutput = Buffer.from(
  'Open: 3\nK7 - Replace café sign\nM2 - Check blue label\nA9 - Pack spare cable\n',
  'utf8',
);

async function freshWorker() {
  const original = await executionSkillExample();
  const store = new MemoryStore();
  const service = new WorkService(store, () => fixtureNow);
  const worker = service.connect('fixture-worker');
  try {
    await worker.importBundle(original.work.exportBundle(original.workspace), {
      id: 'isolated-fixture',
      title: 'Fresh fictional execution',
    });
  } finally {
    original.service.close();
  }
  const workspace = 'isolated-fixture';
  let serial = 0;
  const run = (commands: Command[]) =>
    worker.execute(workspace, {
      schemaVersion: 1,
      requestId: `worker-${++serial}`,
      expectedRevision: worker.snapshot(workspace).workspace.revision,
      commands,
    });
  const attach = async (id: string, name: string, bytes: Uint8Array, actor = worker) =>
    actor.attach(
      workspace,
      {
        requestId: `file-${++serial}`,
        expectedRevision: worker.snapshot(workspace).workspace.revision,
        asset: {
          id,
          name,
          taskIds: ['urgent-handover'],
          mediaType: 'text/plain',
          description: 'Observed fictional fixture file',
          locator: 'Isolated test directory',
          replaces: null,
        },
      },
      bytes,
    );
  const check = (stepId: string, outputs: { outputId: string; assetId: string }[] = []) =>
    run([
      {
        type: 'packet.check',
        id: 'handover-packet',
        stepId,
        checked: true,
        evidence: `Observed ${stepId} result in the isolated local fixture`,
        outputs,
      },
    ]);
  return { service, store, worker, workspace, run, attach, check };
}

describe('fictional execution-skill evaluation', () => {
  it('ships exact portable input and prioritizes active work due today over the decoy', async () => {
    const s = await freshWorker();
    try {
      const before = s.worker.snapshot(s.workspace);
      const plan = s.worker.plan(s.workspace, {
        now: fixtureNow,
        timeZone: 'Europe/Helsinki',
        days: 1,
      });
      expect(plan.days[0]!.suggestions[0]!.id).toBe('urgent-handover');
      expect(plan.days[0]!.suggestions.map((item) => item.id)).toContain('later-labels');
      expect(Buffer.from(s.worker.asset(s.workspace, 'queue').bytes)).toEqual(expectedInput);
      expect(
        s.worker.handoff(s.workspace, 'urgent-handover').next.map((step) => step.stepId),
      ).toEqual(['prepare']);
      expect(s.worker.snapshot(s.workspace)).toEqual(before);
      expect(validateState(before)).toEqual(before);
    } finally {
      s.service.close();
    }
  });

  it('permits real preparation and verification, requires review and receipt, then completes unchanged bytes', async () => {
    const s = await freshWorker();
    const dir = mkdtempSync(join(tmpdir(), 'statework-execution-fixture-'));
    try {
      expect(() => s.check('verify')).toThrow('prerequisites');
      expect(() => s.check('prepare')).toThrow('required output');
      const rows = new TextDecoder()
        .decode(s.worker.asset(s.workspace, 'queue').bytes)
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => line.split('|'))
        .filter((row) => row[1] === 'OPEN');
      const result = `Open: ${rows.length}\n${rows.map(([id, , title]) => `${id} - ${title}`).join('\n')}\n`;
      const file = join(dir, 'handover.txt');
      writeFileSync(file, result, { encoding: 'utf8', flag: 'wx' });
      const reopened = readFileSync(file);
      expect(reopened).toEqual(expectedOutput);
      const hash = await fileDigest(reopened);
      await s.attach('prepared', 'handover.txt', reopened);
      s.check('prepare', [{ outputId: 'handover', assetId: 'prepared' }]);
      expect(
        s.worker.handoff(s.workspace, 'urgent-handover').next.map((step) => step.stepId),
      ).toEqual(['verify']);
      expect(() => s.check('verify')).toThrow('required output');
      s.check('verify', [{ outputId: 'verified-handover', assetId: 'prepared' }]);
      const waiting = s.worker.handoff(s.workspace, 'urgent-handover');
      expect(waiting.next).toEqual([]);
      expect(waiting.graph.find((step) => step.id === 'deliver')!.blockers).toContainEqual(
        expect.objectContaining({ target: 'reviewer-approval', code: 'requirement' }),
      );
      expect(() => s.check('deliver')).toThrow('prerequisites');
      expect(() =>
        packetCompleteCommand(s.worker.snapshot(s.workspace), 'handover-packet'),
      ).toThrow('Review and check');
      const task = s.worker
        .snapshot(s.workspace)
        .items.find((item) => item.id === 'urgent-handover')!;
      expect(() =>
        s.run([
          {
            type: 'item.update',
            id: task.id,
            expectedVersion: task.version,
            patch: { status: 'done' },
          },
        ]),
      ).toThrow('Review and check the work packet before completing this task.');
      expect(s.worker.handoff(s.workspace, 'urgent-handover').completion.taskStatus).toBe('active');

      // The test harness now acts as the authorized fictional reviewer, after byte inspection.
      s.store.grant(s.workspace, 'fixture-reviewer', 'editor');
      const reviewer = s.service.connect('fixture-reviewer');
      expect(Buffer.from(reviewer.asset(s.workspace, 'prepared').bytes)).toEqual(expectedOutput);
      const approvalPath = join(dir, 'reviewer-approval.txt');
      writeFileSync(
        approvalPath,
        `Approved-SHA256: ${hash}\nDestination: local-outbox/handover.txt\n`,
        { flag: 'wx' },
      );
      await s.attach(
        'actual-review',
        'reviewer-approval.txt',
        readFileSync(approvalPath),
        reviewer,
      );
      // Reviewer identity alone cannot confirm a worker-scoped requirement for someone else.
      reviewer.execute(s.workspace, {
        schemaVersion: 1,
        requestId: 'reviewer-confirm',
        expectedRevision: reviewer.snapshot(s.workspace).workspace.revision,
        commands: [
          {
            type: 'packet.confirm',
            id: 'handover-packet',
            requirementId: 'reviewer-approval',
            available: true,
            evidence: `I reviewed and approved ${hash} for local-outbox/handover.txt.`,
          },
        ],
      });
      expect(s.worker.handoff(s.workspace, 'urgent-handover').next).toEqual([]);
      expect(s.worker.asset(s.workspace, 'actual-review').asset.capturedBy).toBe(
        'fixture-reviewer',
      );
      expect(new TextDecoder().decode(s.worker.asset(s.workspace, 'actual-review').bytes)).toBe(
        `Approved-SHA256: ${await fileDigest(readFileSync(file))}\nDestination: local-outbox/handover.txt\n`,
      );
      s.run([
        {
          type: 'packet.confirm',
          id: 'handover-packet',
          requirementId: 'reviewer-approval',
          available: true,
          evidence: `Read actual-review from fixture-reviewer; hash ${hash} and destination match.`,
        },
      ]);
      expect(
        s.worker.handoff(s.workspace, 'urgent-handover').next.map((step) => step.stepId),
      ).toEqual(['deliver']);
      expect(() =>
        packetCompleteCommand(s.worker.snapshot(s.workspace), 'handover-packet'),
      ).toThrow('Review and check');
      expect(() => s.check('deliver')).toThrow('required output');
      mkdirSync(join(dir, 'local-outbox'));
      copyFileSync(file, join(dir, 'local-outbox', 'handover.txt'));
      const delivered = readFileSync(join(dir, 'local-outbox', 'handover.txt'));
      expect(delivered).toEqual(reopened);
      expect(await fileDigest(delivered)).toBe(hash);
      const receiptPath = join(dir, 'receipt.txt');
      writeFileSync(
        receiptPath,
        `Delivered-SHA256: ${await fileDigest(delivered)}\nDestination: local-outbox/handover.txt\n`,
        { flag: 'wx' },
      );
      await s.attach('receipt', 'receipt.txt', readFileSync(receiptPath));
      s.check('deliver', [{ outputId: 'delivery-receipt', assetId: 'receipt' }]);
      s.run([packetCompleteCommand(s.worker.snapshot(s.workspace), 'handover-packet')]);
      expect(s.worker.handoff(s.workspace, 'urgent-handover').completion).toMatchObject({
        taskStatus: 'done',
        outcome: 'successful',
      });
      expect(Buffer.from(s.worker.asset(s.workspace, 'prepared').bytes)).toEqual(expectedOutput);
      expect(
        s.worker.snapshot(s.workspace).items.find((item) => item.id === 'later-labels')!.version,
      ).toBe(1);
      expect(validateState(s.worker.snapshot(s.workspace))).toEqual(s.worker.snapshot(s.workspace));
    } finally {
      s.service.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exports a new importable bundle through the CLI without overwriting an existing file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'statework-execution-cli-'));
    const file = join(dir, 'fixture.json');
    const service = new WorkService(new MemoryStore());
    try {
      const first = spawnSync(process.execPath, ['examples/execution-skill-workspace.mjs', file], {
        encoding: 'utf8',
      });
      expect(first.status, first.stderr).toBe(0);
      const saved = readFileSync(file);
      const worker = service.connect('cli-worker');
      await worker.importBundle(JSON.parse(saved.toString('utf8')), {
        id: 'cli-fixture',
        title: 'CLI fictional fixture',
      });
      expect(Buffer.from(worker.asset('cli-fixture', 'queue').bytes)).toEqual(expectedInput);
      const repeated = spawnSync(
        process.execPath,
        ['examples/execution-skill-workspace.mjs', file],
        { encoding: 'utf8' },
      );
      expect(repeated.status).not.toBe(0);
      expect(readFileSync(file)).toEqual(saved);
    } finally {
      service.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
