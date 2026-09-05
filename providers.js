const PROVIDERS = Object.freeze({
  google: { label: 'Google', oauth: true },
  microsoft: { label: 'Microsoft', oauth: true },
  qq: { label: 'QQ邮箱', oauth: false },
  netease: { label: '网易邮箱', oauth: false },
  other: { label: '其他', oauth: false }
});

function detectProvider(email) {
  const domain = String(email || '').trim().toLowerCase().split('@')[1] || '';
  if (domain === 'gmail.com' || domain === 'googlemail.com') return 'google';
  if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(domain) || domain.endsWith('.onmicrosoft.com')) return 'microsoft';
  if (domain === 'qq.com' || domain === 'foxmail.com') return 'qq';
  if (['163.com', '126.com', 'yeah.net', '188.com'].includes(domain)) return 'netease';
  return 'other';
}

function normalizeProvider(provider, email) {
  const detected = detectProvider(email);
  if (detected === 'qq' || detected === 'netease') return detected;
  return Object.hasOwn(PROVIDERS, provider) ? provider : detectProvider(email);
}

function supportsOAuth(provider) {
  return PROVIDERS[provider]?.oauth === true;
}

function validateOAuthIdentity(accounts, targetAccount, identity) {
  const normalized = String(identity || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    return { ok: false, reason: '授权平台未返回可验证的邮箱身份。' };
  }
  if (normalized !== String(targetAccount?.username || '').trim().toLowerCase()) {
    return { ok: false, reason: `授权账号 ${normalized} 与待授权邮箱不一致。` };
  }
  const duplicate = accounts.find(account => account.id !== targetAccount.id && String(account.username || '').trim().toLowerCase() === normalized);
  if (duplicate) return { ok: false, reason: '该授权邮箱已绑定到另一条账户记录。' };
  return { ok: true, identity: normalized };
}

module.exports = { PROVIDERS, detectProvider, normalizeProvider, supportsOAuth, validateOAuthIdentity };
