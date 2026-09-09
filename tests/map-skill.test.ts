import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as sdk from '@statework/sdk';
import * as node from '@statework/node';
import { auditMap, auditPackage } from '../.agents/skills/statework-map/scripts/audit-map.mjs';

function fixture() {
  const service = new sdk.WorkService(new sdk.MemoryStore());
  const work = service.connect('author');
  work.create({ id: 'fixture', title: 'Fictional records' });
  work.execute('fixture', {
    schemaVersion: 1,
    requestId: 'records',
    expectedRevision: 0,
    commands: [
      {
        type: 'item.create',
        item: {
          id: 'past',
          kind: 'task',
          title: 'Accepted sample',
          status: 'done',
          extensions: {
            'statework.map/scope': { classification: 'required', sourceIds: ['record'] },
            'statework.map/evidence': {
              claims: [
                {
                  field: 'status',
                  sourceId: 'record',
                  quote: 'Accepted sample: accepted.',
                  location: 'Row 1',
                  basis: 'official',
                },
              ],
            },
          },
        },
      },
      {
        type: 'source.capture',
        source: {
          id: 'record',
          taskIds: ['past'],
          title: 'Fictional assessment',
          locator: 'Fictional record, row 1',
          kind: 'note',
          coverage: 'complete',
          replaces: null,
          content: 'Accepted sample: accepted.',
        },
      },
    ],
  });
  const bundle = work.exportBundle('fixture');
  service.close();
  const ledger = {
    format: 'statework.map-research',
    version: 1,
    scope: 'One fictional assessed assignment',
    sources: [
      {
        id: 'assessment',
        locator: 'Fictional record',
        status: 'inspected',
        captureId: 'record',
        enumerationComplete: true,
        children: [] as string[],
        reason: 'Entire record inspected.',
      },
    ],
    requirements: [
      {
        id: 'assignment',
        sourceId: 'assessment',
        location: 'Row 1',
        quote: 'Accepted sample: accepted.',
        disposition: 'mapped',
        itemIds: ['past'],
        reason: '',
      },
    ],
  };
  return { bundle, ledger };
}

it('audits preserved completion evidence without requiring fabricated execution checks', async () => {
  const { bundle, ledger } = fixture();
  const before = JSON.stringify(bundle);
  const report = await auditMap(sdk, bundle, ledger);
  expect(report.issues).toEqual([]);
  expect(report.counts).toMatchObject({
    tasks: 1,
    openTasks: 0,
    sourcesInspected: 1,
    requirementsMapped: 1,
  });
  expect(report.semanticCompleteness).toContain('requires');
  expect(JSON.stringify(bundle)).toBe(before);
});

it('finds unenumerated branches, false quotations and unsupported completion separately', async () => {
  const { bundle, ledger } = fixture();
  ledger.sources[0]!.children = ['unread-assignment'];
  ledger.sources[0]!.enumerationComplete = false;
  ledger.requirements[0]!.quote = 'Invented requirement';
  bundle.snapshot.state.items[0]!.extensions['statework.map/evidence'] = { claims: [] };
  const report = await auditMap(sdk, bundle, ledger);
  expect(report.issues.map((i: { code: string }) => i.code)).toEqual(
    expect.arrayContaining([
      'UNACCOUNTED_LINK',
      'SOURCE_NOT_ENUMERATED',
      'REQUIREMENT_QUOTE',
      'COMPLETION_UNSUPPORTED',
    ]),
  );
});

it('rejects malformed bundles before producing a reassuring report', async () => {
  const { bundle, ledger } = fixture();
  bundle.snapshot.state.relations.push({
    id: 'bad',
    kind: 'depends_on',
    from: 'past',
    to: 'absent',
  });
  await expect(auditMap(sdk, bundle, ledger)).rejects.toThrow();
});

it('also checks completion evidence on events and project history', async () => {
  const { bundle, ledger } = fixture();
  const item = bundle.snapshot.state.items[0]!;
  item.kind = 'event';
  item.extensions['statework.map/evidence'] = { claims: [] };
  const report = await auditMap(sdk, bundle, ledger);
  expect(report.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'COMPLETION_UNSUPPORTED', target: 'past' }),
    ]),
  );
});

it('standalone CLI reads only supplied artifacts and refuses overwriting its proof', () => {
  const { bundle, ledger } = fixture();
  const dir = mkdtempSync(join(tmpdir(), 'statework-map-audit-test-'));
  const bundleFile = join(dir, 'bundle.json');
  const ledgerFile = join(dir, 'research.json');
  const reportFile = join(dir, 'report.json');
  writeFileSync(bundleFile, JSON.stringify(bundle));
  writeFileSync(ledgerFile, JSON.stringify(ledger));
  const args = [
    resolve('.agents/skills/statework-map/scripts/audit-map.mjs'),
    '--app',
    process.cwd(),
    '--bundle',
    bundleFile,
    '--ledger',
    ledgerFile,
    '--out',
    reportFile,
  ];
  const first = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8' });
  expect(first.status, first.stderr).toBe(0);
  const original = readFileSync(reportFile, 'utf8');
  const second = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8' });
  expect(second.status).toBe(1);
  expect(readFileSync(reportFile, 'utf8')).toBe(original);
});

it('audits a portable directory without a giant JSON bundle and rejects corrupted original bytes', async () => {
  const { bundle, ledger } = fixture();
  const directory = mkdtempSync(join(tmpdir(), 'statework-map-package-test-'));
  const store = new node.SqliteStore(join(directory, 'source.sqlite'));
  const service = new sdk.WorkService(store);
  const work = service.connect('source-owner');
  const packageDirectory = join(directory, 'portable');
  let digest: string;
  try {
    await work.importBundle(bundle, { id: 'source', title: 'Package source' });
    await work.attach(
      'source',
      {
        requestId: 'original',
        expectedRevision: 0,
        asset: {
          id: 'original',
          taskIds: ['past'],
          name: 'record.bin',
          mediaType: 'application/octet-stream',
          description: 'Exact record',
          locator: 'Fictional source record',
          replaces: null,
        },
      },
      new Uint8Array([0, 255, 128, 4]),
    );
    digest = work.assetManifest('source')[0]!.sha256;
    node.exportFilePackage(work, 'source', packageDirectory);
  } finally {
    service.close();
  }
  const before = readFileSync(join(packageDirectory, 'manifest.json'));
  const report = auditPackage(sdk, node, packageDirectory, ledger);
  expect(report.issues).toEqual([]);
  expect(report.structuralImport).toBe('passed');
  expect(report.packageManifestSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(report.bundleCanonicalSha256).toBeUndefined();
  expect(readFileSync(join(packageDirectory, 'manifest.json'))).toEqual(before);
  const reportPath = join(directory, 'package-audit.json');
  writeFileSync(join(directory, 'ledger.json'), JSON.stringify(ledger));
  const valid = spawnSync(
    process.execPath,
    [
      resolve('.agents/skills/statework-map/scripts/audit-map.mjs'),
      '--app',
      process.cwd(),
      '--package',
      packageDirectory,
      '--ledger',
      join(directory, 'ledger.json'),
      '--out',
      reportPath,
    ],
    { encoding: 'utf8' },
  );
  expect(valid.status, valid.stderr).toBe(0);
  writeFileSync(join(packageDirectory, 'blobs', digest!), new Uint8Array([0, 255, 128, 5]));
  expect(() => auditPackage(sdk, node, packageDirectory, ledger)).toThrow();
});
