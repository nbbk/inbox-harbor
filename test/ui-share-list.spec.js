const { test, expect } = require('@playwright/test');

test('profile renders share subjects, dates, states and only active revoke action', async ({ page }) => {
  const future = '2999-01-01T00:00:00.000Z';
  const past = '2000-01-01T00:00:00.000Z';
  const revoked = '2026-01-01T00:00:00.000Z';
  const links = [
    { id: 'active', mailSubject: 'Active subject', expiresAt: future, revokedAt: null },
    { id: 'expired', mailSubject: 'Expired subject', expiresAt: past, revokedAt: null },
    { id: 'revoked', mailSubject: 'Revoked subject', expiresAt: future, revokedAt: revoked },
    { id: 'unknown', mailSubject: 'Unknown date', expiresAt: null, revokedAt: null },
  ];
  const mutations = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') {
      mutations.push({ method: request.method(), path: url.pathname });
      await route.fulfill({ json: { success: true } });
      return;
    }
    const responses = {
      '/api/auth/config': { ownerInitialized: true, user: { id: 'share-user', email: 'share@example.test', role: 'user' } },
      '/api/auth/branding': { siteName: 'InboxHarbor', logoDataUrl: '' },
      '/api/accounts': { accounts: [] },
      '/api/mails': { mails: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 }, facets: {} },
      '/api/share-links': { links },
      '/api/v1/notifications': { catalog: {}, configuration: { channels: [] } },
      '/api/v1/notifications/deliveries': { deliveries: [], total: 0 },
      '/api/v1/connectors/status': { connectors: {} },
    };
    await route.fulfill({ json: responses[url.pathname] || {} });
  });
  await page.goto('/');
  await page.locator('.ih-side [data-page=profile]').click();
  const shares = page.locator('#ih-shares');
  await expect(shares.locator('.ih-simple-row')).toHaveCount(4);
  await expect(shares.locator('.ih-simple-row').nth(0)).toContainText(`Active subject · ${new Date(future).toLocaleString('zh-CN')} · 有效`);
  await expect(shares.locator('.ih-simple-row').nth(1)).toContainText(`Expired subject · ${new Date(past).toLocaleString('zh-CN')} · 已过期`);
  await expect(shares.locator('.ih-simple-row').nth(2)).toContainText('Revoked subject');
  await expect(shares.locator('.ih-simple-row').nth(2)).toContainText('已撤销');
  await expect(shares.locator('.ih-simple-row').nth(3)).toContainText('Unknown date · 有效期未知 · 状态未知');
  await expect(shares.getByRole('button', { name: '撤销' }).nth(0)).toBeEnabled();
  for (let index = 1; index < 4; index++) await expect(shares.getByRole('button', { name: '撤销' }).nth(index)).toBeDisabled();
  await expect.poll(() => mutations).toEqual([]);
  await shares.getByRole('button', { name: '撤销' }).nth(0).click();
  await expect.poll(() => mutations).toEqual([{ method: 'POST', path: '/api/share-links/active/revoke' }]);
});
