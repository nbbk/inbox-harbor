const test = require('node:test');
const assert = require('node:assert/strict');
const { CHANNELS, publicConfig, messageFor, dingtalkSignedUrl, validateEmailConfig, createShareToken, verifyShareToken, notificationDeliveryKey, clearOAuthSecrets } = require('../notifications');

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
