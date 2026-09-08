import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';

test('local work creation, detail editing, dependencies, views, persistence and export', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'All work', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New workspace' }).click();
  await page.getByLabel('Workspace name').fill('My independent work');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A little open space' })).toBeVisible();
  await page.getByRole('button', { name: 'Add work' }).first().click();
  await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill('Plan the week');
  await page.getByRole('dialog').getByLabel('Tags').fill('personal, focus');
  await page.getByRole('button', { name: 'Add to inbox' }).click();
  await page.getByRole('button', { name: 'Plan the week', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plan the week' })).toBeVisible();
  await page
    .locator('#details')
    .getByRole('combobox', { name: 'Status', exact: true })
    .selectOption('active');
  await page.locator('#details').getByLabel('Notes').fill('Keep one clear next step.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toContainText('Saved');
  await page.getByRole('button', { name: 'Close details' }).click();
  for (const view of ['Board', 'Timeline', 'Map', 'Focus', 'Text', 'List']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    await expect(page.locator('#content')).toContainText('Plan the week');
  }
  await page.getByRole('button', { name: 'Mark complete: Plan the week', exact: true }).click();
  await expect(page.locator('#content')).toContainText('Done');
  await page.reload();
  await expect(page.locator('#content')).toContainText('Plan the week');
  await expect(page.locator('#content')).toContainText('Done');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export workspace' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^statework-.*\.json$/);
  expect(errors).toEqual([]);
});

test('keyboard entry, accessible views, preference persistence, narrow reflow and no external requests', async ({
  page,
  browserName,
  baseURL,
}) => {
  const external: string[] = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
  mkdirSync('artifacts/screenshots', { recursive: true });
  page.on('request', (r) => {
    if (!r.url().startsWith(baseURL!) && !r.url().startsWith('data:')) external.push(r.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'All work', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to work' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('searchbox', { name: 'Find work' })).toBeFocused();
  await page.keyboard.type('sketch useful');
  await expect(page.locator('#result-count')).toContainText('1 item');
  await page.getByRole('searchbox').fill('');
  await expect(page.locator('#result-count')).toContainText('8 items');
  for (const view of ['List', 'Board', 'Timeline', 'Map', 'Focus', 'Text']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      result.violations,
      `${browserName} ${view}: ${JSON.stringify(result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })))}`,
    ).toEqual([]);
    if (browserName === 'chromium')
      await page.screenshot({
        path: `artifacts/screenshots/desktop-${view.toLowerCase()}.png`,
        fullPage: true,
      });
  }
  await page.getByRole('button', { name: 'Reading & interaction' }).click();
  await page.getByRole('combobox', { name: 'Contrast', exact: true }).selectOption('high');
  await page.getByRole('combobox', { name: 'Motion', exact: true }).selectOption('none');
  await page.getByRole('combobox', { name: 'Reading detail', exact: true }).selectOption('brief');
  await page.getByRole('button', { name: 'Apply preferences' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'none');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const view of ['List', 'Board', 'Timeline', 'Map', 'Focus', 'Text']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    if (browserName === 'chromium' && view === 'List')
      await page.screenshot({ path: 'artifacts/screenshots/mobile-list.png', fullPage: true });
  }
  await page.getByRole('button', { name: 'Reading & interaction' }).click();
  await page.getByRole('combobox', { name: 'Text size', exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Apply preferences' }).click();
  for (const view of ['List', 'Board', 'Timeline', 'Focus', 'Text']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `Enlarged ${view} reflow`,
    ).toBe(true);
  }
  if (browserName === 'chromium')
    await page.screenshot({ path: 'artifacts/screenshots/mobile-large-text.png', fullPage: true });
  expect(external).toEqual([]);
});

test('saved queries, archive restoration, file import, and text escaping', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(page.locator('#result-count')).toContainText('8 items');
  await page.getByRole('button', { name: 'New workspace' }).click();
  await page.getByLabel('Workspace name').fill('Round trip');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A little open space' })).toBeVisible();
  const title = 'Read <plan> & pause';
  await page.getByRole('button', { name: 'Add work' }).first().click();
  await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Add to inbox' }).click();
  await page.getByRole('button', { name: title, exact: true }).click();
  await page.getByRole('button', { name: 'Move to archive', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Restore from archive', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();
  await page
    .getByRole('navigation', { name: 'Work filters' })
    .getByRole('button', { name: /Archive/ })
    .click();
  await page.getByRole('button', { name: title, exact: true }).click();
  await page.getByRole('button', { name: 'Restore from archive', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Move to archive', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();
  await page
    .getByRole('navigation', { name: 'Work filters' })
    .getByRole('button', { name: /All work/ })
    .click();
  await page.getByRole('searchbox').fill('plan');
  await expect(page.locator('#result-count')).toContainText('1 item');
  await page.getByRole('button', { name: 'Save view' }).click();
  await page.getByLabel('View name').fill('Plans');
  await page.getByRole('dialog').getByRole('button', { name: 'Save view', exact: true }).click();
  await expect(
    page.getByRole('navigation', { name: 'Saved views' }).getByRole('button', { name: /Plans/ }),
  ).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export workspace' }).click();
  const file = testInfo.outputPath('snapshot.json');
  await (await downloaded).saveAs(file);
  await page.getByRole('button', { name: 'Import a snapshot' }).click();
  await page.getByLabel('Snapshot file').setInputFiles(file);
  await page.getByLabel('Name for the imported workspace').fill('Restored copy');
  await page.getByRole('button', { name: 'Import workspace', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Workspace', exact: true })).toContainText(
    'Restored copy',
  );
  await expect(page.locator('#content')).toContainText(title);
  expect(await page.locator('#content plan').count()).toBe(0);
  await page
    .getByRole('navigation', { name: 'Saved views' })
    .getByRole('button', { name: /Plans/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Plans', exact: true })).toBeVisible();
});

test('blocked completion is explained and prerequisites can be navigated with text', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'All work', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Mark complete: Build something you can try' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Build something you can try', exact: true }).click();
  await page
    .locator('.connections')
    .getByRole('button', { name: 'Sketch the first useful version', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Sketch the first useful version' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('button', { name: 'Reading & interaction' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
