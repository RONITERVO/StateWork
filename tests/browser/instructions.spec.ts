import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

async function setup(page: Page) {
  await page.goto('/');
  const id = await page.evaluate(async () => {
    const { token } = await (
      await fetch('/local/session', { method: 'POST', headers: { 'X-StateWork-Local': '1' } })
    ).json();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const id = crypto.randomUUID();
    await fetch('/v1/workspaces', {
      method: 'POST',
      headers,
      body: JSON.stringify({ id, title: 'Fictional kit workshop' }),
    });
    await fetch(`/v1/workspaces/${id}/commands`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        expectedRevision: 0,
        commands: [
          {
            type: 'item.create',
            item: {
              id: 'kit',
              kind: 'task',
              title: 'Prepare kit',
              description: 'Place two M6 bolts in the blue tray.',
              status: 'ready',
            },
          },
        ],
      }),
    });
    return id;
  });
  await page.goto(`/instructions/?workspace=${id}&task=kit`);
  await expect(page.getByRole('heading', { name: 'Bring the evidence here.' })).toBeVisible();
  return id;
}
async function author(page: Page) {
  await page.getByRole('button', { name: '✎ Edit', exact: true }).click();
  await page
    .getByLabel('What will exist when this task is finished?')
    .fill('Two M6 bolts in the blue tray.');
  await page
    .getByLabel('How to verify and deliver the whole result')
    .fill('Count two bolts and leave the blue tray on shelf B.');
  await page
    .getByLabel('The result must look like this')
    .fill('Exactly two M6 bolts in the blue tray.');
  await page
    .getByLabel('If it differs, do this / contact this person')
    .fill('Get a missing bolt from drawer A. If drawer A is empty, ask the workshop lead.');
  await page
    .getByLabel('These uncited steps are my original instructions.', { exact: false })
    .check();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved');
  await expect(
    page.getByRole('button', { name: '✓ Review and approve', exact: true }),
  ).toBeEnabled();
}
test('manual author, review, result records, printable sources, export and reload', async ({
  page,
  browserName,
}, info) => {
  test.setTimeout(90000);
  const id = await setup(page);
  await author(page);
  await page.getByRole('button', { name: '✓ Review and approve', exact: true }).click();
  await expect(page.locator('.packet-status')).toHaveText('✓ Ready to follow');
  await expect(
    page.getByRole('heading', { name: 'Prepare kit', exact: true }).last(),
  ).toBeVisible();
  await page.getByText('Sources beside this step').click();
  await expect(page.locator('#packet-main blockquote')).toContainText('Place two M6 bolts');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  if (browserName === 'chromium') {
    await page.screenshot({ path: info.outputPath('work-packet-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: info.outputPath('work-packet-phone.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  await page.getByLabel('Evidence', { exact: false }).fill('Counted 2 bolts.');
  await page.getByRole('button', { name: '✓ Result matches', exact: true }).click();
  await page.getByRole('button', { name: '✓ Accept result and finish task', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Task complete');
  await page.reload();
  await expect(page.locator('.packet-status')).toHaveText('✓ Ready to follow');
  await expect(page.locator('.packet-title')).toContainText('1/1 checked');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '↓ Packet', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('statework-packet-kit.json');
  if (browserName === 'chromium') {
    // The default is now a compact route; the explicit full mode includes captured provenance.
    await page.evaluate(() => {
      window.print = () => {};
    });
    await page.getByRole('button', { name: 'Full evidence print', exact: true }).click();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.packet-print')).toBeVisible();
    await expect(page.locator('.packet-top')).not.toBeVisible();
    await expect(page.locator('.print-source')).toContainText('Place two M6 bolts');
    await page.pdf({
      path: info.outputPath('reviewed-work-packet.pdf'),
      format: 'A4',
      printBackground: true,
    });
    await page.emulateMedia({ media: 'screen' });
  }
  await page.goto(`/instructions/?workspace=${id}&task=kit`);
  await page.getByRole('button', { name: '↶ Undo this result', exact: true }).click();
  await expect(page.locator('.packet-title')).toContainText('0/1 checked');
});
test('phone manual capture, draft recovery, gaps and disabled AI fallback', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.getByLabel('Source title', { exact: true }).fill('Workshop note');
  await page.getByLabel('Original URL, filename or email reference').fill('Handbook section 2');
  await page
    .getByLabel('Readable contents', { exact: false })
    .fill('Use the blue tray. <script>window.bad=true</script>');
  await page.getByRole('button', { name: 'Save capture', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Source captured');
  await page.getByRole('button', { name: 'Remove from draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved history is preserved');
  await page.getByRole('button', { name: 'Use in draft', exact: true }).click();
  await page.getByRole('button', { name: 'Check source coverage', exact: true }).click();
  await expect(page.getByLabel('Exact question', { exact: true })).toHaveValue(
    'Does Workshop note include every relevant requirement?',
  );
  await page.getByRole('button', { name: '✎ Edit', exact: true }).click();
  await page.getByLabel('What will exist when this task is finished?').fill('Blue tray ready.');
  page.once('dialog', (d) => void d.accept());
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Recovered');
  await page.getByRole('button', { name: '✎ Edit', exact: true }).click();
  await expect(page.getByLabel('What will exist when this task is finished?')).toHaveValue(
    'Blue tray ready.',
  );
  await expect(
    page.getByRole('button', { name: '✓ Review and approve', exact: true }),
  ).toBeDisabled();
  await page.getByText('Optional assistance', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Draft with Codex', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => 'bad' in window)).toBe(false);
});
test('source file extraction preview stays local and read-only users cannot author', async ({
  page,
}) => {
  test.setTimeout(60000);
  await setup(page);
  await page.locator('#source-file').setInputFiles({
    name: 'instructions.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Count two bolts and place them in the blue tray.'),
  });
  await expect(page.getByLabel('Readable contents', { exact: false })).toHaveValue(
    'Count two bolts and place them in the blue tray.',
  );
  await page.route('**/v1/workspaces', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: (await response.json()).map((s: object) => ({ ...s, role: 'reader' })),
    });
  });
  await page.reload();
  await expect(page.getByRole('button', { name: '✎ Edit', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save capture', exact: true })).toBeDisabled();
});
test('office opens the focused task packet', async ({ page }) => {
  test.setTimeout(60000);
  const id = await setup(page);
  await page.goto('/spatial/');
  await page.getByLabel('Your workspace').selectOption(id);
  await page.locator('#cards').getByRole('button', { name: 'Prepare kit', exact: false }).click();
  await page
    .locator('#inspector')
    .getByRole('button', { name: 'Build instructions / Print', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`workspace=${id}&task=kit`));
  await expect(page.getByRole('heading', { name: 'Prepare kit', exact: true })).toBeVisible();
});
test('VR controller opens the work packet, pages its instructions and reaches print', async ({
  page,
  browserName,
}, info) => {
  test.skip(
    browserName !== 'chromium',
    'WebXR emulation uses Chromium; physical headset testing remains separate.',
  );
  test.setTimeout(120000);
  await page.addInitScript({
    content:
      readFileSync('node_modules/iwer/build/iwer.min.js', 'utf8') +
      '\nwindow.officeTestDevice=new IWER.XRDevice(IWER.metaQuest3);window.officeTestDevice.stereoEnabled=true;window.officeTestDevice.installRuntime({forceInstall:true,polyfillLayers:false});',
  });
  const id = await setup(page);
  await author(page);
  await page.getByRole('button', { name: '✎ Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Enable connected work', exact: true }).click();
  for (const key of ['inputs', 'procedure', 'acceptance'])
    await page.locator(`[name="coverage-${key}"]`).check();
  await page
    .getByLabel('What did you inspect? What are its limits?', { exact: true })
    .fill('Fictional tray procedure and all result criteria checked for XR testing.');
  await page.locator('[name="successful-finish"]').check();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved');
  await page.getByRole('button', { name: '✓ Review and approve', exact: true }).click();
  await page.goto('/spatial/');
  await page.getByLabel('Your workspace').selectOption(id);
  await page.locator('#cards').getByRole('button', { name: 'Prepare kit', exact: false }).click();
  await page.setViewportSize({ width: 960, height: 720 });
  await page.getByRole('button', { name: 'Enter VR', exact: true }).click();
  const canvas = page.locator('canvas[data-room-position]');
  await expect(canvas).toHaveAttribute('data-immersive', 'true');
  const frames = () =>
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
  const trigger = async (point: THREE.Vector3, exits = false) => {
    const pose = (await canvas.getAttribute('data-room-position'))!.split(',').map(Number),
      yaw = Number(await canvas.getAttribute('data-room-yaw'));
    const t = point
      .sub(new THREE.Vector3(pose[0], 1.58, pose[1]))
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw)
      .add(new THREE.Vector3(0, 1.6, 0));
    const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
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
    if (!exits) await frames();
    else await page.waitForURL('**/instructions/**');
    await page.evaluate(() =>
      window.officeTestDevice.controllers.right!.updateButtonValue('trigger', 0),
    );
    if (!exits) await frames();
  };
  await trigger(new THREE.Vector3(-0.83, 1.65, 0.56));
  await expect(canvas).toHaveAttribute('data-packet-open', 'true');
  await trigger(new THREE.Vector3(-0.13, 1.36, 1.17));
  await expect(canvas).toHaveAttribute('data-packet-page', '1');
  await canvas.screenshot({ path: info.outputPath('work-packet-vr.png') });
  await trigger(new THREE.Vector3(0.3, 1.25, 1.17), true);
  await expect(page.getByRole('button', { name: '▤ Print / PDF', exact: true })).toBeVisible();
});
