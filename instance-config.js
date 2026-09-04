const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function tokenPath(directory) {
  return path.join(directory, 'inboxharbor.admin-token');
}

function loadOrCreateAdminToken(directory, env = process.env) {
  if (env.INBOXHARBOR_ADMIN_TOKEN) return { token: env.INBOXHARBOR_ADMIN_TOKEN, created: false, source: 'environment' };
  const file = tokenPath(directory);
  if (fs.existsSync(file)) return { token: fs.readFileSync(file, 'utf8').trim(), created: false, source: 'file' };
  const token = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600, flag: 'wx' });
  return { token, created: true, source: 'file' };
}

module.exports = { loadOrCreateAdminToken, tokenPath };
