import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { MemoryStore, WorkService, blankPacket, packetContext } from '@statework/sdk';
import type { PacketInput } from '@statework/sdk';
import { readFileSync } from 'node:fs';

async function bundleFixture() {
  const service = new WorkService(new MemoryStore());
  const c = service.connect('author');
  c.create({ id: 'original', title: 'Connected workshop' });
  c.execute('original', {
    schemaVersion: 1,
    requestId: 'seed',
    expectedRevision: 0,
    commands: [
      {
        type: 'item.create',
        item: { id: 'kit', kind: 'task', title: 'Square kit', status: 'ready' },
      },
      {
        type: 'source.capture',
        source: {
          id: 'spec',
          taskIds: ['kit'],
          title: 'Kit specification',
          kind: 'note',
          coverage: 'complete',
          replaces: null,
          locator: 'Fictional workshop standard 1',
          content:
            'Make a 20 mm square. Label its box KIT. Inspect both. Correct a mismatch before delivery. Deliver through the customer portal and retain its receipt.',
        },
      },
    ],
  });
  await c.attach(
    'original',
    {
      requestId: 'file',
      expectedRevision: 1,
      asset: {
        id: 'drawing',
        name: 'square.svg',
        taskIds: ['kit'],
        mediaType: 'image/svg+xml',
        description: 'Dimensioned square, 20 mm on both sides.',
        locator: 'Fictional workshop drawing 1',
        replaces: null,
      },
    },
    new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect x="50" y="50" width="200" height="200" fill="none" stroke="black"/><text x="100" y="30">20 mm</text><text x="100" y="280">20 mm square</text></svg>',
    ),
  );
  const p = blankPacket(c.snapshot('original'), 'kit', 'packet');
  p.contextKey = packetContext(c.snapshot('original'), 'kit').procedureKey!;
  p.outcome = 'Inspected kit delivered with receipt.';
  p.finish = 'Keep the customer receipt with this kit.';
  p.execution = {
    version: 1,
    completion: { anyOf: ['deliver'] },
    coverage: {
      inputs: 'checked',
      procedure: 'checked',
      acceptance: 'checked',
      note: 'Original drawing and workshop procedure checked.',
    },
    outputs: [
      {
        id: 'receipt',
        stepId: 'deliver',
        label: 'Delivery receipt',
        description: 'The receipt file identifies this kit and its delivery.',
        required: true,
      },
    ],
  };
  p.requirements = [
    {
      id: 'account',
      label: 'Portal account',
      detail: 'Open your customer portal.',
      check: 'The delivery form is accessible.',
      kind: 'account',
      itemId: null,
      confirmed: false,
      url: 'https://example.com/deliver',
      citations: [],
    },
  ];
  const make = (
    id: string,
    title: string,
    after: string[],
    instruction: string,
  ): PacketInput['steps'][number] => ({
    id,
    title,
    after,
    instruction,
    expected: 'Compare the result with the specification.',
    ifBlocked: 'Stop and review the specification.',
    minutes: 2,
    requires: [],
    citations: [{ sourceId: 'spec', quote: 'Make a 20 mm square.', location: 'Procedure 1' }],
    actionUrl: '',
  });
  p.steps = [
    {
      ...make('shape', 'Shape square', [], 'Make a 20 mm square using the drawing.'),
      references: [
        {
          id: 'draw',
          kind: 'asset',
          targetId: 'drawing',
          label: 'Drawing',
          url: '',
          location: 'Complete dimensioned view',
          page: null,
          seconds: null,
          essential: true,
          purpose: 'input',
        },
      ],
    },
    make('label', 'Label box', [], 'Write KIT on the box.'),
    {
      ...make(
        'inspect',
        'Inspect kit',
        ['shape', 'label'],
        'Measure the square and read the box label.',
      ),
      phase: 'verify',
      decision: {
        prompt: 'Does the kit match?',
        options: [
          { id: 'yes', label: 'Matches' },
          { id: 'no', label: 'Needs correction' },
        ],
      },
    },
    {
      ...make('repair', 'Correct kit', ['inspect'], 'Correct the mismatch and inspect it again.'),
      when: { stepId: 'inspect', optionId: 'no' },
    },
    {
      ...make(
        'deliver',
        'Deliver kit',
        ['inspect', 'repair'],
        'Deliver through the customer portal and keep its receipt.',
      ),
      phase: 'deliver',
      requires: ['account'],
      evidenceRequired: true,
    },
  ];
  c.execute('original', {
    schemaVersion: 1,
    requestId: 'packet',
    expectedRevision: 2,
    commands: [
      { type: 'packet.save', packet: p, expectedPacketId: null },
      { type: 'packet.review', id: p.id },
    ],
  });
  const bundle = c.exportBundle('original');
  service.close();
  return bundle;
}

test('files keep shared originals discoverable and archive decoration reversibly', async ({
  page,
}) => {
  const service = new WorkService(new MemoryStore());
  const c = service.connect('author');
  await c.importBundle(await bundleFixture(), { id: 'library', title: 'File library' });
  c.execute('library', {
    schemaVersion: 1,
    requestId: 'parent',
    expectedRevision: 0,
    commands: [
      { type: 'item.create', item: { id: 'course', kind: 'project', title: 'Shared course' } },
      {
        type: 'relation.add',
        relation: { id: 'course-kit', kind: 'contains', from: 'course', to: 'kit' },
      },
    ],
  });
  for (const [id, scope] of [
    ['handbook', 'course'],
    ['banner', 'kit'],
  ] as const) {
    await c.attach(
      'library',
      {
        requestId: id,
        expectedRevision: c.snapshot('library').workspace.revision,
        asset: {
          id,
          taskIds: [scope],
          name: `${id}.txt`,
          mediaType: 'text/plain',
          description: `Fictional ${id}`,
          locator: `Fictional source ${id}`,
          replaces: null,
        },
      },
      new TextEncoder().encode(`Exact ${id} bytes`),
    );
  }
  const bundle = c.exportBundle('library');
  service.close();
  await page.goto('/');
  const id = await page.evaluate(async (bundle) => {
    const { token } = await (
      await fetch('/local/session', { method: 'POST', headers: { 'X-StateWork-Local': '1' } })
    ).json();
    const id = crypto.randomUUID();
    const response = await fetch('/v1/bundle-import', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bundle, target: { id, title: 'File library' } }),
    });
    if (!response.ok) throw new Error(await response.text());
    return id;
  }, bundle);
  await page.goto(`/instructions/?workspace=${id}&task=kit`);
  await page.getByRole('button', { name: '▧ Files', exact: true }).click();
  await expect(page.getByRole('meter', { name: 'Workspace file storage' })).toBeVisible();
  await page.getByText('Shared files · 1', { exact: true }).click();
  const handbook = page.locator('.packet-source-list li').filter({ hasText: 'handbook.txt' });
  const downloaded = page.waitForEvent('download');
  await handbook.getByRole('button', { name: 'Open / download', exact: true }).click();
  expect(readFileSync((await (await downloaded).path())!, 'utf8')).toBe('Exact handbook bytes');
  await page
    .locator('.packet-source-list li')
    .filter({ hasText: 'banner.txt' })
    .getByRole('button', { name: 'Archive', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('File archived');
  await expect(page.getByText('▧ banner.txt', { exact: true })).not.toBeVisible();
  await page.getByText('Archived · 1', { exact: true }).click();
  await page.getByRole('button', { name: 'Restore to active', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('File restored to active files');
  await expect(page.getByText('▧ banner.txt', { exact: true })).toBeVisible();
  await page
    .locator('.packet-source-list li')
    .filter({ hasText: 'square.svg' })
    .getByRole('button', { name: 'Archive', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('used by current instructions');
  await expect(page.getByText('▧ square.svg', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

for (const readiness of ['draft', 'missing-file', 'ready'] as const) {
  test(`calendar and next actions respect packet readiness: ${readiness}`, async ({ page }) => {
    test.setTimeout(60000);
    await page.clock.setFixedTime(new Date('2026-09-09T12:00:00.000Z'));
    const bundle = await bundleFixture();
    const packet = bundle.snapshot.state.instructions!.packets[0]!;
    // Both independent actions need the same original, while the final receipt is still an output.
    packet.steps[1]!.references = [{ ...packet.steps[0]!.references![0]!, id: 'label-drawing' }];
    if (readiness === 'draft') packet.review = null;
    if (readiness === 'missing-file') {
      bundle.missing = bundle.files.map((file) => file.sha256);
      bundle.files = [];
    }
    await page.goto('/');
    const id = await page.evaluate(async (bundle) => {
      const { token } = await (
        await fetch('/local/session', {
          method: 'POST',
          headers: { 'X-StateWork-Local': '1' },
        })
      ).json();
      const id = crypto.randomUUID();
      const response = await fetch('/v1/bundle-import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundle, target: { id, title: 'Packet readiness test' } }),
      });
      if (!response.ok) throw new Error(await response.text());
      return id;
    }, bundle);
    await page.reload();
    await page.getByLabel('Workspace', { exact: true }).selectOption(id);
    if (readiness !== 'ready') {
      const row = page.locator('.work-list li').filter({ hasText: 'Square kit' });
      await expect(row.locator('.status')).toHaveText('Needs attention');
    }
    await page.getByRole('button', { name: 'Next actions', exact: false }).click();
    await expect(page.locator('.item-title').filter({ hasText: 'Square kit' })).toHaveCount(
      readiness === 'ready' ? 1 : 0,
    );
    if (readiness === 'ready') {
      await page.locator('[data-mode="focus"]').click();
      await expect(
        page.getByRole('button', { name: 'Mark complete', exact: false }),
      ).toBeDisabled();
    }
    let releaseScene: (() => void) | undefined;
    if (readiness === 'ready') {
      const sceneReady = new Promise<void>((resolve) => {
        releaseScene = resolve;
      });
      await page.route('**/assets/scene-*.js', async (route) => {
        await sceneReady;
        await route.continue();
      });
    }
    await page.goto('/spatial/');
    await page.getByLabel('Your workspace').selectOption(id);
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    const calendar = page.locator('#calendar-dialog');
    await calendar.getByRole('button', { name: '4h', exact: true }).click();
    if (readiness === 'ready') {
      const card = calendar.locator('.cal-task').filter({ hasText: 'Square kit' });
      await expect(card).toContainText('Ready');
      // A workspace refresh can finish its data before the 3D module is ready.
      // Releasing that pending refresh must also unlock the already-open calendar.
      await expect(card.getByRole('button', { name: 'Start', exact: false })).toBeDisabled();
      releaseScene!();
      await expect(page.locator('#add-work')).toBeEnabled();
      await expect(card.getByRole('button', { name: 'Start', exact: false })).toBeEnabled();
      await expect(card.getByRole('button', { name: 'Finish', exact: false })).toBeDisabled();
    } else {
      await expect(calendar.locator('.cal-task')).toHaveCount(0);
      await calendar.getByText('Needs review · 1', { exact: true }).click();
      const review = calendar.locator('.cal-review-row').filter({ hasText: 'Square kit' });
      await expect(review).toContainText('Open work packet · resolve blocker');
      await review.getByRole('button', { name: 'Next', exact: false }).click();
      await expect(calendar.locator('.cal-task')).toHaveCount(0);
    }
  });
}

test('fresh worker uses map, exact files, parallel actions, a branch and a delivery-only blocker', async ({
  page,
  browserName,
}, info) => {
  test.setTimeout(90000);
  await page.goto('/');
  const id = await page.evaluate(
    async (bundle) => {
      const { token } = await (
        await fetch('/local/session', { method: 'POST', headers: { 'X-StateWork-Local': '1' } })
      ).json();
      const id = crypto.randomUUID();
      const r = await fetch('/v1/bundle-import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundle, target: { id, title: 'Connected workshop' } }),
      });
      if (!r.ok) throw new Error(await r.text());
      return id;
    },
    await bundleFixture(),
  );
  await page.goto(`/instructions/?workspace=${id}&task=kit&step=label`);
  await expect(page.locator('#packet-main h2')).toHaveText('Label box');
  await page.getByRole('button', { name: '◈ Map', exact: true }).click();
  await expect(page.locator('.map-ready')).toHaveCount(2);
  await page.locator('.map-node[data-action="step:1"]').click();
  await page.getByRole('button', { name: '✓ Result matches', exact: true }).click();
  await expect(page.locator('#packet-main h2')).toHaveText('Shape square');
  const file = page.waitForEvent('download');
  await page.getByRole('button', { name: '▧ Drawing', exact: true }).click();
  expect((await file).suggestedFilename()).toBe('square.svg');
  await page.getByRole('button', { name: '✓ Result matches', exact: true }).click();
  await expect(page.locator('#packet-main h2')).toHaveText('Inspect kit');
  await page.getByLabel('Matches', { exact: true }).check();
  await page.getByRole('button', { name: '✓ Result matches', exact: true }).click();
  await expect(page.locator('.map-skipped')).toContainText('Correct kit');
  await page.locator('.map-node[data-action="step:4"]').click();
  await expect(page.locator('.compact-blocker')).toContainText('Portal account');
  await page.getByRole('button', { name: 'Check requirement', exact: true }).click();
  let releaseConfirmation!: () => void;
  let confirmationSaved!: () => void;
  const confirmationResponse = new Promise<void>((resolve) => {
    releaseConfirmation = resolve;
  });
  const savedConfirmation = new Promise<void>((resolve) => {
    confirmationSaved = resolve;
  });
  // Keep the save response pending while the user chooses another packet section.
  await page.route(`**/v1/workspaces/${id}/commands`, async (route) => {
    const commands = route.request().postDataJSON().commands as { type: string }[];
    if (!commands.some((command) => command.type === 'packet.confirm')) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    confirmationSaved();
    await confirmationResponse;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: '✓ I checked: ready', exact: true }).click();
  await savedConfirmation;
  try {
    await page.getByRole('button', { name: '▧ Files', exact: true }).click();
    await expect(page.getByRole('meter', { name: 'Workspace file storage' })).toBeVisible();
    await expect(page.locator('.packet-status')).toContainText('Needs attention');
  } finally {
    releaseConfirmation();
  }
  // This status requires the confirmed prerequisite's refreshed handoff to render.
  await expect(page.locator('.packet-status')).toContainText('Ready to follow');
  await expect(page.getByRole('button', { name: '▧ Files', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('meter', { name: 'Workspace file storage' })).toBeVisible();
  await page.getByText('Attach a file', { exact: true }).click();
  await page.locator('#asset-file').setInputFiles({
    name: 'receipt.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Fictional receipt 42: Square kit delivered.'),
  });
  await page.getByLabel('What does this file provide?').fill('Receipt for Square kit');
  await page.getByRole('button', { name: 'Attach file', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Original file attached');
  await page.getByRole('button', { name: '▶ Follow', exact: true }).click();
  await page.locator('[data-result-output="receipt"]').selectOption({ label: 'receipt.txt' });
  await page.getByLabel('Result record', { exact: false }).fill('Receipt 42 checked.');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  if (browserName === 'chromium') {
    await page.screenshot({ path: info.outputPath('connected-action.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath('connected-phone.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  await page.getByRole('button', { name: '✓ Result matches', exact: true }).click();
  await page.getByRole('button', { name: '✓ Accept result and finish task', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Task complete');
  await page.getByRole('button', { name: '◈ Map', exact: true }).click();
  await expect(page.locator('.map-checked')).toHaveCount(4);
  await expect(page.locator('.map-skipped')).toHaveCount(1);
  if (browserName === 'chromium') {
    await page.screenshot({ path: info.outputPath('connected-map.png'), fullPage: true });
    await page.emulateMedia({ media: 'print' });
    await page.pdf({
      path: info.outputPath('connected-route.pdf'),
      format: 'A4',
      printBackground: true,
    });
  }
});

test('packet import preserves unsaved reference identities, author edits, original-file restoration and export', async ({
  page,
}) => {
  const bundle = await bundleFixture();
  const original = bundle.snapshot.state.instructions!;
  const source = original.sources[0]!;
  // Preserve a capture's link to an original, as produced by file extraction.
  source.assetId = original.assets![0]!.id;
  const packetExport = {
    format: 'statework.packet',
    formatVersion: 1,
    packet: original.packets[0],
    sources: original.sources,
    assets: original.assets,
    filesIncluded: false,
  };
  await page.goto('/');
  const id = await page.evaluate(async () => {
    const { token } = await (
      await fetch('/local/session', { method: 'POST', headers: { 'X-StateWork-Local': '1' } })
    ).json();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const id = crypto.randomUUID();
    const create = await fetch('/v1/workspaces', {
      method: 'POST',
      headers,
      body: JSON.stringify({ id, title: 'Imported fictional workshop' }),
    });
    if (!create.ok) throw new Error(await create.text());
    const seed = await fetch(`/v1/workspaces/${id}/commands`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        expectedRevision: 0,
        commands: [
          { type: 'item.create', item: { id: 'copy-task', kind: 'task', title: 'Imported kit' } },
        ],
      }),
    });
    if (!seed.ok) throw new Error(await seed.text());
    return id;
  });
  await page.goto(`/instructions/?workspace=${id}&task=copy-task`);
  await page.locator('#import-packet').setInputFiles({
    name: 'packet.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(packetExport)),
  });
  await expect(page.getByRole('status')).toContainText('Imported draft');
  await expect(page.getByRole('combobox', { name: 'Content', exact: true })).toHaveValue(
    /^asset\//,
  );
  await page.getByLabel('Button label', { exact: true }).fill('Original drawing');
  await expect(page.locator('[name="successful-finish"][value="deliver"]')).toBeChecked();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved');
  await page.getByRole('button', { name: '✓ Review and approve', exact: true }).click();
  await page.getByRole('button', { name: '▶ Follow', exact: true }).click();
  await expect(page.locator('.compact-blocker')).toContainText('original file');
  await page.getByRole('button', { name: '▧ Files', exact: true }).click();
  await expect(page.getByText('Original bytes missing', { exact: true })).toBeVisible();
  await page.getByLabel('Restore exact file', { exact: true }).setInputFiles({
    name: 'square.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(bundle.files[0]!.base64, 'base64'),
  });
  await expect(page.getByRole('status')).toContainText('Exact original file restored');
  await page.getByRole('button', { name: '▶ Follow', exact: true }).click();
  await expect(page.getByRole('button', { name: '✓ Result matches', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '▧ Original drawing', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '↓ Packet', exact: true }).click();
  const exported = JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
  expect(exported.packet.steps[0].references[0].kind).toBe('asset');
  expect(exported.packet.steps[0].references[0].targetId).toBe(exported.assets[0].id);
  expect(exported.sources[0].assetId).toBe(exported.assets[0].id);
  expect(exported.filesIncluded).toBe(false);
});

test('rejected packet imports preserve the previous unsaved original files and source identities', async ({
  page,
}) => {
  const bundle = await bundleFixture();
  const original = bundle.snapshot.state.instructions!;
  original.sources[0]!.assetId = original.assets![0]!.id;
  const packetExport = {
    format: 'statework.packet',
    formatVersion: 1,
    packet: original.packets[0],
    sources: original.sources,
    assets: original.assets,
    filesIncluded: false,
  };
  const archivedAsset = {
    ...original.assets![0]!,
    id: 'archived-file',
    name: 'archived.bin',
    sha256: 'b'.repeat(64),
    size: 1,
    taskIds: ['copy-task'],
  };
  await page.goto('/');
  const id = await page.evaluate(async (archivedAsset) => {
    const { token } = await (
      await fetch('/local/session', {
        method: 'POST',
        headers: { 'X-StateWork-Local': '1' },
      })
    ).json();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const id = crypto.randomUUID();
    const create = await fetch('/v1/workspaces', {
      method: 'POST',
      headers,
      body: JSON.stringify({ id, title: 'Atomic draft import fixture' }),
    });
    if (!create.ok) throw new Error(await create.text());
    const { capturedAt: _at, capturedBy: _by, ...asset } = archivedAsset;
    const seed = await fetch(`/v1/workspaces/${id}/commands`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        expectedRevision: 0,
        commands: [
          { type: 'item.create', item: { id: 'copy-task', kind: 'task', title: 'Imported kit' } },
          { type: 'asset.register', asset },
          {
            type: 'asset.archive',
            id: asset.id,
            archived: true,
            reason: 'Synthetic archived fixture',
          },
        ],
      }),
    });
    if (!seed.ok) throw new Error(await seed.text());
    return id;
  }, archivedAsset);
  await page.goto(`/instructions/?workspace=${id}&task=copy-task`);
  const importFile = (value: unknown, name: string) =>
    page.locator('#import-packet').setInputFiles({
      name,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(value)),
    });
  await importFile(packetExport, 'valid-packet.json');
  await expect(page.getByRole('status')).toContainText('Imported draft');
  const reference = page.getByRole('combobox', { name: 'Content', exact: true });
  const originalReference = await reference.inputValue();
  expect(originalReference).toMatch(/^asset\//);
  await page.getByLabel('Button label', { exact: true }).fill('Keep my original drawing');
  const savedDraft = await page.evaluate(
    (id) => JSON.parse(sessionStorage.getItem(`statework.packet.draft.${id}.copy-task`)!),
    id,
  );
  expect(savedDraft.pendingAssets).toHaveLength(1);
  expect(savedDraft.pendingSources).toHaveLength(1);

  await importFile({ ...packetExport, assets: [archivedAsset] }, 'archived-packet.json');
  await expect(page.getByRole('alert')).toContainText('Restore the archived file');
  await expect(reference).toHaveValue(originalReference);
  await expect(page.getByLabel('Button label', { exact: true })).toHaveValue(
    'Keep my original drawing',
  );
  // This failure occurs after new pending file metadata has already been staged.
  await importFile(
    { ...packetExport, sources: [{ ...original.sources[0], content: 42 }] },
    'invalid-source-packet.json',
  );
  await expect(page.getByRole('alert')).toContainText('expected string');
  await expect(reference).toHaveValue(originalReference);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved');
  const persisted = await page.evaluate(async (id) => {
    const { token } = await (
      await fetch('/local/session', {
        method: 'POST',
        headers: { 'X-StateWork-Local': '1' },
      })
    ).json();
    const response = await fetch(`/v1/workspaces/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, id);
  const files = persisted.instructions.assets.filter(
    (asset: { archive?: unknown }) => !asset.archive,
  );
  expect(files).toHaveLength(1);
  expect(files[0].id).toBe(savedDraft.pendingAssets[0].id);
  expect(files[0].sha256).toBe(original.assets![0]!.sha256);
  expect(persisted.instructions.sources).toHaveLength(1);
  expect(persisted.instructions.sources[0].id).toBe(savedDraft.pendingSources[0].id);
  expect(persisted.instructions.sources[0].assetId).toBe(files[0].id);
  expect(persisted.instructions.packets[0].steps[0].references[0]).toMatchObject({
    targetId: files[0].id,
    label: 'Keep my original drawing',
  });
});
