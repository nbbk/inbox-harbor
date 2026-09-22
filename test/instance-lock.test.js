const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { acquireInstanceLock } = require('../instance-lock');

function holder(dir, busyMs = 2_000) {
  const child = spawn(process.execPath, [path.join(__dirname, 'fixtures', 'lease-holder.js'), dir, '700', '150', String(busyMs)], { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (data) => { output += data; if (output.includes('ready')) resolve(child); });
    child.once('error', reject);
    child.once('exit', (code) => { if (!output.includes('ready')) reject(new Error(`holder exited ${code}`)); });
  });
}

test('active shared-data lease rejects a second holder and release matches its nonce', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-lease-'));
  const first = acquireInstanceLock(dir, { staleMs: 2_000 });
  assert.throws(() => acquireInstanceLock(dir, { staleMs: 2_000 }), /活动租约/);
  fs.writeFileSync(path.join(dir, 'instance.lease', 'owner.json'), JSON.stringify({ token: 'other' }));
  first.release();
  assert.equal(fs.existsSync(path.join(dir, 'instance.lease')), true);
  fs.rmSync(path.join(dir, 'instance.lease'), { recursive: true, force: true });
});

test('stale lease from a crashed process is atomically taken over', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-lease-stale-')), lease = path.join(dir, 'instance.lease');
  fs.mkdirSync(lease); fs.writeFileSync(path.join(lease, 'owner.json'), JSON.stringify({ token: 'crashed' }));
  const old = new Date(Date.now() - 5_000); fs.utimesSync(lease, old, old);
  const lock = acquireInstanceLock(dir, { staleMs: 1_000 });
  assert.notEqual(lock.token, 'crashed'); lock.release();
});

test('expired legacy single-file lock upgrades only when no v2 lease exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-lease-legacy-')), oldPath = path.join(dir, 'instance.lock');
  fs.writeFileSync(oldPath, JSON.stringify({ pid: 1, token: 'legacy' })); const old = new Date(Date.now() - 5_000); fs.utimesSync(oldPath, old, old);
  const lock = acquireInstanceLock(dir, { staleMs: 1_000 });
  assert.equal(fs.existsSync(oldPath), false); assert.equal(fs.existsSync(path.join(dir, 'instance.lease')), true); lock.release();
});

test('worker heartbeat keeps lease alive while holder main thread is synchronously busy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-lease-worker-'));
  const child = await holder(dir, 1_800);
  await new Promise((resolve) => setTimeout(resolve, 1_050));
  assert.throws(() => acquireInstanceLock(dir, { staleMs: 700, updateMs: 150 }), /活动租约/);
  child.kill('SIGKILL');
  await new Promise((resolve) => child.once('exit', resolve));
});

test('a crashed holder is taken over only after its lease becomes stale', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-lease-crash-'));
  const child = await holder(dir, 10_000);
  child.kill('SIGKILL');
  await new Promise((resolve) => child.once('exit', resolve));
  assert.throws(() => acquireInstanceLock(dir, { staleMs: 700, updateMs: 150 }), /活动租约/);
  await new Promise((resolve) => setTimeout(resolve, 1_150));
  const lock = acquireInstanceLock(dir, { staleMs: 700, updateMs: 150 });
  lock.release();
});
