const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('notification save and test endpoints enforce role-aware outbound policy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-notification-policy-'));
  process.env.DATA_DIR = dir;
  process.env.INBOXHARBOR_ADMIN_TOKEN = 'notification-policy-token';
  delete require.cache[require.resolve('../server')];
  const { app, __auth, closeStorage } = require('../server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const owner = await __auth.bootstrapOwner('owner@policy.test', 'long safe password');
    const memberInvite = __auth.createInvitation(owner, 'member@policy.test');
    const adminInvite = __auth.createInvitation(owner, 'admin@policy.test', 'admin');
    await __auth.acceptInvitation(memberInvite, 'member@policy.test', 'long safe password');
    await __auth.acceptInvitation(adminInvite, 'admin@policy.test', 'long safe password');
    const login = async (email) => {
      const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'long safe password' }) });
      assert.equal(response.status, 200);
      return response.headers.get('set-cookie').split(';')[0];
    };
    const memberCookie = await login('member@policy.test');
    const adminCookie = await login('admin@policy.test');
    const ownerCookie = await login('owner@policy.test');
    const put = (cookie, channels) => fetch(`${base}/api/v1/notifications`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ channels }) });
    const memberWebhook = await put(memberCookie, [{ type: 'webhook', enabled: true, config: { url: 'https://hooks.example.com/member' } }]);
    assert.equal(memberWebhook.status, 400);
    assert.match((await memberWebhook.json()).message, /仅 Owner/);
    const memberBypass = await fetch(`${base}/api/v1/notifications/bark/test`, { method: 'POST', headers: { cookie: memberCookie, 'content-type': 'application/json' }, body: JSON.stringify({ config: { deviceKey: 'dev', serverUrl: 'https://bark.example.com' } }) });
    assert.equal(memberBypass.status, 400);
    assert.match((await memberBypass.json()).message, /官方地址/);
    const adminWebhook = await put(adminCookie, [{ type: 'webhook', enabled: true, config: { url: 'https://hooks.example.com/admin' } }]);
    assert.equal(adminWebhook.status, 400);
    assert.match((await adminWebhook.json()).message, /仅 Owner/);
    const ownerWebhook = await put(ownerCookie, [{ type: 'webhook', enabled: true, config: { url: 'https://hooks.example.com/owner' } }]);
    assert.equal(ownerWebhook.status, 200);
    const ownerPrivate = await put(ownerCookie, [{ type: 'webhook', enabled: true, config: { url: 'http://127.0.0.1:8080/internal' } }]);
    assert.equal(ownerPrivate.status, 400);
    assert.match((await ownerPrivate.json()).message, /内网/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    closeStorage();
  }
});
