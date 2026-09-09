import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { officeLayout } from '../../packages/reference/src/spatial/office-layout';
import {
  caseGraph,
  newCaseSession,
  projectCase,
} from '../../packages/reference/src/spatial/detective-model';
import { starterSnapshot, starterTasks } from '../../packages/reference/src/spatial/model';

async function setup(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/spatial/');
  await page.getByRole('button', { name: 'Create your space' }).click();
  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  await expect(page.locator('canvas[data-room-position]')).toHaveAttribute(
    'data-draw-calls',
    /[1-9]/,
  );
}
const position = async (page: Page) =>
  (await page.locator('canvas[data-room-position]').getAttribute('data-room-position'))!
    .split(',')
    .map(Number);
const yaw = async (page: Page) =>
  Number(await page.locator('canvas[data-room-position]').getAttribute('data-room-yaw'));
async function frames(page: Page, count = 3) {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const frame = () => {
          if (--count <= 0) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    count,
  );
}
function cardPoint(id: string) {
  const graph = caseGraph(
    starterSnapshot(
      { id: 'fixture', title: 'Fixture', project: 'My next release', tasks: starterTasks },
      '2026-09-09T09:00:00.000Z',
    ).state,
  );
  const board = projectCase(graph, newCaseSession(graph.workspaceId), []);
  const card = board.cards.find((card) => card.recordId === id)!;
  const scale = Math.min(2200 / board.width, 880 / board.height);
  const x =
    (((2200 - board.width * scale) / 2 + (card.x + card.width / 2) * scale) / 2200 - 0.5) * 4.4;
  const y =
    (0.5 - ((880 - board.height * scale) / 2 + (card.y + card.height / 2) * scale) / 880) * 1.76 +
    0.08;
  return new THREE.Vector3(x, y, 0.1)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2)
    .add(new THREE.Vector3(3.78, 1.68, -0.25));
}
async function wallClick(page: Page, point: THREE.Vector3) {
  const canvas = page.locator('canvas[data-room-position]');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const p = await position(page);
  const camera = new THREE.PerspectiveCamera(
    box.width < 600 ? 72 : 57,
    box.width / box.height,
    0.035,
    35,
  );
  camera.position.set(p[0]!, 1.58, p[1]!);
  camera.rotation.set(-0.03, await yaw(page), 0, 'YXZ');
  camera.updateMatrixWorld(true);
  const projected = point.clone().project(camera);
  expect(Math.abs(projected.x)).toBeLessThan(1);
  expect(Math.abs(projected.y)).toBeLessThan(1);
  await page.mouse.click(
    box.x + ((projected.x + 1) * box.width) / 2,
    box.y + ((1 - projected.y) * box.height) / 2,
  );
}

test('walks around the room, stops for typing and blur, and ray-picks the physical detective board', async ({
  page,
  browserName,
}, info) => {
  test.skip(
    browserName !== 'chromium',
    'WebGL ray and movement paths run in Chromium; all engines cover the accessible board.',
  );
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await setup(page);
  await page.keyboard.down('w');
  await expect.poll(async () => (await position(page))[1], { timeout: 15000 }).toBeLessThan(1.7);
  await page.getByLabel('Find a step').focus();
  await frames(page);
  const stoppedForInput = await position(page);
  await page.keyboard.type('wasd');
  await frames(page, 5);
  expect(await position(page)).toEqual(stoppedForInput);
  await page.keyboard.up('w');
  await page.getByLabel('Find a step').fill('');
  await page.getByRole('button', { name: 'Desk', exact: true }).click();
  await page.keyboard.down('d');
  await expect.poll(async () => (await position(page))[0], { timeout: 15000 }).toBeGreaterThan(0.2);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await frames(page);
  const stoppedForBlur = await position(page);
  await frames(page, 5);
  expect(await position(page)).toEqual(stoppedForBlur);
  await page.keyboard.up('d');
  await page.getByRole('button', { name: 'Desk', exact: true }).click();
  await page.keyboard.down('w');
  await expect.poll(async () => (await position(page))[1], { timeout: 15000 }).toBeLessThan(1.2);
  await frames(page, 6);
  expect((await position(page))[1]).toBeGreaterThanOrEqual(1.15);
  await page.keyboard.up('w');
  for (let turn = 0; turn < 8; turn++) await page.keyboard.press('e');
  await expect.poll(() => yaw(page)).toBeCloseTo(-Math.PI * 2, 2);
  await page.getByRole('button', { name: 'Board on wall', exact: true }).click();
  await expect
    .poll(async () => (await position(page))[0])
    .toBeCloseTo(officeLayout.stations.board!.x, 2);
  await page.getByRole('button', { name: 'Full screen', exact: true }).click();
  await wallClick(page, cardPoint('step-3'));
  await expect(page.locator('#inspector h2')).toHaveText('Build first pass');
  await page
    .locator('canvas[data-room-position]')
    .screenshot({ path: info.outputPath('right-wall-investigation.png') });
  // Physical pin button, followed by the same file in the full-screen board.
  await wallClick(
    page,
    new THREE.Vector3(0.98, -1.12, 0.1)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2)
      .add(new THREE.Vector3(3.78, 1.68, -0.25)),
  );
  await page.getByRole('button', { name: 'Detective board', exact: true }).click();
  await expect(page.locator('#case-pin-count')).toHaveText('1/12');
  await expect(page.locator('#case-focus h3')).toHaveText('Build first pass');
  await page.keyboard.press('Escape');
  await page.getByText('Move around · WASD / sticks', { exact: true }).click();
  await page.getByRole('button', { name: 'Free move on', exact: true }).click();
  await page.keyboard.down('w');
  const paused = await position(page);
  await frames(page, 5);
  expect(await position(page)).toEqual(paused);
  await page.keyboard.up('w');
  await page.getByRole('button', { name: 'Back to desk', exact: true }).click();
  await expect.poll(async () => (await position(page))[1]).toBeCloseTo(2.32, 2);
  await expect(page.locator('#record-count')).toContainText('Revision 0');
  expect(errors).toEqual([]);
});

async function xrFrames(page: Page, count = 3) {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const session = window.officeTestDevice.activeSession!;
        const frame = () => {
          if (--count <= 0) resolve();
          else session.requestAnimationFrame(frame);
        };
        session.requestAnimationFrame(frame);
      }),
    count,
  );
}
async function xrTriggerRoomPoint(page: Page, point: THREE.Vector3, exits = false) {
  const current = await position(page),
    heading = await yaw(page);
  const tracking = point
    .clone()
    .sub(new THREE.Vector3(current[0]!, 1.58, current[1]!))
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), -heading)
    .add(new THREE.Vector3(0, 1.6, 0));
  await page.evaluate(
    (p) => {
      const c = window.officeTestDevice.controllers.right!;
      c.position.set(p.x, p.y, p.z + 0.2);
      c.quaternion.set(0, 0, 0, 1);
    },
    { x: tracking.x, y: tracking.y, z: tracking.z },
  );
  await xrFrames(page);
  await page.evaluate(() =>
    window.officeTestDevice.controllers.right!.updateButtonValue('trigger', 1),
  );
  if (exits)
    await expect(page.locator('canvas[data-room-position]')).toHaveAttribute(
      'data-immersive',
      'false',
      { timeout: 15000 },
    );
  else await xrFrames(page);
  await page.evaluate(() =>
    window.officeTestDevice.controllers.right!.updateButtonValue('trigger', 0),
  );
  if (!exits) await xrFrames(page);
}
test('IWER thumbsticks move and snap-turn, wall selection follows the rig, and tracking loss requires neutral', async ({
  page,
  browserName,
}, info) => {
  test.skip(
    browserName !== 'chromium',
    'Uses the IWER Quest runtime, not physical headset verification.',
  );
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript({
    content:
      readFileSync('node_modules/iwer/build/iwer.min.js', 'utf8') +
      '\nwindow.officeTestDevice = new IWER.XRDevice(IWER.metaQuest3); window.officeTestDevice.stereoEnabled = true; window.officeTestDevice.installRuntime({forceInstall:true,polyfillLayers:false});',
  });
  await setup(page);
  await page.setViewportSize({ width: 960, height: 720 });
  await page.getByRole('button', { name: 'Enter VR', exact: true }).click();
  await expect(page.locator('canvas[data-room-position]')).toHaveAttribute(
    'data-immersive',
    'true',
  );
  await xrFrames(page);
  const initial = await position(page);
  await page.evaluate(() =>
    window.officeTestDevice.controllers.left!.updateAxis('thumbstick', 'x-axis', 1),
  );
  await xrFrames(page, 8);
  expect((await position(page))[0]).toBeGreaterThan(initial[0]! + 0.025);
  await page.evaluate(() =>
    window.officeTestDevice.controllers.left!.updateAxis('thumbstick', 'x-axis', 0),
  );
  await xrFrames(page);
  const beforeTurn = await position(page);
  await page.evaluate(() =>
    window.officeTestDevice.controllers.right!.updateAxis('thumbstick', 'x-axis', 1),
  );
  await xrFrames(page, 5);
  expect(await yaw(page)).toBeCloseTo(-Math.PI / 4, 2);
  await xrFrames(page, 4);
  expect(await yaw(page)).toBeCloseTo(-Math.PI / 4, 2);
  expect((await position(page))[0]).toBeCloseTo(beforeTurn[0]!, 2);
  expect((await position(page))[1]).toBeCloseTo(beforeTurn[1]!, 2);
  await page.evaluate(() =>
    window.officeTestDevice.controllers.right!.updateAxis('thumbstick', 'x-axis', 0),
  );
  await xrFrames(page);
  // IWER's immersive canvas covers browser controls; use the real wall station button.
  await xrTriggerRoomPoint(page, new THREE.Vector3(3.695, 1.83, 2.5));
  const station = officeLayout.stations.board!;
  expect((await position(page))[0]).toBeCloseTo(station.x, 2);
  expect((await position(page))[1]).toBeCloseTo(station.z, 2);
  await xrTriggerRoomPoint(page, cardPoint('step-3'));
  await expect(page.locator('#inspector h2')).toHaveText('Build first pass');
  await page
    .locator('canvas[data-room-position]')
    .screenshot({ path: info.outputPath('xr-detective-board.png') });
  await xrTriggerRoomPoint(page, new THREE.Vector3(3.68, 0.56, 1.22));
  await expect(page.locator('#scene')).toHaveAttribute('data-held', 'step-3');
  await page.evaluate(() =>
    window.officeTestDevice.controllers.right!.position.set(0.3, 1.5, -0.45),
  );
  await xrFrames(page);
  await page.evaluate(() => {
    window.officeTestDevice.controllers.left!.connected = false;
    window.officeTestDevice.controllers.right!.updateAxis('thumbstick', 'x-axis', 1);
  });
  await xrFrames(page, 3);
  const awaitingNeutral = await position(page);
  await xrFrames(page, 4);
  expect(await position(page)).toEqual(awaitingNeutral);
  await page.evaluate(() =>
    window.officeTestDevice.controllers.right!.updateAxis('thumbstick', 'x-axis', 0),
  );
  await xrFrames(page);
  await page.evaluate(() =>
    window.officeTestDevice.controllers.right!.updateAxis('thumbstick', 'y-axis', 1),
  );
  await xrFrames(page, 6);
  expect(await position(page)).not.toEqual(awaitingNeutral);
  await expect(page.locator('#scene')).toHaveAttribute('data-held', 'step-3');
  await page
    .locator('canvas[data-room-position]')
    .screenshot({ path: info.outputPath('xr-walking-held-file.png') });
  await page.evaluate(() => window.officeTestDevice.updateVisibilityState('visible-blurred'));
  await expect(page.locator('#scene')).toHaveAttribute('data-held', '');
  await page.evaluate(() => window.officeTestDevice.updateVisibilityState('visible'));
  await xrFrames(page);
  const resumed = await position(page);
  await xrFrames(page, 4);
  expect(await position(page)).toEqual(resumed);
  await xrTriggerRoomPoint(page, new THREE.Vector3(3.68, 0.56, 1.71), true);
  await expect(page.locator('#detective-dialog')).toBeVisible();
  await expect(page.locator('canvas[data-room-position]')).toHaveAttribute(
    'data-immersive',
    'false',
  );
  await expect(page.locator('#case-focus h3')).toHaveText('Build first pass');
  await page.keyboard.press('Escape');
  expect((await position(page))[1]).toBeCloseTo(2.32, 2);
  await expect(page.locator('#record-count')).toContainText('Revision 0');
  expect(errors).toEqual([]);
});
