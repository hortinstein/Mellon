// Browser tests against a real server running the mock judge (no API key).
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test('classification example: create, get denied, read log, delete', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText('Mock judge');

  await page.getByRole('button', { name: 'Load classification example' }).click();
  await expect(page.locator('[name=name]')).toHaveValue(/NIGHTJAR/);
  await page.getByRole('button', { name: 'Create lock' }).click();

  await expect(page.locator('#created code')).not.toBeEmpty();
  await expect(page.locator('#door-name')).toHaveText(/NIGHTJAR/);
  await expect(page.locator('#door-rules')).toContainText('KEEPERS ONLY');
  await expect(page.locator('#samples .chip')).toHaveCount(5);

  await page.locator('.chip', { hasText: 'Prompt injection' }).click();
  await page.getByRole('button', { name: 'Request entry' }).click();
  const result = page.locator('#result');
  await expect(result).toHaveClass(/denied/);
  await expect(result.locator('h3')).toHaveText('Access denied');
  await expect(result).toContainText('Mock judge');
  await expect(result.locator('.metric-flag.fail').first()).toBeVisible();
  await expect(result.locator('.secret')).toHaveCount(0);
  await expect(page.locator('#lock-list')).toContainText('1 attempt');

  await page.locator('#owner summary').click();
  await expect(page.locator('#owner-token')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Show attempt log' }).click();
  await expect(page.locator('.log-entry')).toHaveCount(1);
  await expect(page.locator('.log-entry')).toContainText('Ignore all previous rules');

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete lock' }).click();
  await expect(page.locator('#door')).toBeHidden();
  await expect(page.locator('#lock-list')).not.toContainText('NIGHTJAR');
});

test('a satisfied ruleset reveals the secret', async ({ page }) => {
  await page.goto('/');
  await page.fill('[name=name]', 'Gate of Moria');
  await page.fill('[name=rules]', 'Requester must say the password mellon');
  await page.fill('[name=secret]', 'The doors open.');
  await page.getByRole('button', { name: 'Create lock' }).click();

  await page.fill('[name=input]', 'Requester says: password mellon');
  await page.getByRole('button', { name: 'Request entry' }).click();
  await expect(page.locator('#result h3')).toHaveText('Access granted');
  await expect(page.locator('#result .secret')).toHaveText('The doors open.');
});

test('owner tools reject a wrong token', async ({ page }) => {
  await page.goto('/');
  await page.locator('.lock', { hasText: 'Gate of Moria' }).click();
  await page.locator('#owner summary').click();
  await page.fill('#owner-token', 'wrong-token');
  const dialog = page.waitForEvent('dialog');
  await page.getByRole('button', { name: 'Show attempt log' }).click();
  const d = await dialog;
  expect(d.message()).toContain('Owner token required');
  await d.dismiss();
});

test('layout fits a phone screen without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
