const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const { UserRepository } = require('../repository');
const { loadTenantState } = require('../tenant-state');

async function boot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-local-deletion-'));
  const keys = ['DATA_DIR', 'INBOXHARBOR_ADMIN_TOKEN'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.DATA_DIR = dir;
  process.env.INBOXHARBOR_ADMIN_TOKEN = 'local-deletion-test-token';
  const realFetch = global.fetch;
  const upstreamCalls = [];
  // Local fixture requests use the saved fetch. Every provider transport,
  // including Google proxy discovery, is blocked before the server is loaded.
  for (const [target, method] of [[global, 'fetch'], [http, 'request'], [https, 'request'], [tls, 'connect']]) {
    t.mock.method(target, method, (...args) => {
      upstreamCalls.push({ method, target: String(args[0]) });
      throw new Error('Provider traffic is forbidden in local-deletion tests');
    });
  }
  delete require.cache[require.resolve('../server')];
  const service = require('../server');
  const server = service.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const id of ['alice', 'bob']) {
    service.__storage.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?)')
      .run(id, `${id}@example.test`, 'unused-fixture-password-hash', 'user', 1, 'now', 'now');
  }
  const cookie = `inboxharbor_session=${service.__auth.createSession({ id: 'alice', email: 'alice@example.test', role: 'user' })}`;
  t.after(async () => {
    try {
      service.setSyncCoreForTest(null);
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      service.closeStorage();
    } finally {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.deepEqual(upstreamCalls, [], 'Deleting local data must never call a provider');
  });
  return {
    service,
    alice: new UserRepository(service.__storage, 'alice'),
    bob: new UserRepository(service.__storage, 'bob'),
    call(route, method = 'GET') {
      return realFetch(base + route, { method, headers: { cookie, Connection: 'close' } });
    },
  };
}

function addAccount(repo, provider, username) {
  return repo.insert('accounts', {
    username, provider, status: 'active', readEnabled: true, syncEnabled: false,
    note: 'fixture-refresh-token', providerScopes: provider === 'google'
      ? 'https://www.googleapis.com/auth/gmail.readonly' : 'Mail.Read',
  }, { provider, address: username });
}

function sourceMail(provider, username, id) {
  return {
    id, provider, account: username, sender: 'receipts@example.test',
    subject: `Receipt ${id}`, content: 'Fixture body', receivedAt: '2026-10-01T00:00:00.000Z',
    hasAttachments: true, attachments: [{ name: 'receipt.pdf', size: 128, contentType: 'application/pdf' }],
    labelIds: ['INBOX', 'UNREAD'],
  };
}

for (const provider of ['google', 'microsoft']) {
  for (const action of ['delete', 'clear']) {
    test(`${provider} ${action} removes local attachment metadata and suppresses source replay without provider calls`, async t => {
      const h = await boot(t);
      const accountId = addAccount(h.alice, provider, 'alice@example.test');
      const bobAccountId = addAccount(h.bob, provider, 'bob@example.test');
      const originals = [sourceMail(provider, 'alice@example.test', 'provider-1'), sourceMail(provider, 'alice@example.test', 'provider-2')];
      const snapshot = structuredClone(originals);
      const localIds = originals.map(mail => h.alice.insert('messages', mail, { account_id: accountId }));
      const bobMailId = h.bob.insert('messages', sourceMail(provider, 'bob@example.test', 'provider-1'), { account_id: bobAccountId });
      const shares = localIds.map(id => h.service.getOrCreateShare('alice', id));
      const bobShare = h.service.getOrCreateShare('bob', bobMailId);
      const before = await (await h.call('/api/mails')).json();
      assert.equal(before.mails.length, 2);
      assert.deepEqual(before.mails.find(mail => mail.id === localIds[0]).attachments, originals[0].attachments);
      assert.equal((await h.call(`/api/mails/${bobMailId}`, 'DELETE')).status, 404);

      const response = action === 'delete'
        ? await h.call(`/api/mails/${localIds[0]}`, 'DELETE')
        : await h.call('/api/mails/clear', 'POST');
      assert.equal(response.status, 200);
      assert.equal((await response.json()).success, true);
      const removedIds = action === 'delete' ? [localIds[0]] : localIds;
      const tombstones = new Set(h.alice.list('tombstones').map(row => row.mail_id));
      for (const id of removedIds) {
        assert.equal(h.alice.get('messages', id), null, 'The local message and its embedded attachment metadata are gone');
        assert.ok(tombstones.has(id));
        const index = localIds.indexOf(id);
        assert.ok(tombstones.has(`${accountId}:${provider}:${originals[index].id}`));
        assert.ok([...tombstones].some(value => value.startsWith('fp_') && value.endsWith(`___${originals[index].id}`)));
        const share = shares[index];
        assert.equal((await h.call(`/shared/mail/${share.token}`)).status, 404);
      }
      assert.equal(tombstones.has('provider-1'), false, 'New tombstones use account-scoped source identities');
      assert.equal(h.alice.list('messages').length, action === 'delete' ? 1 : 0);
      assert.ok(h.bob.get('messages', bobMailId), 'Another user’s local archive is untouched');
      assert.equal(h.bob.list('tombstones').length, 0);
      assert.equal((await h.call(`/shared/mail/${bobShare.token}`)).status, 200);
      assert.ok(h.alice.get('accounts', accountId), 'Mail deletion keeps the mailbox connection');

      // Exercise the real merge and persistence boundary with mocked source
      // records, proving later sync cannot restore a locally deleted message.
      h.service.setSyncCoreForTest(async (account, state) => h.service.mergeFetchedMails(account, state, structuredClone(originals), false));
      const replay = await h.service.syncAndPersistAccount('alice', accountId);
      assert.equal(replay.persistedNewMails.length, 0);
      assert.equal(replay.notifiableMails.length, 0);
      assert.equal(h.alice.list('messages').length, action === 'delete' ? 1 : 0);
      assert.deepEqual(originals, snapshot, 'Source records, attachments and labels stay unchanged');
      const state = loadTenantState(h.service.__storage, 'alice');
      assert.ok(state.tombstones.length >= removedIds.length * 3);
    });
  }
}

test('deleting a mailbox connection leaves its local mail archive and attachment metadata detached', async t => {
  const h = await boot(t);
  const accountId = addAccount(h.alice, 'google', 'alice@example.test');
  const source = sourceMail('google', 'alice@example.test', 'provider-1');
  const mailId = h.alice.insert('messages', source, { account_id: accountId });
  assert.equal((await h.call(`/api/accounts/${accountId}`, 'DELETE')).status, 200);
  assert.equal(h.alice.get('accounts', accountId), null);
  const row = h.alice.get('messages', mailId);
  assert.equal(row.account_id, null);
  assert.deepEqual(row.payload.attachments, source.attachments);
  assert.deepEqual(row.payload.labelIds, source.labelIds);
  assert.equal(h.alice.list('tombstones').length, 0);
  const mails = await (await h.call('/api/mails')).json();
  assert.equal(mails.mails[0].id, mailId);
});
