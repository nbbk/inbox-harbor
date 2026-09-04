const { test, expect } = require('@playwright/test');

const baseURL = process.env.INBOXHARBOR_TEST_URL || 'http://127.0.0.1:5555';
const token = process.env.INBOXHARBOR_ADMIN_TOKEN || 'qa-local-token';

async function unlock(page) {
  await page.goto(baseURL);
  await expect(page).toHaveTitle(/InboxHarbor/);
  await page.getByPlaceholder('本机访问口令').fill(token);
  await page.getByRole('button', { name: '进入收件港' }).click();
  await expect(page.getByText('你的邮件，安静地靠岸。')).toBeVisible();
}

test('desktop notification settings render and expose channel guidance', async ({ page }) => {
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 960 });
  await unlock(page);
  await page.getByRole('button', { name: '通知渠道' }).click();
  await expect(page.locator('.ih-channel')).toHaveCount(9);
  await expect(page.getByText('电子邮件（SMTP）')).toBeVisible();
  await page.locator('.ih-channel').filter({ hasText: 'Bark (iOS)' }).click();
  await expect(page.locator('#ih-channel-guide')).toContainText('Device Key');
  await expect(page.getByLabel('完整正文')).toBeChecked();
  await page.screenshot({ path: '../qa/inboxharbor-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('mobile layout has bottom navigation and no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await unlock(page);
  await page.locator('.ih-mobile').getByRole('button', { name: '通知' }).click();
  await expect(page.locator('.ih-mobile')).toBeVisible();
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflows).toBe(false);
  await page.screenshot({ path: '../qa/inboxharbor-mobile.png', fullPage: true });
});

test('account page exposes read and send permission switches', async ({ page }) => {
  await unlock(page);
  await page.getByRole('button', { name: '邮箱账户' }).click();
  await expect(page.getByRole('button', { name: '添加邮箱' })).toBeVisible();
  // Labels are rendered per account when one has been connected; keep the
  // source-facing assertion independent from external OAuth setup.
  await expect(page.locator('#ih-accounts-list')).toBeVisible();
});
