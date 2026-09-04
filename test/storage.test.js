const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Storage } = require('../storage');

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'inboxharbor-storage-')); }
test('encrypted sqlite state round-trips without plaintext secrets', () => {
  const dir = tempDir(); const storage = new Storage(dir, { key: Buffer.alloc(32, 7) });
  const state = { accounts: [{ username: 'a@example.com', note: 'refresh-secret' }], notificationConfig: { channels: [{ config: { token: 'bot-secret' } }] } };
  storage.save(state); storage.close();
  const bytes = fs.readFileSync(path.join(dir, 'inboxharbor.db')).toString('utf8');
  assert.equal(bytes.includes('refresh-secret'), false); assert.equal(bytes.includes('bot-secret'), false);
  const reopened = new Storage(dir, { key: Buffer.alloc(32, 7) }); assert.deepEqual(reopened.load({}, null), state); reopened.close();
});
test('legacy JSON is imported once and kept intact', () => {
  const dir = tempDir(); const legacy = path.join(dir, 'data.json'); const state = { accounts: [{ username: 'legacy@example.com' }] };
  fs.writeFileSync(legacy, JSON.stringify(state)); const storage = new Storage(dir, { key: Buffer.alloc(32, 3) });
  assert.deepEqual(storage.load({}, legacy), state); assert.equal(fs.existsSync(legacy), true); storage.close();
});
