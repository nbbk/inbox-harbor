const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const { UserRepository } = require('../repository');
const { loadTenantState } = require('../tenant-state');

const GOOGLE_READ = 'https://www.googleapis.com/auth/gmail.readonly';
const GOOGLE_SEND = 'https://www.googleapis.com/auth/gmail.send';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USER = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_MAIL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const MS_DEVICE = 'https://login.microsoftonline.com/common/oauth2/v2.0/devicecode';
const MS_TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const MS_MAIL = 'https://graph.microsoft.com/v1.0/me/sendMail';
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

// All provider traffic is mocked. In particular, proxy discovery must not talk
// to any proxy running on the test machine before falling back to mocked fetch.
async function boot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-oauth-cache-'));
  const env = {
    DATA_DIR: dir,
    INBOXHARBOR_ADMIN_TOKEN: 'oauth-cache-test-admin',
    GOOGLE_CLIENT_ID: '123-cache-test.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'fake-client-secret',
    MICROSOFT_CLIENT_ID: '00001111-aaaa-4222-bbbb-3333cccc4444',
    PUBLIC_BASE_URL: 'http://localhost:5555',
  };
  const previousEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const realFetch = global.fetch;
  const unexpected = [];
  let provider = async () => { throw new Error('No provider response configured'); };
  const calls = [];
  t.mock.method(http, 'request', () => { throw new Error('Test proxy transport disabled'); });
  for (const [target, method] of [[https, 'request'], [tls, 'connect']]) {
    t.mock.method(target, method, () => {
      unexpected.push(`${method} transport`);
      throw new Error('Unexpected provider transport');
    });
  }
  t.mock.method(global, 'fetch', async (url, options = {}) => {
    const address = String(url);
    calls.push({ url: address, options });
    try {
      const response = await provider(address, options);
      if (!response) throw new Error('Unexpected provider URL');
      return response;
    } catch (error) {
      unexpected.push(address);
      throw error;
    }
  });
  let service, server, base;
  async function start() {
    delete require.cache[require.resolve('../server')];
    service = require('../server');
    server = service.app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    service.closeStorage();
  }
  t.after(async () => {
    try { if (server) await stop(); }
    finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.deepEqual(unexpected, [], 'All unexpected upstream traffic must fail the test');
  });
  await start();
  const user = { id: 'alice', email: 'alice@example.test', role: 'user' };
  service.__storage.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?)')
    .run(user.id, user.email, 'unused-test-password-hash', user.role, 1, 'now', 'now');
  const cookie = `inboxharbor_session=${service.__auth.createSession(user)}`;
  return {
    get service() { return service; },
    get repo() { return new UserRepository(service.__storage, user.id); },
    calls,
    cookie,
    provider(fn) { provider = fn; },
    async reload() { await stop(); await start(); },
    call(route, { method = 'GET', body, session = cookie } = {}) {
      return realFetch(base + route, {
        method,
        headers: { cookie: session, 'Content-Type': 'application/json', Connection: 'close' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    },
    addAccount(providerName = 'google', overrides = {}) {
      const account = {
        username: 'alice@example.test', provider: providerName, status: 'active',
        note: 'old-refresh', readEnabled: true, sendEnabled: false,
        syncEnabled: false, oauthGeneration: 3,
        nextSyncAt: new Date(Date.now() + 3600000).toISOString(),
        providerScopes: providerName === 'google' ? GOOGLE_READ : 'Mail.Read',
        _cachedToken: 'old-read-token', _cachedExpiresAt: Date.now() + 3600000,
        _cachedOAuthGeneration: 3,
        ...overrides,
      };
      return this.repo.insert('accounts', account, { provider: providerName, address: account.username });
    },
  };
}

function assertNoCache(account) {
  assert.equal(Object.hasOwn(account, '_cachedToken'), false, 'Cached access token must be removed');
  assert.equal(Object.hasOwn(account, '_cachedExpiresAt'), false, 'Cached expiry must be removed');
  assert.equal(Object.hasOwn(account, '_cachedOAuthGeneration'), false, 'Cached generation must be removed');
}

async function startGoogle(h, accountId) {
  const response = await h.call(`/api/auth/google/url?id=${accountId}`);
  assert.equal(response.status, 200);
  const { url } = await response.json();
  return new URL(url);
}

async function finishGoogle(h, authorization, options = {}) {
  return h.call(`/auth/google/callback?code=test-code&state=${authorization.searchParams.get('state')}`, options);
}

function oauthProvider(providerName, { scopes, refreshToken = 'new-refresh', accessToken = 'consent-token', onRefresh, onSend } = {}) {
  return async (url, options) => {
    const params = new URLSearchParams(options.body);
    if (url === (providerName === 'google' ? GOOGLE_TOKEN : MS_TOKEN)) {
      if (params.get('grant_type') === 'refresh_token') {
        if (onRefresh) return onRefresh(params, options);
        return json({ access_token: 'fresh-send-token', expires_in: 3600, scope: scopes });
      }
      return json({
        access_token: accessToken, expires_in: 3600, scope: scopes,
        ...(refreshToken === null ? {} : { refresh_token: refreshToken }),
        ...(providerName === 'microsoft' ? { id_token: `header.${Buffer.from(JSON.stringify({ preferred_username: 'alice@example.test' })).toString('base64url')}.signature` } : {}),
      });
    }
    if (providerName === 'google' && url === GOOGLE_USER) return json({ email: 'alice@example.test' });
    if (providerName === 'microsoft' && url === MS_DEVICE) return json({
      user_code: 'TEST-CODE', device_code: 'test-device-code', expires_in: 600,
      verification_uri: 'https://microsoft.com/devicelogin',
    });
    if (url === (providerName === 'google' ? GOOGLE_MAIL : MS_MAIL) && onSend) return onSend(options);
    return null;
  };
}

async function startMicrosoft(h, accountId) {
  const response = await h.call('/api/auth/microsoft/device-code', { method: 'POST', body: { accountId } });
  assert.equal(response.status, 200);
  return (await response.json()).deviceCode;
}

async function finishMicrosoft(h, deviceCode, options = {}) {
  return h.call('/api/auth/microsoft/poll-device-token', {
    method: 'POST', body: { deviceCode }, ...options,
  });
}

function send(h, accountId, route = '/api/mails/send') {
  return h.call(route, {
    method: 'POST',
    body: route === '/api/mails/send'
      ? { accountId, to: 'recipient@example.test', subject: 'Mocked send', body: 'Regression test' }
      : { fromId: accountId, targetEmail: 'recipient@example.test' },
  });
}

test('permission changes invalidate persisted OAuth cache while retaining credentials', async (t) => {
  const h = await boot(t);
  let number = 0;
  for (const [initial, change] of [
    [{}, { sendEnabled: true }],
    [{ sendEnabled: true }, { sendEnabled: false }],
    [{}, { readEnabled: false }],
    [{ readEnabled: false }, { readEnabled: true }],
  ]) {
    const id = h.addAccount('google', { username: `account${number++}@example.test`, ...initial });
    const response = await h.call(`/api/accounts/${id}/permissions`, { method: 'PUT', body: change });
    assert.equal(response.status, 200);
    const saved = h.repo.get('accounts', id).payload;
    assertNoCache(saved);
    assert.equal(saved.note, 'old-refresh');
    assert.equal(saved.providerScopes, GOOGLE_READ);
    assert.equal(saved.oauthGeneration, 4);
    assertNoCache(loadTenantState(h.service.__storage, 'alice').accounts.find((account) => account.id === id));
  }
  await h.reload();
  for (const row of h.repo.list('accounts')) assertNoCache(row.payload);
  assert.equal(h.calls.length, 0);
});

test('unchanged OAuth permissions and sync preferences keep valid cache; other tenants cannot invalidate it', async (t) => {
  const h = await boot(t);
  const id = h.addAccount();
  const response = await h.call(`/api/accounts/${id}/permissions`, {
    method: 'PUT', body: { readEnabled: true, sendEnabled: false, syncEnabled: true, pollIntervalSeconds: 120 },
  });
  assert.equal(response.status, 200);
  const saved = h.repo.get('accounts', id).payload;
  assert.equal(saved._cachedToken, 'old-read-token');
  assert.equal(saved.oauthGeneration, 3);
  h.service.__storage.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?)')
    .run('bob', 'bob@example.test', 'unused', 'user', 1, 'now', 'now');
  const bob = new UserRepository(h.service.__storage, 'bob');
  const bobId = bob.insert('accounts', saved, { provider: 'google', address: 'bob@example.test' });
  assert.equal((await h.call(`/api/accounts/${bobId}/permissions`, {
    method: 'PUT', body: { sendEnabled: true },
  })).status, 404);
  assert.deepEqual(bob.get('accounts', bobId).payload, saved);
  assert.equal(h.calls.length, 0);
});

for (const providerName of ['google', 'microsoft']) {
  test(`${providerName} legacy and stale-generation persisted caches force refresh, while current cache is reused`, async (t) => {
    const h = await boot(t);
    const scopes = providerName === 'google' ? `${GOOGLE_READ} ${GOOGLE_SEND}` : 'Mail.Read Mail.Send';
    const id = h.addAccount(providerName, { sendEnabled: true, providerScopes: scopes, _cachedOAuthGeneration: undefined });
    let refreshes = 0;
    const sent = [];
    h.provider(oauthProvider(providerName, {
      scopes,
      onRefresh() { refreshes++; return json({ access_token: 'fresh-send-token', expires_in: 3600, scope: scopes }); },
      onSend(options) { sent.push(options.headers.Authorization); return json({ id: 'mock-sent-id' }); },
    }));
    // A restart projects a prepatch cache from encrypted durable storage.
    await h.reload();
    assert.equal((await send(h, id)).status, 200);
    assert.equal(refreshes, 1);
    assert.deepEqual(sent, ['Bearer fresh-send-token']);
    const outdated = { ...h.repo.get('accounts', id).payload, _cachedOAuthGeneration: 2 };
    h.repo.update('accounts', id, outdated, { provider: providerName, address: outdated.username });
    assert.equal((await send(h, id)).status, 200);
    assert.equal(refreshes, 2);
    // Sync is the existing durable cache writer; its current marker is stored.
    const syncAccount = { ...outdated, syncEnabled: true };
    h.repo.update('accounts', id, syncAccount, { provider: providerName, address: syncAccount.username });
    const oauth = oauthProvider(providerName, { scopes, onRefresh() {
      refreshes++;
      return json({ access_token: 'fresh-send-token', expires_in: 3600, scope: scopes });
    }, onSend(options) { sent.push(options.headers.Authorization); return json({ id: 'mock-sent-id' }); } });
    h.provider(async (url, options) => {
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/profile') return json({ historyId: '100' });
      if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')) return json({ messages: [] });
      if (url.startsWith('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?')) return json({ value: [], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=mock' });
      return oauth(url, options);
    });
    await h.service.syncAndPersistAccount('alice', id);
    assert.equal(h.repo.get('accounts', id).payload._cachedOAuthGeneration, 3);
    await h.reload();
    const before = refreshes;
    assert.equal((await send(h, id)).status, 200);
    assert.equal(refreshes, before, 'An unexpired generation-bound token should be reused');
    const accountList = await (await h.call('/api/accounts')).json();
    assertNoCache(accountList.accounts[0]);
  });

  test(`${providerName} successful credential replacement invalidates old cache across reload`, async (t) => {
    const h = await boot(t);
    const scopes = providerName === 'google' ? `${GOOGLE_READ} ${GOOGLE_SEND}` : 'Mail.Read Mail.Send';
    const id = h.addAccount(providerName, { sendEnabled: true });
    h.provider(oauthProvider(providerName, { scopes }));
    const authorization = providerName === 'google' ? await startGoogle(h, id) : await startMicrosoft(h, id);
    const response = providerName === 'google' ? await finishGoogle(h, authorization) : await finishMicrosoft(h, authorization);
    assert.equal(response.status, 200);
    const saved = h.repo.get('accounts', id).payload;
    assert.equal(saved.note, 'new-refresh');
    assert.equal(saved.providerScopes, scopes);
    assert.equal(saved.oauthGeneration, 3);
    assertNoCache(saved);
    await h.reload();
    assertNoCache(h.repo.get('accounts', id).payload);
  });
}

for (const providerName of ['google', 'microsoft']) {
  for (const route of ['/api/mails/send', '/api/accounts/send-test-mail']) {
    for (const change of ['revoke', 'disable', 'delete', 'reconsent', 'sync-metadata']) {
      test(`${providerName} ${route} rechecks ${change} while token refresh is pending`, async (t) => {
        const h = await boot(t);
        const scopes = providerName === 'google' ? `${GOOGLE_READ} ${GOOGLE_SEND}` : 'Mail.Read Mail.Send';
        const id = h.addAccount(providerName, {
          sendEnabled: true, providerScopes: scopes, _cachedExpiresAt: Date.now() - 1000,
        });
        let entered, release;
        const refreshing = new Promise((resolve) => { entered = resolve; });
        const blocked = new Promise((resolve) => { release = resolve; });
        let sends = 0;
        h.provider(oauthProvider(providerName, {
          scopes,
          async onRefresh() {
            entered();
            await blocked;
            return json({ access_token: 'pending-send-token', expires_in: 3600, scope: scopes,
              ...(providerName === 'microsoft' ? { refresh_token: 'rotated-in-memory' } : {}) });
          },
          onSend() { sends++; return json({ id: 'mock-sent-id' }); },
        }));
        const pending = send(h, id, route);
        await refreshing;
        try {
          if (change === 'revoke') {
            assert.equal((await h.call(`/api/accounts/${id}/revoke`, { method: 'POST' })).status, 200);
          } else if (change === 'disable') {
            assert.equal((await h.call(`/api/accounts/${id}/permissions`, { method: 'PUT', body: { sendEnabled: false } })).status, 200);
          } else if (change === 'delete') {
            assert.equal((await h.call(`/api/accounts/${id}`, { method: 'DELETE' })).status, 200);
          } else if (change === 'reconsent') {
            const authorization = providerName === 'google' ? await startGoogle(h, id) : await startMicrosoft(h, id);
            const result = providerName === 'google' ? await finishGoogle(h, authorization) : await finishMicrosoft(h, authorization);
            assert.equal(result.status, 200);
          } else {
            const current = h.repo.get('accounts', id).payload;
            h.repo.update('accounts', id, { ...current, syncCursor: 'new-cursor', lastSyncAt: new Date().toISOString(), mailCount: 5 }, {
              provider: providerName, address: current.username,
            });
          }
          release();
          const result = await pending;
          assert.equal(result.status, change === 'sync-metadata' ? 200 : 403);
          assert.equal(sends, change === 'sync-metadata' ? 1 : 0, 'Changed authorization must never reach provider send');
          const saved = h.repo.get('accounts', id)?.payload;
          if (change === 'delete') assert.equal(saved, undefined);
          else if (change === 'revoke') {
            assert.equal(Object.hasOwn(saved, 'note'), false);
            assertNoCache(saved);
          } else if (change === 'disable') {
            assert.equal(saved.sendEnabled, false);
            assert.equal(saved.note, 'old-refresh');
            assertNoCache(saved);
          } else if (change === 'reconsent') {
            assert.equal(saved.note, 'new-refresh');
            assert.equal(saved.oauthGeneration, 3);
            assertNoCache(saved);
          } else {
            assert.equal(saved.note, 'old-refresh', 'In-memory provider rotation must not overwrite concurrent sync state');
            assert.equal(saved.syncCursor, 'new-cursor');
          }
          if (change !== 'sync-metadata') assert.equal(h.repo.list('messages').length, 0);
        } finally {
          release();
          await pending;
        }
      });
    }
  }

  test(`${providerName} null or string cache generations force a refresh`, async (t) => {
    const h = await boot(t);
    const scopes = providerName === 'google' ? `${GOOGLE_READ} ${GOOGLE_SEND}` : 'Mail.Read Mail.Send';
    const id = h.addAccount(providerName, { sendEnabled: true, providerScopes: scopes, _cachedOAuthGeneration: null });
    let refreshes = 0;
    h.provider(oauthProvider(providerName, {
      scopes,
      onRefresh() { refreshes++; return json({ access_token: 'fresh-send-token', expires_in: 3600, scope: scopes }); },
      onSend(options) { assert.equal(options.headers.Authorization, 'Bearer fresh-send-token'); return json({ id: 'mock-sent-id' }); },
    }));
    assert.equal((await send(h, id)).status, 200);
    const current = h.repo.get('accounts', id).payload;
    h.repo.update('accounts', id, { ...current, _cachedOAuthGeneration: '3' }, { provider: providerName, address: current.username });
    assert.equal((await send(h, id)).status, 200);
    assert.equal(refreshes, 2);
  });

  test(`${providerName} callback after revoke cannot restore credentials or cache`, async (t) => {
    const h = await boot(t);
    const id = h.addAccount(providerName);
    h.provider(oauthProvider(providerName, { scopes: providerName === 'google' ? `${GOOGLE_READ} ${GOOGLE_SEND}` : 'Mail.Read Mail.Send' }));
    const authorization = providerName === 'google' ? await startGoogle(h, id) : await startMicrosoft(h, id);
    assert.equal((await h.call(`/api/accounts/${id}/revoke`, { method: 'POST' })).status, 200);
    const result = providerName === 'google' ? await finishGoogle(h, authorization) : await finishMicrosoft(h, authorization);
    assert.equal(result.status, 409);
    const saved = h.repo.get('accounts', id).payload;
    assert.equal(Object.hasOwn(saved, 'note'), false);
    assert.equal(saved.oauthGeneration, 4);
    assertNoCache(saved);
  });
}

for (const providerName of ['google', 'microsoft']) {
  test(`${providerName} send diagnostics allowlist error codes and never expose provider data`, async (t) => {
    const h = await boot(t);
    const scopes = providerName === 'google' ? `${GOOGLE_READ} ${GOOGLE_SEND}` : 'Mail.Read Mail.Send';
    const id = h.addAccount(providerName, { sendEnabled: true, providerScopes: scopes, _cachedToken: 'cached-send-token' });
    const privateText = 'PRIVATE alice@example.test Bearer SECRET-TOKEN subject=PRIVATE-CONTENT <script>malicious()</script>';
    const logs = [];
    t.mock.method(console, 'error', (...args) => { logs.push(args.map(String).join(' ')); });
    const errorResponse = (reason, status = 403) => json({
      error: {
        code: providerName === 'google' ? status : reason,
        errors: [{ reason, message: privateText, location: privateText }],
        message: privateText, innerError: { 'request-id': privateText },
      },
      access_token: privateText,
    }, status);
    const scenarios = [
      [() => errorResponse(providerName === 'google' ? 'insufficientPermissions' : 'ErrorAccessDenied'),
        providerName === 'google' ? 'send_permission_missing' : 'provider_access_denied', 403],
      [() => errorResponse('unknownError', 401), 'provider_authorization_invalid', 401],
      [() => errorResponse('unknownError', 429), 'provider_rate_limited', 429],
      [() => errorResponse(privateText), 'provider_error', 403],
      [() => errorResponse('__proto__'), 'provider_error', 403],
      [() => errorResponse('constructor'), 'provider_error', 403],
      [() => json(null, 403), 'provider_error', 403],
      [() => new Response(`<html>${privateText}</html>`, { status: 403 }), 'provider_error', 403],
      [() => new Response(`<html>${privateText}</html>`, { status: 503 }), 'provider_error', 503],
    ];
    if (providerName === 'google') scenarios.push(
      [() => errorResponse('accessNotConfigured'), 'provider_api_disabled', 403],
      [() => errorResponse('domainPolicy'), 'provider_policy_denied', 403],
      [() => errorResponse('userRateLimitExceeded'), 'provider_rate_limited', 403],
      [() => json({ error: { details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT', metadata: privateText }], message: privateText } }, 403), 'send_permission_missing', 403],
    );
    for (const [response, expectedReason, expectedStatus] of scenarios) {
      h.provider(async (url) => url === (providerName === 'google' ? GOOGLE_MAIL : MS_MAIL) ? response() : null);
      for (const route of ['/api/mails/send', '/api/accounts/send-test-mail']) {
        const result = await send(h, id, route);
        assert.equal(result.status, 502);
        const output = await result.json();
        assert.deepEqual(Object.keys(output).sort(), ['message', 'providerStatus', 'reason', 'success']);
        assert.equal(output.success, false);
        assert.equal(output.providerStatus, expectedStatus);
        assert.equal(output.reason, expectedReason);
        assert.equal(typeof output.message, 'string');
        assert.equal(JSON.stringify(output).includes(privateText), false);
        assert.equal(output.message.includes('alice@example.test'), false);
        assert.equal(output.message.includes('SECRET-TOKEN'), false);
        assert.equal(output.message.includes('PRIVATE-CONTENT'), false);
        assert.equal(output.message.includes('<script>'), false);
        if (expectedReason === 'provider_error') assert.equal(output.message, `邮件服务返回 HTTP ${expectedStatus}`);
      }
    }
    assert.equal(logs.join(' ').includes(privateText), false);
    assert.equal(logs.join(' ').includes('SECRET-TOKEN'), false);
    assert.equal(h.repo.list('messages').length, 0);
  });
}

test('Google reauthorization without a new refresh token still invalidates cached access', async (t) => {
  const h = await boot(t);
  const id = h.addAccount('google', { sendEnabled: true });
  h.provider(oauthProvider('google', { scopes: `${GOOGLE_READ} ${GOOGLE_SEND}`, refreshToken: null }));
  const response = await finishGoogle(h, await startGoogle(h, id));
  assert.equal(response.status, 200);
  const saved = h.repo.get('accounts', id).payload;
  assert.equal(saved.note, 'old-refresh');
  assertNoCache(saved);
});

test('read-only sync, reload, permission upgrade and reconsent immediately send using a fresh Google token', async (t) => {
  const h = await boot(t);
  const id = h.addAccount('google', {
    syncEnabled: true, nextSyncAt: new Date(Date.now() + 3600000).toISOString(),
    _cachedToken: null, _cachedExpiresAt: null,
  });
  const refreshes = [];
  const sentTokens = [];
  let authorized = false;
  const oauth = oauthProvider('google', {
    scopes: `${GOOGLE_READ} ${GOOGLE_SEND}`,
    onRefresh(params) {
      refreshes.push(params.get('refresh_token'));
      const fresh = params.get('refresh_token') === 'new-refresh';
      return json({ access_token: fresh ? 'fresh-send-token' : 'old-read-token', expires_in: 3600,
        scope: fresh ? `${GOOGLE_READ} ${GOOGLE_SEND}` : GOOGLE_READ });
    },
    onSend(options) {
      const token = options.headers.Authorization;
      sentTokens.push(token);
      return token === 'Bearer fresh-send-token' ? json({ id: 'mock-sent-id' }) : json({ error: 'insufficientPermissions' }, 403);
    },
  });
  h.provider(async (url, options) => {
    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/profile') return json({ historyId: '100' });
    if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')) return json({ messages: [] });
    if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/history?')) return json({ historyId: '101' });
    if (url === GOOGLE_TOKEN && new URLSearchParams(options.body).get('grant_type') === 'authorization_code') authorized = true;
    return oauth(url, options);
  });
  await h.service.syncAndPersistAccount('alice', id);
  assert.equal(h.repo.get('accounts', id).payload._cachedToken, 'old-read-token');
  await h.reload();
  assert.equal(h.repo.get('accounts', id).payload._cachedToken, 'old-read-token');
  assert.equal((await h.call(`/api/accounts/${id}/permissions`, { method: 'PUT', body: { sendEnabled: true } })).status, 200);
  // A poll may obtain another read-only token while the user is consenting.
  // Successful callback must invalidate this token as well as the permission edit.
  await h.service.syncAndPersistAccount('alice', id);
  const authorization = await startGoogle(h, id);
  assert.ok(authorization.searchParams.get('scope').split(' ').includes(GOOGLE_SEND));
  assert.equal((await finishGoogle(h, authorization)).status, 200);
  assert.equal(authorized, true);
  const response = await send(h, id);
  assert.equal(response.status, 200, 'Send must not use the persisted read-only access token');
  assert.equal((await response.json()).success, true);
  assert.equal(refreshes.at(-1), 'new-refresh');
  assert.deepEqual(sentTokens, ['Bearer fresh-send-token']);
  assert.equal(h.repo.list('messages').length, 1);
  const testResponse = await send(h, id, '/api/accounts/send-test-mail');
  assert.equal(testResponse.status, 200);
  assert.deepEqual(sentTokens, ['Bearer fresh-send-token', 'Bearer fresh-send-token']);
});

for (const providerName of ['google', 'microsoft']) {
  test(`${providerName} partial consent keeps both send endpoints blocked`, async (t) => {
    const h = await boot(t);
    const readScope = providerName === 'google' ? GOOGLE_READ : 'Mail.Read';
    const sendScope = providerName === 'google' ? GOOGLE_SEND : 'Mail.Send';
    const id = h.addAccount(providerName, { sendEnabled: true, providerScopes: `${readScope} ${sendScope}` });
    h.provider(oauthProvider(providerName, { scopes: readScope }));
    const authorization = providerName === 'google' ? await startGoogle(h, id) : await startMicrosoft(h, id);
    const response = providerName === 'google' ? await finishGoogle(h, authorization) : await finishMicrosoft(h, authorization);
    assert.equal(response.status, 200);
    assert.equal(h.repo.get('accounts', id).payload.providerScopes, readScope);
    assert.equal((await send(h, id)).status, 403);
    assert.equal((await send(h, id, '/api/accounts/send-test-mail')).status, 403);
    assert.equal(h.calls.some((call) => [GOOGLE_MAIL, MS_MAIL].includes(call.url)), false);
    assert.equal(h.repo.list('messages').length, 0);
  });

  test(`${providerName} disabled or revoked grant cannot use a cached send token`, async (t) => {
    const h = await boot(t);
    const scopes = providerName === 'google' ? `${GOOGLE_READ} ${GOOGLE_SEND}` : 'Mail.Read Mail.Send';
    const id = h.addAccount(providerName, { sendEnabled: true, providerScopes: scopes, _cachedToken: 'old-send-token' });
    assert.equal((await h.call(`/api/accounts/${id}/permissions`, { method: 'PUT', body: { sendEnabled: false } })).status, 200);
    for (const route of ['/api/mails/send', '/api/accounts/send-test-mail']) assert.equal((await send(h, id, route)).status, 403);
    assert.equal(h.calls.length, 0);
    assert.equal((await h.call(`/api/accounts/${id}/permissions`, { method: 'PUT', body: { sendEnabled: true } })).status, 200);
    assert.equal((await h.call(`/api/accounts/${id}/revoke`, { method: 'POST' })).status, 200);
    const revoked = h.repo.get('accounts', id).payload;
    assertNoCache(revoked);
    assert.equal(Object.hasOwn(revoked, 'note'), false);
    assert.equal((await send(h, id)).status, 403);
    assert.equal((await send(h, id, '/api/accounts/send-test-mail')).status, 400);
    assert.equal(h.calls.length, 0);
  });

  test(`${providerName} authorization started before a permission change cannot restore old credentials or cache`, async (t) => {
    const h = await boot(t);
    const id = h.addAccount(providerName);
    h.provider(oauthProvider(providerName, { scopes: providerName === 'google' ? `${GOOGLE_READ} ${GOOGLE_SEND}` : 'Mail.Read Mail.Send' }));
    const authorization = providerName === 'google' ? await startGoogle(h, id) : await startMicrosoft(h, id);
    assert.equal((await h.call(`/api/accounts/${id}/permissions`, { method: 'PUT', body: { sendEnabled: true } })).status, 200);
    const response = providerName === 'google' ? await finishGoogle(h, authorization) : await finishMicrosoft(h, authorization);
    assert.equal(response.status, 409);
    const saved = h.repo.get('accounts', id).payload;
    assert.equal(saved.note, 'old-refresh');
    assert.equal(saved.oauthGeneration, 4);
    assertNoCache(saved);
  });

  test(`${providerName} failed CAS does not persist credential replacement or cache invalidation`, async (t) => {
    const h = await boot(t);
    const id = h.addAccount(providerName);
    const original = h.repo.get('accounts', id).payload;
    h.provider(oauthProvider(providerName, { scopes: providerName === 'google' ? GOOGLE_READ : 'Mail.Read' }));
    const authorization = providerName === 'google' ? await startGoogle(h, id) : await startMicrosoft(h, id);
    t.mock.method(UserRepository.prototype, 'updateIfUnchanged', () => false);
    const response = providerName === 'google' ? await finishGoogle(h, authorization) : await finishMicrosoft(h, authorization);
    assert.equal(response.status, 409);
    assert.deepEqual(h.repo.get('accounts', id).payload, original);
  });
}
