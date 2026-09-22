const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { acquireInstanceLock } = require('../instance-lock');

test('instance lock rejects a second owner and releases only its own token', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-lock-'));
  const first = acquireInstanceLock(dir);
  assert.throws(() => acquireInstanceLock(dir), /正在使用/);
  first.release();
  const second = acquireInstanceLock(dir); second.release();
  assert.equal(fs.existsSync(path.join(dir, 'instance.lock')), false);
});
