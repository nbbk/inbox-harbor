const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { UserRepository } = require('../repository');
const { Storage } = require('../storage');

function boot(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.DATA_DIR = dir;
  process.env.INBOXHARBOR_ADMIN_TOKEN = 'race-regression-token';
  delete require.cache[require.resolve('../server')];
  return require('../server');
}
function addUser(storage, id) {
  storage.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?)').run(id, `${id}@example.test`, 'hash', 'user', 1, 'now', 'now');
}

test('sync keeps provider identity separate from local message ids and discards a stale account write', async () => {
  const { __storage, syncAndPersistAccount, setSyncCoreForTest, closeStorage } = boot('ih-provider-id-');
  try {
    addUser(__storage, 'alice');
    const repo = new UserRepository(__storage, 'alice');
    const accountId = repo.insert('accounts', { username: 'alice@example.test', provider: 'google', syncEnabled: true, readEnabled: true }, { provider: 'google', address: 'alice@example.test' });
    let release; const waiting = new Promise((resolve) => { release = resolve; });
    let entered; const enteredSync = new Promise((resolve) => { entered = resolve; });
    setSyncCoreForTest(async (account, state) => {
      entered();
      await waiting;
      state.mails.unshift({ id: 'gmail-provider-42', provider: 'google', account: account.username, subject: 'Race proof', receivedAt: new Date().toISOString() });
      account.note = 'stale-refresh-token';
      return state.mails.slice(0, 1);
    });
    const syncing = syncAndPersistAccount('alice', accountId);
    await enteredSync;
    const changed = repo.get('accounts', accountId);
    const revoked = { ...changed.payload, status: 'pending', note: '', syncEnabled: false };
    assert.equal(repo.update('accounts', accountId, revoked, { provider: 'google', address: revoked.username }), true);
    release();
    const result = await syncing;
    assert.equal(result.stale, true);
    assert.equal(repo.list('messages').length, 0);
    assert.equal(repo.get('accounts', accountId).payload.note, '');

    setSyncCoreForTest(async (account, state) => {
      state.mails.unshift({ id: 'gmail-provider-42', provider: 'google', account: account.username, subject: 'Stored identity', receivedAt: new Date().toISOString() });
      return state.mails.slice(0, 1);
    });
    const restored = { ...repo.get('accounts', accountId).payload, syncEnabled: true };
    repo.update('accounts', accountId, restored, { provider: 'google', address: restored.username });
    const persisted = await syncAndPersistAccount('alice', accountId);
    assert.equal(persisted.persistedNewMails.length, 1);
    const row = repo.list('messages')[0];
    assert.notEqual(row.id, 'gmail-provider-42');
    assert.equal(row.payload.id, 'gmail-provider-42');
    assert.equal(row.payload.sourceId, 'gmail-provider-42');
    assert.equal(row.payload.sourceKey, `${accountId}:google:gmail-provider-42`);
  } finally {
    setSyncCoreForTest(null);
    closeStorage();
  }
});

test('concurrent notification callers acquire one durable delivery claim', async () => {
  const { __storage, pushTenantNotifications, closeStorage } = boot('ih-delivery-claim-');
  try {
    addUser(__storage, 'alice');
    const repo = new UserRepository(__storage, 'alice');
    const channelId = repo.insert('channels', { enabled: true, type: 'telegram', config: { token: 't', chatId: '1' } }, { type: 'telegram' });
    const messageId = repo.insert('messages', { subject: 'One event' }, { account_id: null });
    let sends = 0; let release; const blocked = new Promise((resolve) => { release = resolve; });
    const deps = { sendFn: async () => { sends++; await blocked; }, messageForFn: (mail) => mail };
    const first = pushTenantNotifications([{ userId: 'alice', mail: { id: messageId, subject: 'One event' } }], deps);
    await new Promise((resolve) => setImmediate(resolve));
    const second = pushTenantNotifications([{ userId: 'alice', mail: { id: messageId, subject: 'One event' } }], deps);
    release();
    await Promise.all([first, second]);
    assert.equal(sends, 1);
    const delivery = __storage.db.prepare('SELECT status FROM notification_deliveries WHERE user_id=? AND channel_id=? AND message_id=?').get('alice', channelId, messageId);
    assert.equal(JSON.parse(delivery.status).state, 'delivered');
    assert.equal(__storage.db.prepare('SELECT count(*) AS count FROM notification_deliveries').get().count, 1);
  } finally {
    closeStorage();
  }
});

test('CAS version advances even when writes land in the same millisecond', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-cas-clock-'));
  const storage = new Storage(dir, { key: Buffer.alloc(32, 9) });
  try {
    addUser(storage, 'clock'); const repo = new UserRepository(storage, 'clock');
    const id = repo.insert('accounts', { username: 'clock@example.test', provider: 'google' }, { provider: 'google', address: 'clock@example.test' });
    const first = repo.get('accounts', id); repo.update('accounts', id, first.payload, { provider: 'google', address: first.payload.username });
    const second = repo.get('accounts', id); assert.ok(Date.parse(second.updated_at) > Date.parse(first.updated_at));
  } finally { storage.close(); }
});

test('actual merge path scopes provider ids by account and honors a scoped deletion replay', () => {
  const { mergeFetchedMails, closeStorage } = boot('ih-source-boundary-');
  try {
    const a = { id: 'account-a', username: 'a@example.test', provider: 'google' };
    const b = { id: 'account-b', username: 'b@example.test', provider: 'google' };
    const state = { mails: [], clearedMailIds: [] };
    const first = mergeFetchedMails(a, state, [{ id: 'provider-1', provider: 'google', account: a.username, sender: 's@example.test', subject: 'code', receivedAt: '2026-01-01T00:00:00.000Z' }], false);
    assert.equal(first.length, 1);
    assert.equal(mergeFetchedMails(a, state, [{ id: 'provider-1', provider: 'google', account: a.username, sender: 's@example.test', subject: 'code', receivedAt: '2026-01-01T00:00:00.000Z' }], false).length, 0);
    state.mails = []; state.clearedMailIds = [first[0].sourceKey];
    assert.equal(mergeFetchedMails(a, state, [{ id: 'provider-1', provider: 'google', account: a.username, sender: 's@example.test', subject: 'code', receivedAt: '2026-01-01T00:00:00.000Z' }], false).length, 0);
    assert.equal(mergeFetchedMails(b, state, [{ id: 'provider-1', provider: 'google', account: b.username, sender: 's@example.test', subject: 'code', receivedAt: '2026-01-01T00:00:00.000Z' }], false).length, 1);
  } finally { closeStorage(); }
});
