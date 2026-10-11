const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { UserRepository } = require('../repository');

test('share list projects tenant-owned subject and dates without tokens; public links honor expiry and revoke', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-share-list-'));
  process.env.INBOXHARBOR_ADMIN_TOKEN = 'share-list-test-token';
  delete require.cache[require.resolve('../server')];
  const { app, __auth, __storage, getOrCreateShare, closeStorage } = require('../server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const owner = await __auth.bootstrapOwner('owner@example.test', 'long safe password');
    for (const email of ['alice@example.test', 'bob@example.test']) {
      const invite = __auth.createInvitation(owner, email, 'user');
      await __auth.acceptInvitation(invite, email, 'long safe password');
    }
    const ids = Object.fromEntries(__auth.listUsers().map(user => [user.email, user.id]));
    const aliceRepo = new UserRepository(__storage, ids['alice@example.test']);
    const bobRepo = new UserRepository(__storage, ids['bob@example.test']);
    const aliceMail = aliceRepo.insert('messages', { subject: 'Alice private title', content: 'Alice body' }, { account_id: null });
    const bobMail = bobRepo.insert('messages', { subject: 'Bob private title', content: 'Bob body' }, { account_id: null });
    const active = getOrCreateShare(ids['alice@example.test'], aliceMail, 1);
    const foreign = getOrCreateShare(ids['bob@example.test'], bobMail, 1);
    const login = async email => {
      const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'long safe password' }) });
      assert.equal(response.status, 200);
      return response.headers.get('set-cookie').split(';')[0];
    };
    const aliceCookie = await login('alice@example.test');
    const bobCookie = await login('bob@example.test');
    const list = async cookie => {
      const response = await fetch(`${base}/api/share-links`, { headers: { cookie } });
      assert.equal(response.status, 200);
      return (await response.json()).links;
    };
    assert.deepEqual((await list(aliceCookie)).map(link => link.id), [active.id]);
    assert.deepEqual((await list(bobCookie)).map(link => link.id), [foreign.id]);
    const [link] = await list(aliceCookie);
    assert.equal(link.mail_id, aliceMail);
    assert.equal(link.mailSubject, 'Alice private title');
    assert.equal(link.expiresAt, active.expiresAt);
    assert.equal(link.expires_at, active.expiresAt);
    assert.equal(link.revokedAt, null);
    assert.equal(link.revoked_at, null);
    assert.equal(JSON.stringify(link).includes('Bob private title'), false);
    for (const field of ['token', 'token_hash', 'token_ciphertext', 'payload', 'mail_payload', 'user_id']) assert.equal(Object.hasOwn(link, field), false, field);
    const publicUrl = `${base}/shared/mail/${active.token}`;
    assert.equal((await fetch(publicUrl)).status, 200);
    __storage.db.prepare('UPDATE share_links SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', active.id);
    assert.equal((await fetch(publicUrl)).status, 404);
    const [expired] = await list(aliceCookie);
    assert.equal(expired.expiresAt, '2000-01-01T00:00:00.000Z');
    __storage.db.prepare('UPDATE share_links SET expires_at=?,revoked_at=? WHERE id=?').run('2999-01-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', active.id);
    assert.equal((await fetch(publicUrl)).status, 404);
    assert.equal((await list(aliceCookie))[0].revokedAt, '2026-10-01T00:00:00.000Z');
  } finally {
    server.close();
    closeStorage();
  }
});
