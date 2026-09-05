const test = require('node:test');
const assert = require('node:assert/strict');
const { detectProvider, normalizeProvider, supportsOAuth, validateOAuthIdentity } = require('../providers');

test('detects common mailbox brands without treating every domain as Microsoft', () => {
  assert.equal(detectProvider('a@gmail.com'), 'google');
  assert.equal(detectProvider('a@outlook.com'), 'microsoft');
  assert.equal(detectProvider('a@qq.com'), 'qq');
  assert.equal(detectProvider('a@foxmail.com'), 'qq');
  assert.equal(detectProvider('a@163.com'), 'netease');
  assert.equal(detectProvider('a@example.com'), 'other');
});

test('rejects OAuth responses without a trusted email identity', () => {
  const target = { id: 'one', username: 'owner@gmail.com' };
  assert.equal(validateOAuthIdentity([target], target, '').ok, false);
});

test('rejects OAuth identities that do not match the requested mailbox', () => {
  const target = { id: 'one', username: 'owner@gmail.com' };
  assert.match(validateOAuthIdentity([target], target, 'other@gmail.com').reason, /不一致/);
});

test('rejects an OAuth identity already owned by another account record', () => {
  const target = { id: 'one', username: 'owner@gmail.com' };
  const duplicate = { id: 'two', username: 'OWNER@gmail.com' };
  assert.match(validateOAuthIdentity([target, duplicate], target, 'owner@gmail.com').reason, /另一条/);
});

test('preserves an explicitly selected OAuth connector for custom domains', () => {
  assert.equal(normalizeProvider('google', 'a@company.example'), 'google');
  assert.equal(normalizeProvider('microsoft', 'a@company.example'), 'microsoft');
  assert.equal(normalizeProvider('microsoft', 'a@qq.com'), 'qq');
  assert.equal(supportsOAuth('qq'), false);
});
