const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function dataDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const real = fs.realpathSync(directory);
  if (fs.lstatSync(real).isSymbolicLink()) throw new Error('DATA_DIR 不能是符号链接');
  return real;
}
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } }
function acquireInstanceLock(directory) {
  const root = dataDirectory(directory), lockPath = path.join(root, 'instance.lock'), token = crypto.randomBytes(24).toString('hex');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      const details = { pid: process.pid, startedAt: new Date().toISOString(), token };
      fs.writeFileSync(fd, JSON.stringify(details)); fs.fsyncSync(fd); fs.closeSync(fd);
      return { directory: root, lockPath, token, release() {
        try { const current = JSON.parse(fs.readFileSync(lockPath, 'utf8')); if (current.token === token) fs.unlinkSync(lockPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      } };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let existing; try { existing = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { existing = null; }
      if (existing?.pid && pidAlive(existing.pid)) throw new Error(`已有 InboxHarbor 实例正在使用 DATA_DIR（PID ${existing.pid}）`);
      // Claim stale cleanup atomically. Only the process that wins this rename may
      // discard the stale lock, so two concurrent starters cannot both proceed.
      const quarantine = path.join(root, `instance.lock.stale-${crypto.randomUUID()}`);
      try { fs.renameSync(lockPath, quarantine); fs.unlinkSync(quarantine); } catch (renameError) { if (renameError.code !== 'ENOENT') continue; }
    }
  }
  throw new Error('无法获取实例锁');
}
module.exports = { acquireInstanceLock, dataDirectory };
