const fs = require('fs');
const path = require('path');
const { Storage } = require('../storage');
const { migrate, backupForRun, restoreBackup, recoverInterruptedRestore } = require('../migration-service');
const { acquireInstanceLock, dataDirectory } = require('../instance-lock');
const directory = dataDirectory(path.resolve(process.env.DATA_DIR || path.join(__dirname, '..')));
const args = process.argv.slice(2);
const rollbackIndex = args.indexOf('--rollback');

const lock = acquireInstanceLock(directory);
try { recoverInterruptedRestore(directory); if (rollbackIndex >= 0) {
  const runId = args[rollbackIndex + 1];
  if (!runId) throw new Error('回滚需要 --rollback <runId>；运行中的实例会通过技术锁拒绝操作。');
  const storage = new Storage(directory);
  const backupPath = backupForRun(storage, runId);
  storage.close();
  console.log(JSON.stringify(restoreBackup(directory, backupPath), null, 2));
} else {
  const storage = new Storage(directory);
  try {
    const state = storage.load({}, path.join(directory, 'data.json'));
    const result = migrate(storage, state, { dryRun: args.includes('--dry-run'), backupDir: directory });
    fs.writeFileSync(path.join(directory, 'migration-report.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(result, null, 2));
  } finally { storage.close(); }
}} finally { lock.release(); }
