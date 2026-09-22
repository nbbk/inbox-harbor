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
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrateSchema();
  }
  migrateSchema() {
    // Keep every schema change small, ordered, and transactional.  A database made
    // by earlier InboxHarbor versions has no schema_migrations table, so bootstrap
    // that one table before asking which migrations are pending.
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const migrations = [{ version: 1, sql: `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','admin','user')), enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, email TEXT, role TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, accepted_at TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS instance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS quotas (user_id TEXT PRIMARY KEY, mail_account_limit INTEGER, notification_limit INTEGER, FOREIGN KEY(user_id) REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, actor_user_id TEXT, action TEXT NOT NULL, target_type TEXT, target_id TEXT, metadata TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mail_accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, provider TEXT NOT NULL, address TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id,address));
      CREATE TABLE IF NOT EXISTS mail_messages (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, account_id TEXT REFERENCES mail_accounts(id) ON DELETE SET NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notification_channels (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notification_deliveries (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, channel_id TEXT REFERENCES notification_channels(id) ON DELETE SET NULL, message_id TEXT REFERENCES mail_messages(id) ON DELETE SET NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS classification_rules (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS share_links (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, token_hash TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, expires_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mail_tombstones (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, mail_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(user_id,mail_id));
      CREATE TABLE IF NOT EXISTS migration_runs (id TEXT PRIMARY KEY, status TEXT NOT NULL, report TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT);` },
      { version: 2, sql: `CREATE INDEX IF NOT EXISTS idx_mail_accounts_user ON mail_accounts(user_id);
        CREATE INDEX IF NOT EXISTS idx_mail_messages_user ON mail_messages(user_id);
        CREATE INDEX IF NOT EXISTS idx_mail_messages_account ON mail_messages(account_id);
        CREATE INDEX IF NOT EXISTS idx_channels_user ON notification_channels(user_id);
        CREATE INDEX IF NOT EXISTS idx_deliveries_user ON notification_deliveries(user_id);
        CREATE INDEX IF NOT EXISTS idx_deliveries_channel ON notification_deliveries(channel_id);
        CREATE INDEX IF NOT EXISTS idx_rules_user ON classification_rules(user_id);
        CREATE INDEX IF NOT EXISTS idx_shares_user ON share_links(user_id);
        CREATE INDEX IF NOT EXISTS idx_tombstones_user ON mail_tombstones(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);` },
      // Existing installations can contain rows. SQLite cannot add foreign keys in
      // place, therefore v3 deliberately records compatibility rather than risking
      // a lossy table rebuild. Fresh business tables are created with references by
      // the migration service only after users exist; repository ownership checks
      // remain mandatory for both layouts.
      { version: 3, sql: `CREATE TABLE IF NOT EXISTS schema_foreign_key_policy (name TEXT PRIMARY KEY, policy TEXT NOT NULL);
        INSERT OR REPLACE INTO schema_foreign_key_policy VALUES ('business_data', 'user rows are RESTRICTed; message/account and delivery/channel links are nullable on deletion');` }
    ];
    for (const migration of migrations) {
      if (this.db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(migration.version)) continue;
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.exec(migration.sql);
        this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, new Date().toISOString());
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    if (!this.db.prepare('SELECT 1 FROM schema_migrations WHERE version=4').get()) this.rebuildBusinessSchemaV4();
    if (!this.db.prepare('SELECT 1 FROM schema_migrations WHERE version=5').get()) this.rebuildBusinessSchemaV5();
  }
  rebuildBusinessSchemaV4() {
    const dirty = this.db.prepare(`SELECT 'mail_messages.account_id' AS relation FROM mail_messages m LEFT JOIN mail_accounts a ON a.id=m.account_id AND a.user_id=m.user_id WHERE m.account_id IS NOT NULL AND a.id IS NULL
      UNION ALL SELECT 'notification_deliveries.channel_id' FROM notification_deliveries d LEFT JOIN notification_channels c ON c.id=d.channel_id AND c.user_id=d.user_id WHERE d.channel_id IS NOT NULL AND c.id IS NULL
      UNION ALL SELECT 'notification_deliveries.message_id' FROM notification_deliveries d LEFT JOIN mail_messages m ON m.id=d.message_id AND m.user_id=d.user_id WHERE d.message_id IS NOT NULL AND m.id IS NULL LIMIT 1`).get();
    if (dirty) throw new Error(`拒绝重建：发现跨租户或无主关联 (${dirty.relation})`);
    const fkErrors = this.db.prepare('PRAGMA foreign_key_check').all();
    if (fkErrors.length) throw new Error('拒绝重建：现有数据库 foreign_key_check 失败');
    // SQLite requires foreign_keys OFF before the transaction that renames old tables.
    this.db.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE');
    try {
      const priorCounts = Object.fromEntries(['mail_accounts','mail_messages','notification_channels','notification_deliveries','classification_rules','share_links','mail_tombstones'].map((table) => [table, this.db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count]));
      this.db.exec(`CREATE TABLE mail_accounts_v4 (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, provider TEXT NOT NULL, address TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id,address), UNIQUE(id,user_id));
        CREATE TABLE mail_messages_v4 (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, account_id TEXT, payload TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(account_id,user_id) REFERENCES mail_accounts_v4(id,user_id) ON DELETE SET NULL, UNIQUE(id,user_id));
        CREATE TABLE notification_channels_v4 (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(id,user_id));
        CREATE TABLE notification_deliveries_v4 (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, channel_id TEXT, message_id TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(channel_id,user_id) REFERENCES notification_channels_v4(id,user_id) ON DELETE SET NULL, FOREIGN KEY(message_id,user_id) REFERENCES mail_messages_v4(id,user_id) ON DELETE SET NULL);
        CREATE TABLE classification_rules_v4 (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE share_links_v4 (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, token_hash TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, expires_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL);
        CREATE TABLE mail_tombstones_v4 (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, mail_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(user_id,mail_id));
        INSERT INTO mail_accounts_v4 SELECT * FROM mail_accounts; INSERT INTO mail_messages_v4 SELECT * FROM mail_messages; INSERT INTO notification_channels_v4 SELECT * FROM notification_channels; INSERT INTO notification_deliveries_v4 SELECT * FROM notification_deliveries; INSERT INTO classification_rules_v4 SELECT * FROM classification_rules; INSERT INTO share_links_v4 SELECT * FROM share_links; INSERT INTO mail_tombstones_v4 SELECT * FROM mail_tombstones;
        DROP TABLE notification_deliveries; DROP TABLE mail_messages; DROP TABLE notification_channels; DROP TABLE mail_accounts; DROP TABLE classification_rules; DROP TABLE share_links; DROP TABLE mail_tombstones;
        ALTER TABLE mail_accounts_v4 RENAME TO mail_accounts; ALTER TABLE mail_messages_v4 RENAME TO mail_messages; ALTER TABLE notification_channels_v4 RENAME TO notification_channels; ALTER TABLE notification_deliveries_v4 RENAME TO notification_deliveries; ALTER TABLE classification_rules_v4 RENAME TO classification_rules; ALTER TABLE share_links_v4 RENAME TO share_links; ALTER TABLE mail_tombstones_v4 RENAME TO mail_tombstones;
        CREATE INDEX idx_mail_accounts_user ON mail_accounts(user_id); CREATE INDEX idx_mail_messages_user ON mail_messages(user_id); CREATE INDEX idx_mail_messages_account ON mail_messages(account_id,user_id); CREATE INDEX idx_channels_user ON notification_channels(user_id); CREATE INDEX idx_deliveries_user ON notification_deliveries(user_id); CREATE INDEX idx_deliveries_channel ON notification_deliveries(channel_id,user_id); CREATE INDEX idx_rules_user ON classification_rules(user_id); CREATE INDEX idx_shares_user ON share_links(user_id); CREATE INDEX idx_tombstones_user ON mail_tombstones(user_id);`);
      for (const [table, before] of Object.entries(priorCounts)) if (this.db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count !== before) throw new Error(`重建计数校验失败：${table}`);
      this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(4, new Date().toISOString());
      this.db.exec('COMMIT'); this.db.exec('PRAGMA foreign_keys = ON');
    } catch (error) { try { this.db.exec('ROLLBACK'); } finally { this.db.exec('PRAGMA foreign_keys = ON'); } throw error; }
  }
  rebuildBusinessSchemaV5() {
    this.db.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE');
    try {
      const messages = this.db.prepare('SELECT count(*) AS count FROM mail_messages').get().count;
      const deliveries = this.db.prepare('SELECT count(*) AS count FROM notification_deliveries').get().count;
      this.db.exec(`CREATE TABLE mail_messages_v5 (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, account_id TEXT, payload TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(account_id,user_id) REFERENCES mail_accounts(id,user_id) ON DELETE RESTRICT, UNIQUE(id,user_id));
        CREATE TABLE notification_deliveries_v5 (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, channel_id TEXT, message_id TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(channel_id,user_id) REFERENCES notification_channels(id,user_id) ON DELETE RESTRICT, FOREIGN KEY(message_id,user_id) REFERENCES mail_messages_v5(id,user_id) ON DELETE RESTRICT);
        INSERT INTO mail_messages_v5 SELECT * FROM mail_messages; INSERT INTO notification_deliveries_v5 SELECT * FROM notification_deliveries;
        DROP TABLE notification_deliveries; DROP TABLE mail_messages;
        ALTER TABLE mail_messages_v5 RENAME TO mail_messages; ALTER TABLE notification_deliveries_v5 RENAME TO notification_deliveries;
        CREATE INDEX idx_mail_messages_user ON mail_messages(user_id); CREATE INDEX idx_mail_messages_account ON mail_messages(account_id,user_id); CREATE INDEX idx_deliveries_user ON notification_deliveries(user_id); CREATE INDEX idx_deliveries_channel ON notification_deliveries(channel_id,user_id);`);
      if (this.db.prepare('SELECT count(*) AS count FROM mail_messages').get().count !== messages || this.db.prepare('SELECT count(*) AS count FROM notification_deliveries').get().count !== deliveries) throw new Error('v5 重建计数校验失败');
      this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(5, new Date().toISOString());
      this.db.exec('COMMIT'); this.db.exec('PRAGMA foreign_keys = ON');
    } catch (error) { try { this.db.exec('ROLLBACK'); } finally { this.db.exec('PRAGMA foreign_keys = ON'); } throw error; }
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
