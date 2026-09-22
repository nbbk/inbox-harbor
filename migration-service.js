const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const address = (value) => String(value || '').trim().toLowerCase();
const defaultDirectorySync = (directory, { critical = false } = {}) => {
  // POSIX fsyncs the parent directory metadata. Windows does not reliably allow a
  // directory handle; rename is MoveFileEx-backed there and unsupported directory
  // fsync errors are explicit compatibility exceptions, not a claim of durability.
  try { const fd = fs.openSync(directory, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
  catch (error) { if (process.platform === 'win32' && ['EINVAL', 'EPERM', 'EACCES'].includes(error.code)) { if (critical) { const failure = new Error('当前 Windows 文件系统无法确认目录持久化；请在 Linux/Docker 中执行迁移恢复，或停服后进行人工完整备份。'); failure.code = 'DURABILITY_UNAVAILABLE'; throw failure; } return; } throw error; }
};
let directorySync = defaultDirectorySync;
function preflightCritical(...directories) { for (const directory of new Set(directories)) directorySync(directory, { critical: true, preflight: true }); }
function durableRename(from, to, critical = false) { if (critical) preflightCritical(path.dirname(from), path.dirname(to)); fs.renameSync(from, to); directorySync(path.dirname(from), { critical }); if (path.dirname(to) !== path.dirname(from)) directorySync(path.dirname(to), { critical }); }
function durableUnlink(file, critical = false) { if (critical) preflightCritical(path.dirname(file)); fs.unlinkSync(file); directorySync(path.dirname(file), { critical }); }

function legacyChannels(state) {
  const channels = [...(state.notificationConfig?.channels || [])];
  if (state.tgConfig && (state.tgConfig.enabled || state.tgConfig.token || state.tgConfig.chatId)) channels.push({ type: 'telegram', config: state.tgConfig, legacy: true });
  return channels;
}
function legacyReport(state = {}) {
  const accounts = state.accounts || [], mails = state.mails || [], channels = legacyChannels(state);
  const known = new Set(accounts.map((item) => address(item.username || item.email)));
  return { accounts: accounts.length, mails: mails.length, channels: channels.length, deliveries: (state.notificationDeliveries || []).length, rules: (state.classificationRules || []).length, tombstones: (state.clearedMailIds || []).length, connectorSettings: Object.keys(state.connectorConfig || {}).length ? 1 : 0, orphans: mails.filter((mail) => !known.has(address(mail.account || mail.accountEmail))).length, secrets: { connector: Boolean(Object.keys(state.connectorConfig || {}).length), notifications: channels.length } };
}
function inside(directory, candidate) {
  const root = path.resolve(directory), value = path.resolve(candidate);
  if (value !== root && !value.startsWith(`${root}${path.sep}`)) throw new Error('备份路径必须位于 DATA_DIR 内');
  return value;
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function atomicCopy(source, destination) {
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  const input = fs.openSync(source, 'r'), output = fs.openSync(temporary, 'wx', 0o600);
  try { const size = fs.fstatSync(input).size; let offset = 0, buffer = Buffer.alloc(64 * 1024); while (offset < size) { const read = fs.readSync(input, buffer, 0, Math.min(buffer.length, size - offset), offset); fs.writeSync(output, buffer, 0, read); offset += read; } fs.fsyncSync(output); } finally { fs.closeSync(input); fs.closeSync(output); }
  durableRename(temporary, destination);
}
function backup(directory, storage) {
  const root = path.resolve(directory), target = inside(directory, path.join(root, `migration-backup-${now().replace(/[:.]/g, '-')}`));
  fs.mkdirSync(target, { recursive: false });
  const files = [];
  // VACUUM INTO is a coherent SQLite snapshot even when WAL is enabled. The CLI
  // owns instance.lock, so no server can mutate the database during this backup.
  const dbTarget = path.join(target, 'inboxharbor.db');
  if (storage) {
    storage.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    storage.db.exec(`VACUUM INTO '${dbTarget.replace(/'/g, "''")}'`);
    files.push({ name: 'inboxharbor.db', size: fs.statSync(dbTarget).size, sha256: sha256(dbTarget) });
  }
  for (const name of ['inboxharbor.key', 'inboxharbor.admin-token', 'data.json']) {
    const source = path.join(root, name);
    if (fs.existsSync(source)) { const destination = path.join(target, name); atomicCopy(source, destination); files.push({ name, size: fs.statSync(destination).size, sha256: sha256(destination) }); }
  }
  const manifest = { version: 1, directory: root, files, createdAt: now() };
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  return { path: target, manifest };
}
function verifyBackup(directory, backupPath) {
  const target = inside(directory, backupPath), manifestPath = path.join(target, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('备份缺少 manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (path.resolve(manifest.directory) !== path.resolve(directory) || !Array.isArray(manifest.files)) throw new Error('备份清单与当前 DATA_DIR 不匹配');
  for (const item of manifest.files) { const name = item.name; const file = path.join(target, name); if (!['inboxharbor.db', 'inboxharbor.key', 'inboxharbor.admin-token', 'data.json'].includes(name) || !Number.isInteger(item.size) || !/^[a-f0-9]{64}$/.test(item.sha256) || !fs.existsSync(file) || fs.statSync(file).size !== item.size || sha256(file) !== item.sha256) throw new Error('备份清单无效或文件已损坏'); }
  return { target, manifest };
}
function atomicJson(file, value, critical = true) { const tmp = `${file}.${crypto.randomUUID()}.tmp`; if (critical) preflightCritical(path.dirname(file)); const fd = fs.openSync(tmp, 'wx', 0o600); try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } durableRename(tmp, file, critical); }
function safeGeneration(root, value, prefix) { const safe = inside(root, value); if (safe === root || path.basename(safe).startsWith(prefix) === false || (fs.existsSync(safe) && fs.lstatSync(safe).isSymbolicLink())) throw new Error('恢复目录不安全'); return safe; }
function verifyGeneration(root, stage, manifest) {
  for (const item of manifest.files) { const file = path.join(stage, item.name); if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink() || sha256(file) !== item.sha256) return false; }
  const dbPath = path.join(stage, 'inboxharbor.db');
  if (!fs.existsSync(dbPath)) return true;
  let db; try { db = new DatabaseSync(dbPath); if (db.prepare('PRAGMA foreign_key_check').all().length) return false; const row = db.prepare("SELECT value FROM kv WHERE key='state'").get(); if (row && fs.existsSync(path.join(stage, 'inboxharbor.key'))) { const key = fs.readFileSync(path.join(stage, 'inboxharbor.key')); const item = JSON.parse(row.value); const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(item.iv, 'base64')); decipher.setAuthTag(Buffer.from(item.tag, 'base64')); JSON.parse(Buffer.concat([decipher.update(Buffer.from(item.data, 'base64')), decipher.final()]).toString('utf8')); } return true; } catch { return false; } finally { try { db?.close(); } catch {} }
}
function verifyLiveGeneration(root) {
  const dbPath = path.join(root, 'inboxharbor.db'); if (!fs.existsSync(dbPath)) return true;
  let db; try { db = new DatabaseSync(dbPath); if (db.prepare('PRAGMA foreign_key_check').all().length) return false; const row = db.prepare("SELECT value FROM kv WHERE key='state'").get(); if (row && fs.existsSync(path.join(root, 'inboxharbor.key'))) { const key = fs.readFileSync(path.join(root, 'inboxharbor.key')), item = JSON.parse(row.value), decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(item.iv, 'base64')); decipher.setAuthTag(Buffer.from(item.tag, 'base64')); JSON.parse(Buffer.concat([decipher.update(Buffer.from(item.data, 'base64')), decipher.final()]).toString('utf8')); } return true; } catch { return false; } finally { try { db?.close(); } catch {} }
}
function recoverInterruptedRestore(directory) {
  const root = path.resolve(directory), journalPath = path.join(root, 'restore-journal.json');
  if (!fs.existsSync(journalPath)) return { recovered: false };
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  if (journal.version !== 1 || journal.root !== root || typeof journal.phase !== 'string' || !Array.isArray(journal.manifest?.files) || !Array.isArray(journal.files) || journal.files.length !== journal.manifest.files.length) throw new Error('恢复 journal 无效');
  for (const name of journal.files) if (!['inboxharbor.db', 'inboxharbor.key', 'inboxharbor.admin-token', 'data.json'].includes(name) || path.basename(name) !== name) throw new Error('恢复 journal 文件清单无效');
  for (const item of journal.manifest.files) if (!journal.files.includes(item.name) || !Number.isInteger(item.size) || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('恢复 journal manifest 无效');
  const stage = safeGeneration(root, journal.stage, 'restore-stage-'), previous = safeGeneration(root, journal.previous, 'restore-previous-'); if (stage === previous) throw new Error('恢复目录不安全');
  const manifest = journal.manifest;
  const update = (phase) => { journal.phase = phase; atomicJson(journalPath, journal); };
  try {
    if (verifyGeneration(root, stage, manifest)) {
      update('recover-completing-stage');
      for (const name of journal.files) { const live = path.join(root, name), staged = path.join(stage, name); if (fs.existsSync(staged)) { if (fs.existsSync(live)) durableRename(live, path.join(previous, `${name}.partial`), true); durableRename(staged, live, true); update(`new:${name}`); } }
    } else {
      update('recover-restoring-previous');
      for (const name of journal.files) { const live = path.join(root, name), old = path.join(previous, name); if (fs.existsSync(old)) { if (fs.existsSync(live)) durableRename(live, path.join(stage, `${name}.partial`), true); durableRename(old, live, true); update(`old:${name}`); } }
    }
    if (!verifyLiveGeneration(root)) throw new Error('恢复后 generation 校验失败');
    durableUnlink(journalPath, true); fs.rmSync(stage, { recursive: true, force: true }); directorySync(root, { critical: true }); fs.rmSync(previous, { recursive: true, force: true }); directorySync(root, { critical: true }); return { recovered: true };
  } catch (error) { throw new Error(`中断恢复未完成：${error.message}`); }
}
function restoreBackup(directory, backupPath, options = {}) {
  const { target, manifest } = verifyBackup(directory, backupPath);
  const root = path.resolve(directory), journalPath = path.join(root, 'restore-journal.json');
  const stage = inside(root, path.join(root, `restore-stage-${crypto.randomUUID()}`));
  const previous = inside(root, path.join(root, `restore-previous-${crypto.randomUUID()}`));
  // Prove durability support before creating any journal/generation artifact.
  preflightCritical(root); fs.mkdirSync(stage); fs.mkdirSync(previous);
  try {
    // Validate the entire staged generation before replacing any live component.
    for (const item of manifest.files) atomicCopy(path.join(target, item.name), path.join(stage, item.name));
    for (const item of manifest.files) if (sha256(path.join(stage, item.name)) !== item.sha256) throw new Error('暂存恢复校验失败');
    const journal = { version: 1, root, stage, previous, live: root, files: manifest.files.map((item) => item.name), manifest, phase: 'validated' }; atomicJson(journalPath, journal);
    let changes = 0; const tick = () => { changes += 1; if (options.failAfterRename === changes) throw new Error('injected restore interruption'); };
    for (const item of manifest.files) { const live = path.join(root, item.name); if (fs.existsSync(live)) { durableRename(live, path.join(previous, item.name), true); journal.phase = `previous:${item.name}`; atomicJson(journalPath, journal); tick(); } }
    for (const item of manifest.files) { durableRename(path.join(stage, item.name), path.join(root, item.name), true); journal.phase = `live:${item.name}`; atomicJson(journalPath, journal); tick(); }
    if (!verifyLiveGeneration(root)) throw new Error('恢复 generation 校验失败');
    // Keep the completed journal if cleanup durability cannot be confirmed.
    preflightCritical(root); durableUnlink(journalPath, true); fs.rmSync(stage, { recursive: true, force: true }); directorySync(root, { critical: true }); fs.rmSync(previous, { recursive: true, force: true }); directorySync(root, { critical: true });
    return { restored: manifest.files.map((item) => item.name), backupPath: target };
  } catch (error) { throw error; }
}
function count(db, table, userId) { return db.prepare(`SELECT count(*) AS count FROM ${table} WHERE user_id=?`).get(userId).count; }

function migrate(storage, state, { dryRun = false, backupDir = null, failAfter = 0 } = {}) {
  const owner = storage.db.prepare("SELECT id FROM users WHERE role='owner' AND enabled=1").get();
  if (!owner) throw new Error('迁移需要已启用的 Owner 用户');
  const report = legacyReport(state);
  if (dryRun) return { dryRun: true, report };
  const runId = id(), started = now(), backupInfo = backupDir ? backup(backupDir, storage) : null;
  storage.db.exec('BEGIN IMMEDIATE');
  try {
    const prior = storage.db.prepare("SELECT id, report FROM migration_runs WHERE status='completed' LIMIT 1").get();
    if (prior) { storage.db.exec('COMMIT'); return { alreadyMigrated: true, runId: prior.id, report: JSON.parse(prior.report) }; }
    storage.db.prepare('INSERT INTO migration_runs VALUES (?,?,?,?,?)').run(runId, 'running', JSON.stringify({ ...report, backupPath: backupInfo?.path || null }), started, null);
    let steps = 0; const bump = () => { if (failAfter && ++steps >= failAfter) throw new Error('injected migration failure'); };
    const accountIds = new Map(), messageIds = [], channelIds = [];
    for (const item of state.accounts || []) { const value = String(item.username || item.email || ''); const accountId = id(); accountIds.set(address(value), accountId); storage.db.prepare('INSERT INTO mail_accounts VALUES (?,?,?,?,?,?,?)').run(accountId, owner.id, item.provider || 'other', value, storage.encrypt(item), started, started); bump(); }
    for (const item of state.mails || []) { const messageId = id(); messageIds.push(messageId); storage.db.prepare('INSERT INTO mail_messages VALUES (?,?,?,?,?)').run(messageId, owner.id, accountIds.get(address(item.account || item.accountEmail)) || null, storage.encrypt(item), started); bump(); }
    for (const item of legacyChannels(state)) { const channelId = id(); channelIds.push(channelId); storage.db.prepare('INSERT INTO notification_channels VALUES (?,?,?,?,?,?)').run(channelId, owner.id, item.type || 'telegram', storage.encrypt(item), started, started); bump(); }
    for (const item of state.notificationDeliveries || []) { storage.db.prepare('INSERT INTO notification_deliveries VALUES (?,?,?,?,?,?)').run(id(), owner.id, channelIds[item.channelIndex || 0] || null, messageIds[item.messageIndex || 0] || null, item.status || 'sent', started); bump(); }
    for (const item of state.classificationRules || []) { storage.db.prepare('INSERT INTO classification_rules VALUES (?,?,?,?,?)').run(id(), owner.id, storage.encrypt(item), started, started); bump(); }
    for (const item of state.clearedMailIds || []) { storage.db.prepare('INSERT OR IGNORE INTO mail_tombstones VALUES (?,?,?,?)').run(id(), owner.id, String(item), started); bump(); }
    if (Object.keys(state.connectorConfig || {}).length) { storage.db.prepare('INSERT OR REPLACE INTO instance_settings (key,value) VALUES (?,?)').run(`owner:${owner.id}:connector_config`, storage.encrypt(state.connectorConfig)); bump(); }
    const migrated = { accounts: count(storage.db, 'mail_accounts', owner.id), mails: count(storage.db, 'mail_messages', owner.id), channels: count(storage.db, 'notification_channels', owner.id), deliveries: count(storage.db, 'notification_deliveries', owner.id), rules: count(storage.db, 'classification_rules', owner.id), tombstones: count(storage.db, 'mail_tombstones', owner.id), connectorSettings: storage.db.prepare('SELECT 1 FROM instance_settings WHERE key=?').get(`owner:${owner.id}:connector_config`) ? 1 : 0 };
    for (const key of ['accounts', 'mails', 'channels', 'deliveries', 'rules', 'tombstones', 'connectorSettings']) if (migrated[key] !== report[key]) throw new Error(`迁移计数校验失败：${key}`);
    const finalReport = { ...report, migrated, backupPath: backupInfo?.path || null };
    storage.db.prepare('UPDATE migration_runs SET status=?,report=?,completed_at=? WHERE id=?').run('completed', JSON.stringify(finalReport), now(), runId);
    storage.db.exec('COMMIT'); return { runId, report: finalReport, backupPath: backupInfo?.path || null };
  } catch (error) { storage.db.exec('ROLLBACK'); throw error; }
}
function backupForRun(storage, runId) {
  const row = storage.db.prepare("SELECT report FROM migration_runs WHERE id=? AND status='completed'").get(runId);
  if (!row) throw new Error('找不到已完成的迁移记录');
  const backupPath = JSON.parse(row.report).backupPath;
  if (!backupPath) throw new Error('该迁移没有可恢复的备份');
  return backupPath;
}
module.exports = { legacyReport, backup, verifyBackup, restoreBackup, recoverInterruptedRestore, backupForRun, migrate, durableRename, durableUnlink, setDirectorySync: (fn) => { directorySync = fn || defaultDirectorySync; } };
