import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';

async function createSpace(page: Page, name = 'Example studio') {
  await page.goto('/spatial/');
  await page.getByRole('button', { name: 'Create your space' }).click();
  await page.getByLabel('Workspace name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.locator('#record-count')).toContainText('6 records');
}

test('graphics-unavailable fallback stays readable and can still record work', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind: string, ...args: unknown[]) {
      if (kind === 'webgl' || kind === 'webgl2') return null;
      return Reflect.apply(getContext, this, [kind, ...args]);
    } as typeof getContext;
  });
  await createSpace(page, 'Graphics fallback');
  await expect(page.locator('#scene-loading')).toContainText('3D is unavailable');
  await expect(page.getByRole('button', { name: 'Pick up folder', exact: true })).toBeDisabled();
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(result.violations).toEqual([]);
  await page.locator('#inspector').getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.locator('#inspector .state')).toContainText('Done');
  await expect(page.locator('#record-count')).toContainText('Revision 1');
});

test('spatial setup, prerequisite navigation, actions, undo, resource links and persistence', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await createSpace(page);
  await page
    .locator('#cards')
    .getByRole('button', { name: /Build first pass/ })
    .click();
  await expect(
    page.locator('#inspector').getByRole('button', { name: 'Finish', exact: true }),
  ).toBeDisabled();
  await page
    .locator('#inspector')
    .getByRole('button', { name: /^◇ Gather references/ })
    .click();
  await page.locator('#inspector').getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('#inspector .state')).toContainText('In progress');
  await page.locator('#inspector').getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.locator('#inspector .state')).toContainText('Done');
  await page.getByRole('button', { name: 'Undo last status' }).click();
  await expect(page.locator('#inspector .state')).toContainText('In progress');
  await page.locator('#inspector').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Resource link').fill('https://example.com/reference');
  await page.getByLabel('Notes / microsteps').fill('Open the reference\nChoose one direction');
  await page.getByRole('button', { name: 'Save step', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open resource' })).toHaveAttribute(
    'href',
    'https://example.com/reference',
  );
  await page.getByRole('button', { name: 'Add prerequisite' }).click();
  await page.getByLabel('New prerequisite', { exact: true }).fill('Request project access');
  await page.getByLabel('Link to get it').fill('https://example.com/access');
  await page.getByRole('button', { name: 'Link prerequisite' }).click();
  await expect(page.locator('#inspector .state')).toContainText('Needs first');
  await page
    .locator('#inspector')
    .getByRole('button', { name: /^◇ Request project access/ })
    .click();
  await expect(page.getByRole('link', { name: 'Open resource' })).toHaveAttribute(
    'href',
    'https://example.com/access',
  );
  await page.reload();
  await expect(page.locator('#record-count')).toContainText('7 records');
  await page.getByLabel('Your workspace').selectOption({ label: 'A little room to think' });
  await expect(
    page.getByRole('heading', { name: 'A little room to think', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Your workspace').selectOption({ label: 'Example studio' });
  await expect(page.locator('#record-count')).toContainText('7 records');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/^statework-.*\.json$/);
  expect(errors).toEqual([]);
});

test('keyboard, accessible fallback, mobile layout, silence and local-only requests', async ({
  page,
  browserName,
  baseURL,
}) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(baseURL!) && !request.url().startsWith('data:'))
      external.push(request.url());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await createSpace(page, 'My studio');
  await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Comfort settings' }).click();
  await page.getByRole('button', { name: 'Larger VR text' }).click();
  await expect(page.getByRole('button', { name: 'Larger VR text' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Comfort settings' })).toBeFocused();
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    result.violations,
    JSON.stringify(
      result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    ),
  ).toEqual([]);
  mkdirSync('artifacts/screenshots', { recursive: true });
  if (browserName === 'chromium')
    await page.screenshot({ path: 'artifacts/screenshots/spatial-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const next = await page.locator('#next-card').boundingBox();
  const stage = await page.locator('.stage').boundingBox();
  expect(next!.y).toBeLessThan(stage!.y);
  if (browserName === 'chromium')
    await page.screenshot({ path: 'artifacts/screenshots/spatial-mobile.png', fullPage: true });
  await page.reload();
  await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Comfort settings' }).click();
  await expect(page.getByRole('button', { name: 'Larger VR text' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(external).toEqual([]);
});

test('two lost save responses recover using the same receipt, without double completion', async ({
  page,
}) => {
  await createSpace(page, 'Retry workspace');
  let dropped = 0;
  const requests: unknown[] = [];
  await page.route('**/v1/workspaces/*/commands', async (route) => {
    requests.push(route.request().postDataJSON());
    if (dropped < 2) {
      dropped++;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.locator('#inspector').getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(page.locator('#inspector .state')).toContainText('Done');
  await expect(page.locator('#record-count')).toContainText('Revision 1');
  expect(requests).toHaveLength(3);
  expect(requests[0]).toEqual(requests[1]);
  expect(requests[1]).toEqual(requests[2]);
});

test('stale writes refresh instead of overwriting another view', async ({ page, context }) => {
  await createSpace(page, 'Shared local work');
  const second = await context.newPage();
  await second.goto('/spatial/');
  await expect(
    second.locator('#inspector').getByRole('button', { name: 'Start', exact: true }),
  ).toBeVisible();
  await page.locator('#inspector').getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('#inspector .state')).toContainText('In progress');
  await second.locator('#inspector').getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(second.locator('#error')).toContainText('Work changed in another view');
  await expect(second.locator('#inspector .state')).toContainText('In progress');
  await expect(second.locator('#record-count')).toContainText('Revision 1');
  await second.close();
});

test('a denied immersive request leaves the desktop actions usable', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'WebGL context for the mocked request path is verified in Chromium. Other engines exercise the full DOM fallback.',
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'xr', {
      configurable: true,
      value: {
        isSessionSupported: async () => true,
        addEventListener: () => {},
        removeEventListener: () => {},
        requestSession: async () => {
          throw new DOMException('Headset permission declined', 'NotAllowedError');
        },
      },
    });
  });
  await createSpace(page, 'VR denial');
  await expect(page.getByRole('button', { name: 'Enter VR', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Enter VR', exact: true }).click();
  await expect(page.locator('#error')).toContainText('Headset permission declined');
  await page.locator('#inspector').getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.locator('#inspector .state')).toContainText('Done');
});

test('a failed workspace switch cannot redirect a subsequent write', async ({ page }) => {
  await createSpace(page, 'Keep my target');
  await page.route('**/v1/workspaces/welcome', (route) => route.abort('failed'));
  await page.getByLabel('Your workspace').selectOption('welcome');
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.getByLabel('Your workspace')).toContainText('Keep my target');
  await expect(page.getByRole('heading', { name: 'Keep my target', exact: true })).toBeVisible();
  await page.locator('#inspector').getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.locator('#record-count')).toContainText('Revision 1');
  await expect(page.locator('#inspector .state')).toContainText('Done');
  await page.unroute('**/v1/workspaces/welcome');
  await page.getByLabel('Your workspace').selectOption('welcome');
  await expect(page.locator('#record-count')).toContainText('8 records');
});

test('an interrupted create can be retried from inside the editor without a duplicate item', async ({
  page,
}) => {
  await createSpace(page, 'Editor retry');
  let dropped = 0;
  await page.route('**/v1/workspaces/*/commands', async (route) => {
    if (dropped < 2) {
      dropped++;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Add step', exact: false }).click();
  await page.getByLabel('Step name').fill('Created once');
  await page.getByRole('button', { name: 'Save step', exact: true }).click();
  await page.getByRole('button', { name: 'Retry the same save', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('#record-count')).toContainText('7 records');
  await expect(page.locator('#record-count')).toContainText('Revision 1');
  await expect(page.locator('#inspector h2')).toHaveText('Created once');
});

test('a lost setup response recovers the complete workspace instead of importing twice', async ({
  page,
}) => {
  await page.goto('/spatial/');
  let dropped = false;
  await page.route('**/v1/import', async (route) => {
    if (!dropped) {
      dropped = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Create your space' }).click();
  await page.getByLabel('Workspace name', { exact: true }).fill('Setup recovery');
  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  await page.getByRole('button', { name: 'Retry create', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('#record-count')).toContainText('6 records');
  await expect(page.locator('#record-count')).toContainText('Revision 0');
  await expect(page.getByRole('heading', { name: 'Setup recovery', exact: true })).toBeVisible();
});

test('an acknowledged create with a lost refresh keeps its original receipt', async ({ page }) => {
  await createSpace(page, 'Refresh recovery');
  const id = await page.getByLabel('Your workspace').inputValue();
  let dropped = false;
  await page.route(`**/v1/workspaces/${id}`, async (route) => {
    if (!dropped) {
      dropped = true;
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Add step', exact: false }).click();
  await page.getByLabel('Step name').fill('Keep one copy');
  await page.getByRole('button', { name: 'Save step', exact: true }).click();
  await page.getByRole('button', { name: 'Retry the same save', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('#record-count')).toContainText('7 records');
  await expect(page.locator('#record-count')).toContainText('Revision 1');
  await expect(page.locator('#inspector h2')).toHaveText('Keep one copy');
});
