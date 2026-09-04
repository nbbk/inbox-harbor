const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

function decodeMasterKey(value) {
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  const key = Buffer.from(value, 'base64');
  if (key.length === 32) return key;
  throw new Error('INBOXHARBOR_MASTER_KEY 必须为 64 位 hex 或 32 字节 base64。');
}

class Storage {
  constructor(directory, options = {}) {
    this.directory = directory;
    this.dbPath = path.join(directory, 'inboxharbor.db');
    this.keyPath = path.join(directory, 'inboxharbor.key');
    this.key = options.key || this.loadKey();
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }
  loadKey() {
    if (process.env.INBOXHARBOR_MASTER_KEY) return decodeMasterKey(process.env.INBOXHARBOR_MASTER_KEY);
    if (fs.existsSync(this.keyPath)) {
      const key = fs.readFileSync(this.keyPath);
      if (key.length !== 32) throw new Error(`主密钥文件无效：${this.keyPath}`);
      return key;
    }
    const key = crypto.randomBytes(32);
    fs.writeFileSync(this.keyPath, key, { mode: 0o600, flag: 'wx' });
    return key;
  }
  encrypt(value) {
    const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') });
  }
  decrypt(envelope) {
    const parsed = JSON.parse(envelope); const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(parsed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(parsed.data, 'base64')), decipher.final()]).toString('utf8'));
  }
  load(defaultValue, legacyJsonPath) {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get('state');
    if (row) return this.decrypt(row.value);
    if (legacyJsonPath && fs.existsSync(legacyJsonPath)) {
      const legacy = JSON.parse(fs.readFileSync(legacyJsonPath, 'utf8'));
      this.save(legacy); this.db.prepare("INSERT OR REPLACE INTO kv (key,value) VALUES ('migrated_from_json','1')").run();
      return legacy;
    }
    this.save(defaultValue); return defaultValue;
  }
  save(value) {
    const valueEncrypted = this.encrypt(value);
    this.db.exec('BEGIN IMMEDIATE');
    try { this.db.prepare('INSERT OR REPLACE INTO kv (key,value) VALUES (?,?)').run('state', valueEncrypted); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
module.exports = { Storage, decodeMasterKey };
