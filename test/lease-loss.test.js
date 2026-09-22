const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('lease owner replacement fail-closes HTTP, polling storage, and exits nonzero without deleting successor lease', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-lease-loss-')), previous = { DATA_DIR: process.env.DATA_DIR, PORT: process.env.PORT, INBOXHARBOR_ADMIN_TOKEN: process.env.INBOXHARBOR_ADMIN_TOKEN };
  process.env.DATA_DIR = dir; process.env.PORT = '5567'; process.env.INBOXHARBOR_ADMIN_TOKEN = 'lease-loss-token';
  delete require.cache[require.resolve('../server')];
  const runtime = require('../server'), exits = [];
  const server = runtime.startServer({ exit: (code) => exits.push(code), lockOptions: { staleMs: 2_000, updateMs: 500 } });
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const lease = runtime.__instanceLock();
    fs.writeFileSync(path.join(lease.lockPath, 'owner.json'), JSON.stringify({ version: 2, token: 'successor-token' }));
    for (let i = 0; i < 20 && !exits.length; i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(exits, [1]);
    assert.equal(server.listening, false);
    assert.throws(() => runtime.__storage.db.prepare('SELECT 1').get());
    assert.equal(JSON.parse(fs.readFileSync(path.join(lease.lockPath, 'owner.json'), 'utf8')).token, 'successor-token');
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    if (previous.DATA_DIR === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous.DATA_DIR;
    if (previous.PORT === undefined) delete process.env.PORT; else process.env.PORT = previous.PORT;
    if (previous.INBOXHARBOR_ADMIN_TOKEN === undefined) delete process.env.INBOXHARBOR_ADMIN_TOKEN; else process.env.INBOXHARBOR_ADMIN_TOKEN = previous.INBOXHARBOR_ADMIN_TOKEN;
  }
});
