import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { starterSnapshot, resourceNamespace } from '../../packages/reference/src/spatial/model';

const now = '2026-09-09T08:00:00.000Z';
async function setup(page: Page) {
  const name = `Calendar example ${Date.now()}-${Math.random()}`;
  await page.clock.setFixedTime(new Date(now));
  await page.setViewportSize({ width: 1500, height: 1100 });
  const snapshot = starterSnapshot(
    {
      id: 'calendar-example',
      title: 'Calendar example',
      project: 'Autumn release',
      tasks: [
        'Gather references',
        'Get tool access',
        'Build first pass',
        'Review the work',
        'Deliver the result',
      ],
    },
    now,
  );
  for (const item of snapshot.state.items) if (item.kind === 'task') item.effortMinutes = 60;
  snapshot.state.items.find((i) => i.id === 'step-1')!.extensions = {
    [resourceNamespace]: { url: 'https://example.com/brief' },
  };
  snapshot.state.items.push({
    ...snapshot.state.items[0]!,
    id: 'appointment',
    kind: 'event',
    title: 'Studio review',
    schedule: {
      start: '2026-09-09T10:00:00.000Z',
      end: '2026-09-09T11:00:00.000Z',
      timeZone: 'UTC',
    },
    dueDate: '2026-09-11',
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Import a snapshot', exact: false }).click();
  await page.getByLabel('Snapshot file').setInputFiles({
    name: 'fictional-calendar.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(snapshot)),
  });
  await page.getByLabel('Name for the imported workspace').fill(name);
  await page.getByRole('button', { name: 'Import workspace', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.goto('/spatial/');
  await page.getByLabel('Your workspace').selectOption({ label: name });
  await expect(page.locator('#record-count')).toContainText('7 records');
}

test('reader can adjust a private plan while completion and progress writes stay disabled', async ({
  page,
}) => {
  await setup(page);
  let writes = 0;
  await page.route('**/v1/workspaces', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: (await response.json()).map((s: object) => ({ ...s, role: 'reader' })),
    });
  });
  page.on('request', (r) => {
    if (r.url().endsWith('/commands')) writes++;
  });
  await page.reload();
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  const dialog = page.locator('#calendar-dialog');
  await dialog.getByRole('button', { name: '30m', exact: true }).click();
  await expect(dialog.locator('.cal-day')).toContainText('30 / 30m planned');
  await expect(
    dialog.locator('.cal-task').first().getByRole('button', { name: '+ 30m worked', exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.locator('.cal-task').first().getByRole('button', { name: 'Finish', exact: false }),
  ).toBeDisabled();
  expect(writes).toBe(0);
});

test('calendar recommendations, late start, requirements, explicit progress, completion and reload', async ({
  page,
  browserName,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await setup(page);
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  const dialog = page.locator('#calendar-dialog');
  await expect(dialog.locator('.cal-cell')).toHaveCount(42);
  await expect(dialog.locator('.cal-day')).toContainText('240 / 240m planned');
  await expect(dialog.locator('.cal-appointment')).toContainText('Studio review');
  await expect(dialog.locator('.cal-task').nth(2)).toContainText('After prerequisites');
  await expect(
    dialog.locator('.cal-task').nth(2).getByRole('button', { name: 'Finish', exact: false }),
  ).toBeDisabled();
  await expect(dialog.getByRole('link', { name: 'Resource' })).toHaveAttribute(
    'href',
    'https://example.com/brief',
  );
  await dialog.getByRole('button', { name: 'Week', exact: true }).click();
  await expect(dialog.locator('.cal-cell')).toHaveCount(7);
  await dialog.getByRole('button', { name: 'Month', exact: true }).click();
  const axe = await new AxeBuilder({ page })
    .include('#calendar-dialog')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
  if (browserName === 'chromium')
    await dialog.screenshot({ path: info.outputPath('calendar-month.png') });
  await dialog.getByRole('button', { name: '1h', exact: true }).first().click();
  await expect(dialog.locator('.cal-day')).toContainText('60 / 60m planned');
  await dialog
    .locator('.cal-task')
    .first()
    .getByRole('button', { name: 'Tomorrow', exact: false })
    .click();
  await expect(dialog.locator('.cal-task h3').first()).toHaveText('Get tool access');
  await dialog
    .locator('.cal-task')
    .first()
    .getByRole('button', { name: '+ 60m worked', exact: true })
    .click();
  await expect(dialog.locator('.cal-status')).toContainText('60 minutes recorded');
  await expect(dialog.locator('.cal-day')).toContainText('0 / 0m planned');
  await dialog.getByRole('button', { name: '2h', exact: true }).first().click();
  await dialog
    .locator('.cal-task')
    .first()
    .getByRole('button', { name: 'Finish', exact: false })
    .click();
  await expect(dialog.locator('.cal-status')).toHaveText('Saved.');
  const remaining = await dialog.locator('.cal-day>h2').textContent();
  await page.reload();
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(dialog.locator('.cal-day>h2')).toHaveText(remaining!);
  await dialog.getByRole('button', { name: 'Day off', exact: true }).click();
  await expect(dialog.locator('.cal-day')).toContainText('0 / 0m planned');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toBeFocused();
  await expect(page.locator('#next-card')).toContainText('Today is clear');
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await dialog.locator('[data-cal-detail="week"] summary').click();
  await dialog
    .locator('[data-cal-detail="week"]')
    .getByRole('button', { name: 'Mon', exact: true })
    .click();
  await expect(dialog.locator('[data-cal-detail="week"]')).toHaveAttribute('open', '');
  expect(errors).toEqual([]);
});

test('calendar remains usable on a phone and without 3D, with keyboard dates and real records outside the forecast', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind: string, ...args: unknown[]) {
      return kind.startsWith('webgl') ? null : Reflect.apply(original, this, [kind, ...args]);
    } as typeof original;
  });
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  const dialog = page.locator('#calendar-dialog');
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await dialog.locator('[data-date="2026-09-09"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.locator('[data-date="2026-09-10"]')).toBeFocused();
  await dialog.getByRole('button', { name: 'Previous', exact: false }).first().click();
  await expect(dialog.locator('.cal-day')).toContainText('Outside 90-day forecast');
  await dialog.getByRole('button', { name: 'Today', exact: true }).click();
  const axe = await new AxeBuilder({ page })
    .include('#calendar-dialog')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
  await dialog.screenshot({ path: info.outputPath('calendar-phone.png') });
});

const point = (x: number, y: number) =>
  new THREE.Vector3((x - 1100) / 500, (620 - y) / 500, 0.062)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)
    .add(new THREE.Vector3(1, 1.78, 2.9));
async function desktopPick(page: Page, p: THREE.Vector3) {
  const canvas = page.locator('canvas[data-room-position]');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!,
    camera = new THREE.PerspectiveCamera(
      box.width < 600 ? 72 : 57,
      box.width / box.height,
      0.035,
      35,
    );
  camera.position.set(1, 1.58, -0.72);
  camera.rotation.set(-0.03, Math.PI, 0, 'YXZ');
  camera.updateMatrixWorld(true);
  const projected = p.project(camera);
  expect(Math.abs(projected.x)).toBeLessThan(1);
  expect(Math.abs(projected.y)).toBeLessThan(1);
  await page.mouse.click(
    box.x + ((projected.x + 1) * box.width) / 2,
    box.y + ((1 - projected.y) * box.height) / 2,
  );
}
test('physical wall has matching desktop ray targets for time left, files and screen view', async ({
  page,
  browserName,
}, info) => {
  test.skip(browserName !== 'chromium', 'Physical WebGL interactions use Chromium.');
  test.setTimeout(90000);
  await setup(page);
  await page.getByRole('button', { name: 'Calendar on wall', exact: true }).click();
  await expect(page.locator('canvas[data-room-position]')).toHaveAttribute(
    'data-room-position',
    '1.000,-0.720',
  );
  await page.getByRole('button', { name: 'Full screen', exact: true }).click();
  await page
    .locator('canvas[data-room-position]')
    .screenshot({ path: info.outputPath('calendar-wall.png') });
  await desktopPick(page, point(320, 185));
  await expect(page.locator('#next-card')).toContainText('60m planned today');
  await desktopPick(page, point(1640, 515));
  await expect(page.locator('#scene')).toHaveAttribute('data-held', 'step-1');
  await desktopPick(page, point(1230, 1165));
  await expect(page.locator('#calendar-dialog')).toBeVisible();
  await expect(page.locator('#calendar-dialog .cal-day')).toContainText('60 / 60m planned');
});

test('IWER controller picks calendar capacity and holds the suggested file, then exits to screen actions', async ({
  page,
  browserName,
}, info) => {
  test.skip(browserName !== 'chromium', 'IWER emulation is not physical headset qualification.');
  test.setTimeout(150000);
  await page.addInitScript({
    content:
      readFileSync('node_modules/iwer/build/iwer.min.js', 'utf8') +
      '\nwindow.officeTestDevice=new IWER.XRDevice(IWER.metaQuest3);window.officeTestDevice.stereoEnabled=true;window.officeTestDevice.installRuntime({forceInstall:true,polyfillLayers:false});',
  });
  await setup(page);
  await page.getByRole('button', { name: 'Calendar on wall', exact: true }).click();
  await page.setViewportSize({ width: 960, height: 720 });
  await page.getByRole('button', { name: 'Enter VR', exact: true }).click();
  const canvas = page.locator('canvas[data-room-position]');
  await expect(canvas).toHaveAttribute('data-immersive', 'true');
  const frames = async () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          let n = 3;
          const session = window.officeTestDevice.activeSession!;
          const frame = () => {
            if (--n === 0) resolve();
            else session.requestAnimationFrame(frame);
          };
          session.requestAnimationFrame(frame);
        }),
    );
  const trigger = async (p: THREE.Vector3, exits = false) => {
    const position = (await canvas.getAttribute('data-room-position'))!.split(',').map(Number),
      yaw = Number(await canvas.getAttribute('data-room-yaw'));
    const t = p
      .sub(new THREE.Vector3(position[0], 1.58, position[1]))
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw)
      .add(new THREE.Vector3(0, 1.6, 0));
    const normal = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
    const origin = t.clone().addScaledVector(normal, 0.2);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, -1),
      normal.clone().negate(),
    );
    await page.evaluate(
      (p) => {
        const c = window.officeTestDevice.controllers.right!;
        c.position.set(...p.position);
        c.quaternion.set(...p.quaternion);
      },
      {
        position: origin.toArray() as [number, number, number],
        quaternion: quaternion.toArray() as [number, number, number, number],
      },
    );
    await frames();
    await page.evaluate(() =>
      window.officeTestDevice.controllers.right!.updateButtonValue('trigger', 1),
    );
    if (exits) await expect(canvas).toHaveAttribute('data-immersive', 'false');
    else await frames();
    await page.evaluate(() =>
      window.officeTestDevice.controllers.right!.updateButtonValue('trigger', 0),
    );
    if (!exits) await frames();
  };
  // Entry establishes the tracking origin at the desk; use the wall's real station target.
  await trigger(point(2030, 1165));
  await expect(canvas).toHaveAttribute('data-room-position', '1.000,-0.720');
  await trigger(point(320, 185));
  await expect(page.locator('#next-card')).toContainText('60m planned today');
  await trigger(point(1640, 515));
  await expect(page.locator('#scene')).toHaveAttribute('data-held', 'step-1');
  await page.evaluate(() =>
    window.officeTestDevice.controllers.right!.position.set(0.3, 1.5, -0.45),
  );
  await frames();
  await canvas.screenshot({ path: info.outputPath('calendar-xr.png') });
  await trigger(point(1230, 1165), true);
  await expect(page.locator('#calendar-dialog')).toBeVisible();
});
