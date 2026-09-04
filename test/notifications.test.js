const test = require('node:test');
const assert = require('node:assert/strict');
const { CHANNELS, publicConfig, messageFor, dingtalkSignedUrl, validateEmailConfig } = require('../notifications');

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
