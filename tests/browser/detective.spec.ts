import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { starterSnapshot, resourceNamespace } from '../../packages/reference/src/spatial/model';
import type { WorkItem, WorkState } from '@statework/sdk';

function largeCase() {
  const snapshot = starterSnapshot(
    { id: 'large-case', title: 'Company example', project: 'Studio', tasks: ['Task'] },
    '2026-09-09T09:00:00.000Z',
  );
  const template = snapshot.state.items.find((item) => item.kind === 'task')!;
  const items: WorkItem[] = [],
    relations: WorkState['relations'] = [];
  for (let team = 0; team < 20; team++) {
    const project = `studio-${String(team).padStart(2, '0')}`;
    items.push({ ...template, id: project, kind: 'project', title: `Studio ${team}` });
    for (let index = 0; index < 50; index++) {
      const id = `${project}-task-${String(index).padStart(2, '0')}`;
      items.push({
        ...template,
        id,
        title: `Task ${index} · Studio ${team}`,
        status: index < 5 ? 'done' : 'ready',
        archived: index === 0,
        description: 'Open the linked brief. Check the requirements. Keep the result in this file.',
        extensions: { [resourceNamespace]: { url: 'https://example.com/brief' } },
      });
      relations.push({ id: `inside-${id}`, from: project, to: id, kind: 'contains' });
      if (index)
        relations.push({
          id: `need-${id}`,
          from: id,
          to: `${project}-task-${String(index - 1).padStart(2, '0')}`,
          kind: 'depends_on',
        });
      if (team && index === 25)
        relations.push({
          id: `cross-${id}`,
          from: id,
          to: `studio-${String(team - 1).padStart(2, '0')}-task-24`,
          kind: 'depends_on',
        });
    }
  }
  snapshot.state.items = items;
  snapshot.state.relations = relations;
  return snapshot;
}

test('a 1,020-record company case keeps completed evidence, cross-project links and every group inspectable', async ({
  page,
  browserName,
}, info) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Import a snapshot', exact: false }).click();
  await page.getByLabel('Snapshot file').setInputFiles({
    name: 'fictional-company.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(largeCase())),
  });
  await page.getByLabel('Name for the imported workspace').fill('Fictional company');
  await page.getByRole('button', { name: 'Import workspace', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.goto('/spatial/');
  await page.getByLabel('Your workspace').selectOption({ label: 'Fictional company' });
  await expect(page.locator('#record-count')).toContainText('1020 records');
  const started = Date.now();
  await page.getByRole('button', { name: 'Detective board', exact: true }).click();
  const dialog = page.locator('#detective-dialog'),
    map = dialog.locator('#case-map');
  await expect(dialog.locator('#case-coverage')).toContainText(
    '1020 of 1020 records · 20 cards · 1999 connections',
  );
  await expect(dialog.locator('#case-stats')).toContainText('100 done');
  await expect(dialog.locator('#case-stats')).toContainText('20 archived');
  await expect(map.locator('[data-case-card]')).toHaveCount(20);
  await info.attach('large-case-open', {
    body: JSON.stringify({ records: 1020, elapsedMs: Date.now() - started }),
    contentType: 'application/json',
  });
  if (browserName === 'chromium')
    await dialog.screenshot({ path: info.outputPath('company-whole-case.png') });
  await map.getByRole('button', { name: /^Studio 19\./ }).click();
  await expect(dialog.locator('#case-coverage')).toContainText('51 of 1020 records');
  await expect(dialog.locator('#case-note')).toContainText('connections continue outside');
  await map.locator('[data-case-card]').nth(24).click();
  await expect(dialog.locator('#case-coverage')).toContainText(/^2 of 1020 records/);
  await expect(map.locator('[data-case-card]')).toHaveCount(2);
  await map.locator('[data-case-card]').last().click();
  await expect(dialog.locator('#case-focus h3')).toHaveText('Task 48 · Studio 19');
  await dialog.getByRole('button', { name: '▦ Whole case', exact: true }).click();
  await dialog.getByLabel('Find on detective board').fill('Task 49 Studio 19');
  await expect(dialog.locator('#case-coverage')).toContainText(/^1 of 1020 records/);
  await expect(map.locator('[data-case-card]')).toHaveCount(1);
  await map.locator('[data-case-card]').click();
  await expect(dialog.locator('#case-focus h3')).toHaveText('Task 49 · Studio 19');
  await expect(dialog.getByRole('link', { name: 'Open source' })).toHaveAttribute(
    'href',
    'https://example.com/brief',
  );
  await dialog.getByRole('button', { name: '☆ Pin file', exact: true }).click();
  await dialog.getByRole('button', { name: '◇ Needs first', exact: true }).click();
  await expect(dialog.locator('#case-coverage')).toContainText('75 of 1020 records');
  await dialog.getByRole('button', { name: '▦ Whole case', exact: true }).click();
  await dialog.getByLabel('Board records').selectOption('archived');
  await expect(dialog.locator('#case-coverage')).toContainText('20 of 1020 records');
  await dialog.getByRole('button', { name: '▦ Whole case', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close detective board', exact: true }).click();
  if (browserName === 'chromium') {
    await page.getByRole('button', { name: 'Board on wall', exact: true }).click();
    await page.getByRole('button', { name: 'Full screen', exact: true }).click();
    await expect(page.locator('#scene canvas')).toHaveAttribute('data-draw-calls', /[1-9]/);
    await page
      .locator('#scene canvas')
      .screenshot({ path: info.outputPath('company-wall-board.png') });
    await page.getByRole('button', { name: 'Full screen', exact: true }).click();
  }
  await page.getByLabel('Your workspace').selectOption({ label: 'A little room to think' });
  await page.getByRole('button', { name: 'Detective board', exact: true }).click();
  await expect(dialog.locator('#case-pin-count')).toHaveText('0/12');
  await expect(dialog).not.toContainText('Task 49 · Studio 19');
});

test('a reader can investigate and pin while work mutations remain disabled', async ({ page }) => {
  let writes = 0;
  await page.route('**/v1/workspaces', async (route) => {
    const response = await route.fetch();
    const spaces = await response.json();
    await route.fulfill({
      response,
      json: spaces.map((space: object) => ({ ...space, role: 'reader' })),
    });
  });
  page.on('request', (request) => {
    if (request.url().endsWith('/commands') && request.method() === 'POST') writes++;
  });
  await page.goto('/spatial/');
  await page.getByLabel('Your workspace').selectOption({ label: 'A little room to think' });
  await expect(page.locator('#add-work')).toBeDisabled();
  await page.getByRole('button', { name: 'Detective board', exact: true }).click();
  await page.locator('#case-map [data-case-card]').first().click();
  await page
    .locator('#detective-dialog')
    .getByRole('button', { name: '☆ Pin file', exact: true })
    .click();
  await expect(page.locator('#case-pin-count')).toHaveText('1/12');
  await page
    .locator('#detective-dialog')
    .getByRole('button', { name: 'Hold folder', exact: true })
    .click();
  await expect(page.locator('#detective-dialog')).not.toBeVisible();
  await expect(
    page.locator('#inspector').getByRole('button', { name: 'Edit', exact: true }),
  ).toBeDisabled();
  expect(writes).toBe(0);
});

test('whole case, requirements, pins, source record, zoom and remembered investigation', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/spatial/');
  await page.getByRole('button', { name: 'Create your space' }).click();
  await page.getByLabel('Workspace name', { exact: true }).fill('Detective example');
  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  await page.getByRole('button', { name: 'Detective board', exact: true }).click();
  const dialog = page.locator('#detective-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#case-coverage')).toContainText('6 of 6 records');
  await expect(dialog.locator('#case-map [data-case-card]')).toHaveCount(6);
  await dialog
    .locator('#case-map')
    .getByRole('button', { name: /^Build first pass\./ })
    .click();
  await expect(dialog.locator('#case-focus')).toContainText('Needs first');
  await dialog.getByRole('button', { name: '☆ Pin file', exact: true }).click();
  await expect(dialog.locator('#case-pin-count')).toHaveText('1/12');
  await dialog.getByRole('button', { name: '◇ Needs first', exact: true }).click();
  await expect(dialog.locator('#case-title')).toHaveText('Needs first');
  await expect(dialog.locator('#case-coverage')).toContainText('3 of 6 records');
  await dialog.getByRole('button', { name: 'Zoom in board', exact: true }).click();
  await dialog.getByRole('button', { name: 'Fit all', exact: true }).click();
  await dialog.screenshot({ path: info.outputPath('detective-requirements.png') });
  await page.reload();
  await page.getByRole('button', { name: 'Detective board', exact: true }).click();
  await expect(dialog.locator('#case-focus h3')).toHaveText('Build first pass');
  await expect(dialog.locator('#case-pin-count')).toHaveText('1/12');
  await expect(dialog.locator('#case-title')).toHaveText('Needs first');
  await dialog.getByRole('button', { name: '▦ Whole case', exact: true }).click();
  await dialog.getByLabel('Find on detective board').fill('references');
  await expect(dialog.locator('#case-coverage')).toContainText('1 of 6 records');
  await dialog.getByRole('button', { name: '▦ Whole case', exact: true }).click();
  await expect(dialog.locator('#case-coverage')).toContainText('6 of 6 records');
  await dialog.getByRole('button', { name: 'Close detective board', exact: true }).click();
  await expect(page.locator('#record-count')).toContainText('Revision 0');
});

test('detective board remains keyboard-readable and usable without WebGL on a phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const context = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind: string, ...args: unknown[]) {
      if (kind === 'webgl' || kind === 'webgl2') return null;
      return Reflect.apply(context, this, [kind, ...args]);
    } as typeof context;
  });
  await page.goto('/spatial/');
  await page.getByRole('button', { name: 'Create your space' }).click();
  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  await expect(page.locator('#scene-loading')).toContainText('3D is unavailable');
  await page.getByRole('button', { name: 'Detective board', exact: true }).click();
  const dialog = page.locator('#detective-dialog');
  const file = dialog.locator('#case-map').getByRole('button', { name: /^Gather references\./ });
  await file.focus();
  await page.keyboard.press('Enter');
  await expect(dialog.locator('#case-focus h3')).toHaveText('Gather references');
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(await dialog.evaluate((el) => el.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Detective board', exact: true })).toBeFocused();
});
