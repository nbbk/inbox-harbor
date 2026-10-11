const { test, expect } = require('@playwright/test');

async function mockArchive(page) {
  let accounts = [{ id: 'google-fixture', username: 'alice@gmail.com', provider: 'google', status: 'active', syncEnabled: false }];
  let mails = [{ id: 'mail-fixture', account: 'alice@gmail.com', provider: 'google', subject: '本地删除说明', sender: 'receipt@example.test', content: 'Fixture body', category: '其他', receivedAt: '2026-10-01T00:00:00.000Z', hasAttachments: true, attachments: [{ name: 'receipt.pdf', size: 128 }] }];
  const mutations = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') {
      mutations.push({ path: url.pathname, method: request.method() });
      if (url.pathname === '/api/mails/mail-fixture') mails = [];
      if (url.pathname === '/api/accounts/google-fixture') accounts = [];
      await route.fulfill({ json: { success: true } });
      return;
    }
    const responses = {
      '/api/auth/config': { ownerInitialized: true, user: { id: 'local-deletion-fixture', email: 'alice@example.test', role: 'user' } },
      '/api/auth/branding': { siteName: 'InboxHarbor', logoDataUrl: '' },
      '/api/accounts': { accounts },
      '/api/mails': { mails, pagination: { page: 1, pageSize: 50, total: mails.length, totalPages: 1 }, facets: { 全部: mails.length, 其他: mails.length } },
      '/api/v1/notifications': { catalog: {}, configuration: { channels: [] } },
      '/api/v1/notifications/deliveries': { deliveries: [], total: 0 },
      '/api/v1/connectors/status': { connectors: {} },
      '/api/share-links': { links: [] },
    };
    await route.fulfill({ json: responses[url.pathname] || {} });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '邮件中心' })).toBeVisible();
  await expect(page.locator('#ih-mail-reader')).toContainText('本地删除说明');
  return mutations;
}

async function decideConfirmation(page, trigger, accept) {
  const pending = page.waitForEvent('dialog');
  const clicking = trigger.click();
  const dialog = await pending;
  expect(dialog.type()).toBe('confirm');
  const message = dialog.message();
  if (accept) await dialog.accept();
  else await dialog.dismiss();
  await clicking;
  return message;
}

test('mail deletion explains that source messages and labels stay unchanged, including after cancel', async ({ page }) => {
  const mutations = await mockArchive(page);
  const remove = page.getByRole('button', { name: '删除邮件', exact: true });
  const cancelled = await decideConfirmation(page, remove, false);
  expect(cancelled).toContain('仅删除 InboxHarbor 本地副本');
  expect(cancelled).toContain('不会删除 Gmail / Microsoft 等原邮箱中的邮件');
  expect(cancelled).toContain('不会更改原邮箱标签');
  expect(mutations).toEqual([]);
  await expect(page.locator('#ih-mail-reader')).toContainText('receipt.pdf');
  expect(await decideConfirmation(page, remove, true)).toBe(cancelled);
  await expect.poll(() => mutations).toEqual([{ path: '/api/mails/mail-fixture', method: 'DELETE' }]);
  await expect(page.locator('#ih-mail-list')).not.toContainText('本地删除说明');
});

test('mailbox deletion explains that the connection is local and archived mail remains', async ({ page }) => {
  const mutations = await mockArchive(page);
  await page.locator('.ih-side [data-page=accounts]').click();
  const remove = page.locator('#ih-accounts-list').getByRole('button', { name: '删除', exact: true });
  const cancelled = await decideConfirmation(page, remove, false);
  expect(cancelled).toContain('alice@gmail.com 的 InboxHarbor 连接');
  expect(cancelled).toContain('已归档邮件仍保留');
  expect(cancelled).toContain('不会删除 Gmail / Microsoft 等原邮箱账户、邮件');
  expect(cancelled).toContain('不会更改原邮箱标签');
  expect(mutations).toEqual([]);
  expect(await decideConfirmation(page, remove, true)).toBe(cancelled);
  await expect.poll(() => mutations).toEqual([{ path: '/api/accounts/google-fixture', method: 'DELETE' }]);
  await expect(page.locator('#ih-accounts-list')).not.toContainText('alice@gmail.com');
  await page.locator('.ih-side [data-page=overview]').click();
  await expect(page.locator('#ih-mail-reader')).toContainText('receipt.pdf');
});

test('app-account deletion names InboxHarbor and explains that source mailboxes are untouched', async ({ page }) => {
  const mutations = await mockArchive(page);
  await page.locator('.ih-side [data-page=profile]').click();
  const remove = page.getByRole('button', { name: '永久删除我的账户' });
  for (const accept of [false, true]) {
    const prompting = page.waitForEvent('dialog');
    const clicking = remove.click();
    const password = await prompting;
    expect(password.type()).toBe('prompt');
    expect(password.message()).toContain('永久删除 InboxHarbor 账户');
    const confirming = page.waitForEvent('dialog');
    await password.accept('fixture current password');
    const confirmation = await confirming;
    expect(confirmation.type()).toBe('confirm');
    expect(confirmation.message()).toContain('InboxHarbor 账户、本站邮件归档、通知和共享链接将被永久删除');
    expect(confirmation.message()).toContain('Gmail / Microsoft 等原邮箱账户、邮件及标签不受影响');
    if (accept) await confirmation.accept();
    else await confirmation.dismiss();
    await clicking;
    if (!accept) expect(mutations).toEqual([]);
  }
  await expect.poll(() => mutations).toEqual([{ path: '/api/auth/me', method: 'DELETE' }]);
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
});
