const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadOrCreateAdminToken } = require('../instance-config');

test('admin token is generated once and reused', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inboxharbor-token-'));
  const first = loadOrCreateAdminToken(directory, {});
  const second = loadOrCreateAdminToken(directory, {});
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.token, first.token);
  assert.ok(first.token.length >= 40);
});

test('environment token takes precedence', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inboxharbor-token-'));
  assert.equal(loadOrCreateAdminToken(directory, { INBOXHARBOR_ADMIN_TOKEN: 'custom-token' }).token, 'custom-token');
});
