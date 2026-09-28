const { UserRepository } = require('./repository');

// Compatibility projection for the pre-v2 handlers.  It is intentionally built
// from relation rows on every request boundary: no process-global gData may be
// used to authorize a tenant resource.
function loadTenantState(storage, userId) {
  const repo = new UserRepository(storage, userId);
  const accounts = repo.list('accounts').map((row) => ({ ...row.payload, id: row.id, storageCreatedAt: row.created_at, storageUpdatedAt: row.updated_at }));
  const mails = repo.list('messages').map((row) => {
    // id is the local relational id used by the API. Preserve the provider's id
    // separately so dedupe and tombstones survive a database UUID assignment.
    const sourceId = String(row.payload.sourceId || row.payload.providerMessageId || row.payload.id || row.id);
    const provider = row.payload.provider || '';
    const accountId = row.account_id || row.payload.accountId || null;
    return { ...row.payload, id: row.id, sourceId, providerMessageId: sourceId, sourceKey: row.payload.sourceKey || `${accountId || ''}:${provider}:${sourceId}`, accountId, storageCreatedAt: row.created_at, storageUpdatedAt: row.updated_at };
  });
  const channels = repo.list('channels').map((row) => ({ ...row.payload, id: row.id, type: row.type }));
  const rules = repo.list('rules').map((row) => ({ ...row.payload, id: row.id }));
  const tombstones = repo.list('tombstones').map((row) => row.mail_id);
  return { repo, accounts, mails, channels, rules, tombstones };
}
function enforceQuota(storage, userId, kind) {
  const quota = storage.db.prepare('SELECT mail_account_limit, notification_limit FROM quotas WHERE user_id=?').get(userId) || {};
  const table = kind === 'accounts' ? 'mail_accounts' : 'notification_channels';
  const limit = kind === 'accounts' ? quota.mail_account_limit : quota.notification_limit;
  if (Number.isInteger(limit) && limit >= 0 && storage.db.prepare(`SELECT count(*) AS count FROM ${table} WHERE user_id=?`).get(userId).count >= limit) throw new Error('已达到当前账户配额');
}
module.exports = { loadTenantState, enforceQuota };
