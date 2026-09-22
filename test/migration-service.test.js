const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Storage } = require('../storage');
const { AuthService } = require('../auth');
const { migrate, backup, restoreBackup, verifyBackup, recoverInterruptedRestore, setDirectorySync } = require('../migration-service');
function setup(key = 5) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-migrate-')); const storage = new Storage(dir, { key: Buffer.alloc(32, key) }); return { dir, storage, auth: new AuthService(storage) }; }

test('complete legacy migration encrypts every supported legacy collection', async () => {
  const { dir, storage, auth } = setup(); await auth.bootstrapOwner('o@x.com', 'password long enough');
  const state = { accounts: [{ username: 'a@x.com', provider: 'google', note: 'secret' }], mails: [{ account: 'missing@x.com', content: 'orphan' }], notificationConfig: { channels: [{ type: 'bark', config: { key: 'secret' } }] }, tgConfig: { enabled: true, token: 'tg-secret' }, notificationDeliveries: [{ status: 'sent' }], classificationRules: [{ when: 'invoice' }], clearedMailIds: ['mail-1'], connectorConfig: { googleClientSecret: 'connector-secret' } };
  const out = migrate(storage, state, { backupDir: dir });
  assert.equal(out.report.orphans, 1); assert.deepEqual(out.report.migrated, { accounts: 1, mails: 1, channels: 2, deliveries: 1, rules: 1, tombstones: 1, connectorSettings: 1 });
  assert.equal(storage.db.prepare('SELECT account_id FROM mail_messages').get().account_id, null);
  assert.equal(storage.db.prepare('SELECT payload FROM mail_accounts').get().payload.includes('secret'), false);
  const ownerId = storage.db.prepare("SELECT id FROM users WHERE role='owner'").get().id;
  assert.equal(storage.decrypt(storage.db.prepare('SELECT value FROM instance_settings WHERE key=?').get(`owner:${ownerId}:connector_config`).value).googleClientSecret, 'connector-secret');
  assert.equal(migrate(storage, state).alreadyMigrated, true); storage.close();
});
test('empty and telegram-only migrations are valid', async () => {
  for (const state of [{}, { tgConfig: { token: 'legacy-token', chatId: '1' } }]) {
    const { storage, auth } = setup(6); await auth.bootstrapOwner(`o${Math.random()}@x.com`, 'password long enough'); const out = migrate(storage, state); assert.equal(out.report.migrated.channels, state.tgConfig ? 1 : 0); storage.close();
  }
});
test('migration rollback leaves no business rows on failure', async () => {
  const { storage, auth } = setup(7); await auth.bootstrapOwner('o@x.com', 'password long enough');
  assert.throws(() => migrate(storage, { accounts: [{ username: 'a@x.com' }] }, { failAfter: 1 }));
  assert.equal(storage.db.prepare('SELECT COUNT(*) AS n FROM mail_accounts').get().n, 0); storage.close();
});
test('backup manifest is constrained and can restore a closed database', async () => {
  const { dir, storage, auth } = setup(8); await auth.bootstrapOwner('o@x.com', 'password long enough'); const out = migrate(storage, {}, { backupDir: dir }); storage.close();
  verifyBackup(dir, out.backupPath); assert.throws(() => verifyBackup(dir, path.join(dir, '..', 'not-a-backup')));
  fs.writeFileSync(path.join(dir, 'inboxharbor.db'), 'changed'); setDirectorySync(()=>{}); try { const result = restoreBackup(dir, out.backupPath); assert.ok(result.restored.includes('inboxharbor.db')); assert.notEqual(fs.readFileSync(path.join(dir, 'inboxharbor.db')).toString(), 'changed'); } finally { setDirectorySync(null); }
});
test('wrong key makes encrypted migrated payload unavailable', async () => {
  const { storage, auth } = setup(9); await auth.bootstrapOwner('o@x.com', 'password long enough'); migrate(storage, { accounts: [{ username: 'a@x.com', note: 'secret' }] }); const payload = storage.db.prepare('SELECT payload FROM mail_accounts').get().payload; storage.close();
  const { storage: wrong } = setup(10); assert.throws(() => wrong.decrypt(payload)); wrong.close();
});
test('interrupted generation restore recovers a readable db and matching key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-restore-')); const storage = new Storage(dir); storage.save({ generation: 'old' }); const snapshot = backup(dir, storage); storage.save({ generation: 'new' }); storage.close();
  setDirectorySync(()=>{}); try { assert.throws(() => restoreBackup(dir, snapshot.path, { failAfterRename: 1 }), /injected/); assert.equal(recoverInterruptedRestore(dir).recovered, true); } finally { setDirectorySync(null); }
  const reopened = new Storage(dir); assert.equal(reopened.load({}, null).generation, 'old'); reopened.close(); assert.equal(fs.existsSync(path.join(dir, 'restore-journal.json')), false);
});
test('recovery rejects a journal with a path traversal stage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-journal-'));
  fs.writeFileSync(path.join(dir, 'restore-journal.json'), JSON.stringify({ version: 1, root: path.resolve(dir), stage: path.join(dir, '..', 'escape'), previous: path.join(dir, 'previous'), phase: 'validated', files: [], manifest: { files: [] } }));
  assert.throws(() => recoverInterruptedRestore(dir), /DATA_DIR/);
});
test('critical durability preflight changes no live files when unavailable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-preflight-')); const storage = new Storage(dir); storage.save({ stable: true }); const snapshot = backup(dir, storage); storage.close(); const before = fs.readFileSync(path.join(dir, 'inboxharbor.db'));
  setDirectorySync((_dir, options) => { if (options?.critical && options?.preflight) { const error = new Error('no durable directory sync'); error.code = 'DURABILITY_UNAVAILABLE'; throw error; } });
  try { assert.throws(() => restoreBackup(dir, snapshot.path), (error) => error.code === 'DURABILITY_UNAVAILABLE'); assert.deepEqual(fs.readFileSync(path.join(dir, 'inboxharbor.db')), before); assert.equal(fs.existsSync(path.join(dir, 'restore-journal.json')), false); } finally { setDirectorySync(null); }
});
