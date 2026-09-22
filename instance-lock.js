const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Worker } = require('worker_threads');

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_UPDATE_MS = 10_000;
function dataDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const real = fs.realpathSync(directory);
  if (fs.lstatSync(real).isSymbolicLink()) throw new Error('DATA_DIR 不能是符号链接');
  return real;
}
function readOwner(leasePath) { try { return JSON.parse(fs.readFileSync(path.join(leasePath, 'owner.json'), 'utf8')); } catch { return null; } }
function isFresh(leasePath, staleMs, now = Date.now()) { try { return now - fs.statSync(leasePath).mtimeMs <= staleMs; } catch { return false; } }
function writeOwner(leasePath, owner) {
  const temp = path.join(leasePath, `owner.${owner.token}.tmp`), target = path.join(leasePath, 'owner.json');
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(owner)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, target);
}
function stopWorker(worker, control, updateMs) {
  Atomics.store(control, 0, 1); Atomics.notify(control, 0);
  // Wait for the worker to stop before deleting the lease: a late heartbeat
  // must never refresh a successor's lease.
  Atomics.wait(control, 1, 0, Math.max(1_000, updateMs * 2));
  worker.terminate().catch(() => {});
}
function acquireInstanceLock(directory, options = {}) {
  const root = dataDirectory(directory), staleMs = Math.max(1_000, Number(options.staleMs || process.env.INBOXHARBOR_LOCK_STALE_MS || DEFAULT_STALE_MS));
  const updateMs = Math.max(250, Math.min(staleMs / 2, Number(options.updateMs || DEFAULT_UPDATE_MS))), leasePath = path.join(root, 'instance.lease'), token = crypto.randomBytes(24).toString('hex');
  const old = path.join(root, 'instance.lock');
  if (!fs.existsSync(leasePath) && fs.existsSync(old)) {
    if (isFresh(old, staleMs)) throw new Error('检测到未过期的旧实例锁；请等待租约过期后重试');
    fs.renameSync(old, path.join(root, `instance.lock.legacy-${crypto.randomUUID()}`));
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.mkdirSync(leasePath, { mode: 0o700 });
      writeOwner(leasePath, { version: 2, token, startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() });
      const control = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2));
      const worker = new Worker(path.join(__dirname, 'instance-lock-worker.js'), { workerData: { leasePath, token, updateMs, control: control.buffer } });
      let lost = false;
      const lose = (error) => {
        if (lost) return;
        lost = true; stopWorker(worker, control, updateMs);
        options.onLost?.(error instanceof Error ? error : new Error(String(error || '实例锁租约已丢失')));
      };
      worker.on('message', (message) => { if (message?.type === 'lost') lose(new Error(message.error || '实例锁租约已被其他进程接管')); });
      worker.on('error', lose); worker.unref();
      return { directory: root, lockPath: leasePath, token, get lost() { return lost; }, release() {
        stopWorker(worker, control, updateMs);
        try { if (readOwner(leasePath)?.token === token) fs.rmSync(leasePath, { recursive: true, force: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      } };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (isFresh(leasePath, staleMs)) throw new Error('已有 InboxHarbor 实例正在使用 DATA_DIR（活动租约）');
      const quarantine = path.join(root, `instance.lease.stale-${crypto.randomUUID()}`);
      try { fs.renameSync(leasePath, quarantine); fs.rmSync(quarantine, { recursive: true, force: true }); } catch (renameError) { if (renameError.code !== 'ENOENT') continue; }
    }
  }
  if (fs.existsSync(old)) {
    if (isFresh(old, staleMs)) throw new Error('检测到未过期的旧实例锁；请等待租约过期后重试');
    fs.renameSync(old, path.join(root, `instance.lock.legacy-${crypto.randomUUID()}`));
    return acquireInstanceLock(root, options);
  }
  throw new Error('无法获取实例锁');
}
module.exports = { acquireInstanceLock, dataDirectory };
