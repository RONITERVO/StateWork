import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import type { XRDevice } from 'iwer';
test.setTimeout(90000);

declare global {
  interface Window {
    officeTestDevice: XRDevice;
  }
}

async function setup(page: Page, name: string) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/spatial/');
  await page.getByRole('button', { name: 'Create your space' }).click();
  await page.getByLabel('Workspace name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  await expect(page.locator('#scene canvas')).toHaveAttribute('data-draw-calls', /[1-9]/);
}
async function select(page: Page, label: string) {
  await page
    .locator('#cards')
    .getByRole('button', { name: new RegExp(label) })
    .click();
}
async function clickInRoom(page: Page, point: [number, number, number]) {
  const canvas = page.locator('#scene canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const camera = new THREE.PerspectiveCamera(
    box.width < 600 ? 72 : 57,
    box.width / box.height,
    0.035,
    35,
  );
  camera.position.set(0, 1.58, 2.32);
  camera.rotation.set(-0.1, 0, 0, 'YXZ');
  camera.updateMatrixWorld(true);
  const p = new THREE.Vector3(...point).project(camera);
  await page.mouse.click(box.x + ((p.x + 1) * box.width) / 2, box.y + ((1 - p.y) * box.height) / 2);
}

test('physical drawer picks, held X-ray, quick view, keys, locks and file-all', async ({
  page,
  browserName,
}, info) => {
  test.skip(
    browserName !== 'chromium',
    'Actual WebGL interaction is covered in Chromium; all engines run the DOM workflow suite.',
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setup(page, 'Office interaction test');
  await clickInRoom(page, [-1.6, 1.57, -1.484]);
  await expect(page.locator('#office-feedback')).toContainText('Drawer open');
  await clickInRoom(page, [-1.96, 1.91, -1.93 + 0.52 + 0.34 + 0.02]);
  await expect(page.locator('#office-held')).toContainText('Gather references');
  await page.getByRole('button', { name: 'Dependencies / X-ray', exact: true }).click();
  await expect(page.locator('#scene')).toHaveAttribute('data-xray', 'true');
  await page.getByRole('button', { name: 'Quick View', exact: true }).click();
  await expect(page.locator('#scene')).toHaveAttribute('data-quick-view', 'true');
  await page.locator('#scene canvas').screenshot({ path: info.outputPath('xray-quick-view.png') });
  await page.getByRole('button', { name: 'File all', exact: true }).click();
  await expect(page.locator('#scene')).toHaveAttribute('data-held', '');
  await expect(page.locator('#record-count')).toContainText('Revision 0');
  await select(page, 'Build first pass');
  await page.getByRole('button', { name: 'Pick up folder', exact: true }).click();
  await page.getByRole('button', { name: 'Use key ring', exact: true }).click();
  await expect(page.locator('#office-feedback')).toContainText('Still needs 2');
  await page.getByRole('button', { name: 'Quick View', exact: true }).click();
  await page.getByRole('button', { name: 'Full screen', exact: true }).click();
  await expect
    .poll(async () => (await page.locator('#scene canvas').boundingBox())?.width)
    .toBe(1440);
  await page
    .locator('#scene canvas')
    .screenshot({ path: info.outputPath('office-dependencies.png') });
  await page.getByRole('button', { name: 'Full screen', exact: true }).click();
  await expect
    .poll(async () => (await page.locator('#scene canvas').boundingBox())?.width)
    .toBeLessThan(1440);
  await expect(
    page.locator('#inspector').getByRole('button', { name: 'Finish', exact: true }),
  ).toBeDisabled();
  for (const label of ['Gather references', 'Get tool access']) {
    await select(page, label);
    await page.getByRole('button', { name: 'File all', exact: true }).click();
    // A real raycast against the wooden stamp, not a DOM completion button.
    await clickInRoom(page, [0.38, 1.046, 0.26]);
    await expect(page.locator('#inspector .state')).toContainText('Done');
  }
  await expect(page.locator('#office-keys')).toHaveText('KEY RING · 2');
  await select(page, 'Build first pass');
  await page.getByRole('button', { name: 'Pick up folder', exact: true }).click();
  await page.getByRole('button', { name: 'Use key ring', exact: true }).click();
  await expect(page.locator('#office-feedback')).toContainText('unlocked');
  await expect(page.locator('#record-count')).toContainText('Revision 2');
  await page.getByRole('button', { name: 'File all', exact: true }).click();
  await clickInRoom(page, [0.38, 1.046, 0.26]);
  await expect(page.locator('#inspector .state')).toContainText('Done');
  await expect(page.locator('#record-count')).toContainText('Revision 3');
  await page.reload();
  await expect(page.locator('#office-keys')).toHaveText('KEY RING · 3');
  expect(errors).toEqual([]);
});

test('repeated room interactions dispose GPU resources and mobile folders stay in view', async ({
  page,
  browserName,
}, info) => {
  test.skip(browserName !== 'chromium');
  await setup(page, 'Office resource test');
  const canvas = page.locator('#scene canvas');
  const memory = async () =>
    canvas.evaluate((c) => ({
      g: Number(c.dataset.geometries),
      t: Number(c.dataset.textures),
      calls: Number(c.dataset.drawCalls),
      tri: Number(c.dataset.triangles),
    }));
  const before = await memory();
  for (let i = 0; i < 8; i++) {
    await page.getByRole('button', { name: 'Pick up folder', exact: true }).click();
    await page.getByRole('button', { name: 'Dependencies / X-ray', exact: true }).click();
    await page.getByRole('button', { name: 'Quick View', exact: true }).click();
    await page.getByRole('button', { name: 'File all', exact: true }).click();
  }
  await expect.poll(async () => (await memory()).g).toBeLessThanOrEqual(before.g + 4);
  expect((await memory()).t).toBeLessThanOrEqual(before.t + 2);
  expect(before.calls).toBeLessThan(1400);
  await info.attach('renderer-counters', {
    body: JSON.stringify({ before, after: await memory() }),
    contentType: 'application/json',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Pick up folder', exact: true }).click();
  await expect(page.locator('#scene')).toHaveAttribute('data-held', 'step-1');
  await canvas.screenshot({ path: info.outputPath('mobile-held-folder.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('IWER Quest controllers enter, ray-pick, hold, release, lose tracking and exit', async ({
  page,
  browserName,
}, info) => {
  test.skip(
    browserName !== 'chromium',
    'IWER exercises a WebGL XR session in Chromium. This is emulation, not a hardware comfort claim.',
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript({
    content:
      readFileSync('node_modules/iwer/build/iwer.min.js', 'utf8') +
      '\nwindow.officeTestDevice = new IWER.XRDevice(IWER.metaQuest3); window.officeTestDevice.installRuntime({forceInstall:true,polyfillLayers:false});',
  });
  await setup(page, 'Quest emulation test');
  await page.getByRole('button', { name: 'Enter VR', exact: true }).click();
  await expect(page.locator('canvas[data-immersive="true"]')).toBeVisible();
  // Target the CRT file shortcut from the right controller. IWER places the
  // viewer at (0,1.6,0); the office is recentered around that actual pose.
  async function triggerAt(x: number, y: number, z: number, button = 'trigger') {
    await page.evaluate(
      ({ x, y, z, button }) => {
        const d = window.officeTestDevice,
          c = d.controllers.right!;
        c.position.set(x, y, z);
        c.quaternion.set(0, 0, 0, 1);
        c.updateButtonValue(button, 1);
      },
      { x, y, z, button },
    );
    await page.waitForTimeout(120); // Let the emulated XR frame consume the input edge.
    await page.evaluate(
      (button) => window.officeTestDevice.controllers.right!.updateButtonValue(button, 0),
      button,
    );
  }
  await triggerAt(-0.72, 1.32, -0.8);
  await expect(page.locator('#office-held')).toContainText('Gather references');
  await page.evaluate(() =>
    window.officeTestDevice.controllers.right!.position.set(0.3, 1.5, -0.5),
  );
  await page
    .locator('canvas[data-immersive="true"]')
    .screenshot({ path: info.outputPath('xr-held-folder.png') });
  await page.evaluate(() =>
    window.officeTestDevice.controllers.right!.updateButtonValue('squeeze', 1),
  );
  await page.waitForTimeout(120);
  await page.evaluate(() =>
    window.officeTestDevice.controllers.right!.updateButtonValue('squeeze', 0),
  );
  await expect(page.locator('#scene')).toHaveAttribute('data-held', '');
  await triggerAt(-0.72, 1.32, -0.8);
  await expect(page.locator('#scene')).toHaveAttribute('data-held', 'step-1');
  // One controller can operate the desk while holding a folder: its own
  // held mesh must not intercept every outgoing ray.
  await page.evaluate(() => {
    const c = window.officeTestDevice.controllers.right!;
    c.position.set(-0.35, 0.99, -0.9);
    c.quaternion.set(0, 0, 0, 1);
    c.updateButtonValue('trigger', 1);
  });
  await page.waitForTimeout(120);
  await page.evaluate(() =>
    window.officeTestDevice.controllers.right!.updateButtonValue('trigger', 0),
  );
  await expect(page.locator('#scene')).toHaveAttribute('data-xray', 'true');
  await page.evaluate(() => (window.officeTestDevice.stereoEnabled = true));
  await page
    .locator('canvas[data-immersive="true"]')
    .screenshot({ path: info.outputPath('xr-stereo-xray.png') });
  await page.evaluate(() => (window.officeTestDevice.controllers.right!.connected = false));
  await expect(page.locator('#scene')).toHaveAttribute('data-held', '');
  await page.evaluate(() => (window.officeTestDevice.controllers.right!.connected = true));
  await triggerAt(-0.72, 1.32, -0.8);
  await expect(page.locator('#scene')).toHaveAttribute('data-held', 'step-1');
  await page.evaluate(() => window.officeTestDevice.updateVisibilityState('visible-blurred'));
  await expect(page.locator('#scene')).toHaveAttribute('data-held', '');
  await page.evaluate(() => window.officeTestDevice.updateVisibilityState('visible'));
  await page.evaluate(() => window.officeTestDevice.activeSession!.end());
  await expect(page.getByRole('button', { name: 'Enter VR', exact: true })).toBeVisible();
  await expect(page.locator('#scene canvas')).toHaveAttribute('data-immersive', 'false');
  await page.getByRole('button', { name: 'Pick up folder', exact: true }).click();
  await expect(page.locator('#scene')).toHaveAttribute('data-held', 'step-1');
  await expect(page.locator('#record-count')).toContainText('Revision 0');
  expect(errors).toEqual([]);
  mkdirSync('artifacts/screenshots', { recursive: true });
});
