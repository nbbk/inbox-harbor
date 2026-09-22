const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { CHANNELS, publicConfig, messageFor, postJson, dingtalkSignedUrl, validateEmailConfig, validateChannelPolicy, createShareToken, verifyShareToken, notificationDeliveryKey, clearOAuthSecrets } = require('../notifications');

test('notification catalog contains requested delivery channels', () => {
  for (const key of ['telegram', 'bark', 'wxpusher', 'pushplus', 'serverchan', 'wecom', 'dingtalk', 'webhook']) assert.ok(CHANNELS[key]);
});

test('public config never returns credentials', () => {
  const result = publicConfig({ channels: [{ id: 'a', type: 'telegram', enabled: true, config: { token: 'secret', chatId: '42' } }] });
  assert.deepEqual(result.channels[0].configured, { token: true, chatId: true });
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('mail notification preserves full content by default', () => {
  const message = messageFor({ subject: 'Welcome', account: 'person@example.com', content: 'Full message body' });
  assert.match(message.content, /Full message body/);
  assert.match(message.content, /person@example.com/);
});

test('notification uses preview and link instead of a long full body', () => {
  const message = messageFor({ subject: 'Welcome', preview: 'Short summary', content: 'Long private body', appUrl: 'https://mail.example/shared/1' });
  assert.match(message.content, /Short summary/);
  assert.match(message.content, /https:\/\/mail\.example\/shared\/1/);
  assert.doesNotMatch(message.content, /Long private body/);
  assert.doesNotMatch(message.html, /Long private body/);
});

test('DingTalk signing adds timestamp and URL-encoded HMAC signature', () => {
  const url = new URL(dingtalkSignedUrl('https://oapi.dingtalk.com/robot/send?access_token=x', 'SECdemo', '1700000000000'));
  assert.equal(url.searchParams.get('timestamp'), '1700000000000');
  assert.ok(url.searchParams.get('sign'));
});

test('SMTP email channel validates and normalizes transport configuration', () => {
  const smtp = validateEmailConfig({ host: 'smtp.example.com', port: '465', secure: 'true', username: 'u', password: 'p', from: 'from@example.com', to: 'to@example.com' });
  assert.equal(CHANNELS.email.name, '电子邮件（SMTP）'); assert.equal(smtp.port, 465); assert.equal(smtp.secure, true); assert.equal(smtp.auth.user, 'u');
  assert.throws(() => validateEmailConfig({}), /SMTP/);
});

test('member notification policy only permits official provider targets', () => {
  assert.throws(() => validateChannelPolicy({ type: 'webhook', enabled: true, config: { url: 'https://hooks.example.com/inbox' } }, 'user'), /仅 Owner/);
  assert.throws(() => validateChannelPolicy({ type: 'email', enabled: true, config: { host: 'smtp.example.com' } }, 'user'), /仅 Owner/);
  assert.throws(() => validateChannelPolicy({ type: 'bark', enabled: true, config: { serverUrl: 'https://bark.example.com' } }, 'user'), /官方地址/);
  assert.throws(() => validateChannelPolicy({ type: 'wecom', enabled: true, config: { webhookUrl: 'https://example.com/hook' } }, 'user'), /官方地址/);
  assert.equal(validateChannelPolicy({ type: 'bark', enabled: true, config: { serverUrl: 'https://api.day.app/' } }, 'user').config.serverUrl, 'https://api.day.app');
});

test('only Owner can configure advanced targets and private IPv6 forms are blocked', () => {
  assert.throws(() => validateChannelPolicy({ type: 'webhook', enabled: true, config: { url: 'https://hooks.example.com/inbox' } }, 'admin'), /仅 Owner/);
  assert.throws(() => validateChannelPolicy({ type: 'email', enabled: true, config: { host: 'smtp.example.com' } }, 'admin'), /仅 Owner/);
  assert.equal(validateChannelPolicy({ type: 'webhook', enabled: true, config: { url: 'https://hooks.example.com/inbox' } }, 'owner').config.url, 'https://hooks.example.com/inbox');
  for (const value of ['http://127.0.0.1:5555/', 'http://192.168.1.9/', 'http://169.254.169.254/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[0:0:0:0:0:ffff:7f00:1]/', 'http://printer.local/']) {
    assert.throws(() => validateChannelPolicy({ type: 'webhook', enabled: true, config: { url: value } }, 'owner'), /不允许指向本机、内网或链路本地地址/);
  }
  assert.throws(() => validateChannelPolicy({ type: 'webhook', enabled: true, config: { url: 'file:///etc/passwd' } }, 'owner'), /仅允许/);
});

test('notification HTTP requests reject redirects before an internal target is contacted', async () => {
  let internalHits = 0;
  const internal = http.createServer((req, res) => { internalHits++; res.end('unexpected'); });
  await new Promise(resolve => internal.listen(0, '127.0.0.1', resolve));
  const redirector = http.createServer((req, res) => { res.writeHead(302, { location: `http://127.0.0.1:${internal.address().port}/internal` }); res.end(); });
  await new Promise(resolve => redirector.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(() => postJson(`http://127.0.0.1:${redirector.address().port}/outbound`, { ok: true }));
    assert.equal(internalHits, 0);
  } finally {
    await Promise.all([new Promise(resolve => redirector.close(resolve)), new Promise(resolve => internal.close(resolve))]);
  }
});

test('shared mail tokens bind mail id and expiry and reject expired links', () => {
  const expires = 2_000_000;
  const token = createShareToken('secret', 'mail-1', expires);
  assert.equal(verifyShareToken('secret', 'mail-1', expires, token, expires - 1), true);
  assert.equal(verifyShareToken('secret', 'mail-2', expires, token, expires - 1), false);
  assert.equal(verifyShareToken('secret', 'mail-1', expires, token, expires), false);
  assert.equal(verifyShareToken('secret', 'mail-1', 'invalid', token, 0), false);
});

test('notification delivery identity deduplicates by mail and configured channel', () => {
  assert.equal(notificationDeliveryKey('mail-1', { id: 'telegram-main', type: 'telegram' }), 'mail-1:telegram-main');
  assert.equal(notificationDeliveryKey('mail-1', { type: 'bark' }), 'mail-1:bark');
});

test('account removal scrubs OAuth and cached token fields first', () => {
  const account = { id: 'a', username: 'a@example.com', note: 'refresh', refreshToken: 'r', accessToken: 'a', _cachedToken: 'c', _cachedExpiresAt: 123, password: 'legacy' };
  clearOAuthSecrets(account);
  assert.deepEqual(account, { id: 'a', username: 'a@example.com' });
});
