const crypto = require('crypto');
const SCHEMAS = {
  accounts: { table: 'mail_accounts', fields: ['provider', 'address'], defaults: ['other', ''] },
  messages: { table: 'mail_messages', fields: ['account_id'], defaults: [null] },
  channels: { table: 'notification_channels', fields: ['type'], defaults: ['webhook'] },
  deliveries: { table: 'notification_deliveries', fields: ['channel_id', 'message_id', 'status'], defaults: [null, null, 'sent'] },
  rules: { table: 'classification_rules', fields: [], defaults: [] },
  shares: { table: 'share_links', fields: ['token_hash', 'expires_at', 'revoked_at'], defaults: ['', null, null] },
  tombstones: { table: 'mail_tombstones', fields: ['mail_id'], defaults: [''] }
};
class UserRepository {
  constructor(storage, userId) { if (!userId) throw new Error('userId required'); this.storage = storage; this.db = storage.db; this.userId = userId; }
  schema(kind) { const value = SCHEMAS[kind]; if (!value) throw new Error('unknown repository kind'); return value; }
  assertOwned(table, value) { if (value && !this.db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND user_id=?`).get(value, this.userId)) throw new Error('关联对象不存在或不属于当前用户'); }
  validateRelations(kind, values) {
    if (kind === 'messages' && Object.hasOwn(values, 'account_id')) this.assertOwned('mail_accounts', values.account_id);
    if (kind === 'deliveries') { if (Object.hasOwn(values, 'channel_id')) this.assertOwned('notification_channels', values.channel_id); if (Object.hasOwn(values, 'message_id')) this.assertOwned('mail_messages', values.message_id); }
  }
  insert(kind, payload, values = {}) {
    const { table, fields, defaults } = this.schema(kind), id = crypto.randomUUID(), time = new Date().toISOString();
    this.validateRelations(kind, values); const named = fields.map((field, index) => values[field] ?? defaults[index]);
    let sql, params;
    if (kind === 'accounts') { sql = `INSERT INTO ${table} VALUES (?,?,?,?,?,?,?)`; params = [id, this.userId, ...named, this.storage.encrypt(payload), time, time]; }
    else if (kind === 'messages') { sql = `INSERT INTO ${table} VALUES (?,?,?,?,?)`; params = [id, this.userId, ...named, this.storage.encrypt(payload), time]; }
    else if (kind === 'channels') { sql = `INSERT INTO ${table} VALUES (?,?,?,?,?,?)`; params = [id, this.userId, ...named, this.storage.encrypt(payload), time, time]; }
    else if (kind === 'deliveries') { sql = `INSERT INTO ${table} VALUES (?,?,?,?,?,?)`; params = [id, this.userId, ...named, time]; }
    else if (kind === 'rules') { sql = `INSERT INTO ${table} VALUES (?,?,?,?,?)`; params = [id, this.userId, this.storage.encrypt(payload), time, time]; }
    else if (kind === 'shares') { sql = `INSERT INTO ${table} VALUES (?,?,?,?,?,?,?)`; params = [id, this.userId, ...named, this.storage.encrypt(payload), time]; }
    else { sql = `INSERT OR IGNORE INTO ${table} VALUES (?,?,?,?)`; params = [id, this.userId, ...named, time]; }
    this.db.prepare(sql).run(...params); return id;
  }
  list(kind) { const { table } = this.schema(kind); return this.db.prepare(`SELECT * FROM ${table} WHERE user_id=? ORDER BY created_at DESC`).all(this.userId).map((row) => this.decode(kind, row)); }
  get(kind, id) { const { table } = this.schema(kind); return this.decode(kind, this.db.prepare(`SELECT * FROM ${table} WHERE id=? AND user_id=?`).get(id, this.userId)); }
  update(kind, id, payload, values = {}) {
    const { table, fields } = this.schema(kind); const current = this.get(kind, id); if (!current) return false;
    this.validateRelations(kind, values);
    const encryptedKinds = ['accounts', 'messages', 'channels', 'rules', 'shares'];
    const sets = encryptedKinds.includes(kind) ? ['payload=?'] : [], params = encryptedKinds.includes(kind) ? [this.storage.encrypt(payload)] : [];
    for (const field of fields) if (Object.hasOwn(values, field)) { sets.push(`${field}=?`); params.push(values[field]); }
    if (['accounts', 'channels', 'rules'].includes(kind)) { sets.push('updated_at=?'); params.push(new Date().toISOString()); }
    if (!sets.length) return false;
    params.push(id, this.userId); return this.db.prepare(`UPDATE ${table} SET ${sets.join(',')} WHERE id=? AND user_id=?`).run(...params).changes === 1;
  }
  delete(kind, id) {
    const { table } = this.schema(kind);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // Composite FKs intentionally RESTRICT cross-tenant deletes. Clear only the
      // current user's nullable child links in this same transaction first.
      if (kind === 'accounts') this.db.prepare('UPDATE mail_messages SET account_id=NULL WHERE user_id=? AND account_id=?').run(this.userId, id);
      if (kind === 'channels') this.db.prepare('UPDATE notification_deliveries SET channel_id=NULL WHERE user_id=? AND channel_id=?').run(this.userId, id);
      if (kind === 'messages') this.db.prepare('UPDATE notification_deliveries SET message_id=NULL WHERE user_id=? AND message_id=?').run(this.userId, id);
      const deleted = this.db.prepare(`DELETE FROM ${table} WHERE id=? AND user_id=?`).run(id, this.userId).changes === 1;
      this.db.exec('COMMIT'); return deleted;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  decode(kind, row) { if (!row) return null; return ('payload' in row) ? { ...row, payload: this.storage.decrypt(row.payload) } : row; }
}
function listAllAccountsWithUser(storage) { return storage.db.prepare('SELECT id,user_id,provider,address,payload FROM mail_accounts').all().map((row) => ({ userId: row.user_id, account: { ...storage.decrypt(row.payload), id: row.id, provider: row.provider, username: row.address } })); }
module.exports = { UserRepository, listAllAccountsWithUser };
