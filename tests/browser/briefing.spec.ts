import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('compact overview, evidence pages and phone layout stay readable', async ({ page }) => {
  await page.goto('/');
  const workspace = await page.evaluate(async () => {
    const { token } = await (
      await fetch('/local/session', { method: 'POST', headers: { 'X-StateWork-Local': '1' } })
    ).json();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const id = crypto.randomUUID();
    await fetch('/v1/workspaces', {
      method: 'POST',
      headers,
      body: JSON.stringify({ id, title: 'Fictional course overview' }),
    });
    const commands = [
      { type: 'item.create', item: { id: 'cv', title: 'Prepare a visual CV', kind: 'task' } },
      {
        type: 'source.capture',
        source: {
          id: 'brief',
          taskIds: ['cv'],
          title: 'Original CV brief',
          locator: 'Author: fictional workshop',
          kind: 'note',
          coverage: 'complete',
          replaces: null,
          content: 'Include current education. ' + 'Readable original evidence. '.repeat(200),
        },
      },
      {
        type: 'fact.record',
        fact: {
          id: 'submitted',
          itemId: 'cv',
          key: 'cv',
          kind: 'submitted',
          value: 'Submitted for review',
          occurredAt: '2026-01-01T00:00:00.000Z',
          sourceIds: ['brief'],
          replaces: null,
        },
      },
    ];
    const r = await fetch(`/v1/workspaces/${id}/commands`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ schemaVersion: 1, requestId: 'seed', expectedRevision: 0, commands }),
    });
    if (!r.ok) throw new Error(await r.text());
    return id;
  });
  await page.goto(`/brief/?workspace=${workspace}&task=cv`);
  await expect(page.getByRole('heading', { name: 'Prepare a visual CV' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Build and review the instructions.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Progress & decisions' }).click();
  await expect(page.getByText('Submitted for review')).toBeVisible();
  await page.getByRole('button', { name: 'Full record' }).click();
  await expect(page.getByRole('button', { name: 'Evidence 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  await page.getByRole('button', { name: 'Read evidence' }).click();
  await expect(page.locator('#evidence')).toContainText('Include current education.');
  await page.getByRole('button', { name: 'Next excerpt →' }).click();
  await expect(page.locator('#evidence')).toContainText('4000–');
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'artifacts/brief-overview-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'artifacts/brief-overview-phone.png', fullPage: true });
});
