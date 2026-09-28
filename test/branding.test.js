const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { validateLogo, validateSiteName } = require('../branding');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMZkAAAAASUVORK5CYII=';
test('branding accepts bounded raster data and rejects remote, SVG, fake and oversized content', () => {
  assert.equal(validateLogo(''), '');
  assert.equal(validateLogo(png), png);
  for (const value of [null, undefined, 'https://example.com/logo.png', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,PGh0bWw+', 'data:image/png;base64,' + Buffer.alloc(128*1024+1).toString('base64')]) assert.throws(() => validateLogo(value));
});
test('only owner changes branding; public endpoint survives restart and reset uses default', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-branding-'));
  process.env.DATA_DIR = dir; process.env.INBOXHARBOR_ADMIN_TOKEN = 'test-branding-token';
  const { app, __auth, closeStorage } = require('../server');
  const owner = await __auth.bootstrapOwner('brand-owner@example.com','branding safe password');
  const invite = __auth.createInvitation(owner, 'brand-admin@example.com', 'admin');
  await __auth.acceptInvitation(invite,'brand-admin@example.com','branding safe password');
  const server = app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = (url, options={}) => fetch(base+url,{...options,headers:{'content-type':'application/json',connection:'close',...(options.headers||{})}});
  try {
    assert.equal((await (await call('/api/auth/branding')).json()).logoDataUrl,'');
    assert.equal((await call('/api/v1/branding',{method:'PUT',body:JSON.stringify({logoDataUrl:png})})).status,401);
    const login = async email => (await call('/api/auth/login',{method:'POST',body:JSON.stringify({email,password:'branding safe password'})})).headers.get('set-cookie').split(';')[0];
    const admin = await login('brand-admin@example.com'), cookie = await login('brand-owner@example.com');
    assert.equal((await call('/api/v1/branding',{method:'PUT',headers:{cookie:admin},body:JSON.stringify({logoDataUrl:png})})).status,403);
    assert.equal((await call('/api/v1/branding',{method:'PUT',headers:{cookie,origin:'https://evil.example'},body:JSON.stringify({logoDataUrl:png})})).status,403);
    assert.equal((await call('/api/v1/branding',{method:'PUT',headers:{cookie},body:JSON.stringify({logoDataUrl:png})})).status,200);
    assert.equal((await (await call('/api/auth/branding')).json()).logoDataUrl,png);
    assert.equal((await call('/api/v1/branding',{method:'PUT',headers:{cookie:admin},body:JSON.stringify({siteName:'非法更名'})})).status,403);
    const renamed = await (await call('/api/v1/branding',{method:'PUT',headers:{cookie},body:JSON.stringify({siteName:'  我的收件港  '})})).json();
    assert.equal(renamed.siteName,'我的收件港');
    assert.equal(renamed.logoDataUrl,png);
    assert.equal((await call('/api/v1/branding',{method:'PUT',headers:{cookie},body:JSON.stringify({siteName:'x'.repeat(61),logoDataUrl:''})})).status,400);
    assert.equal((await (await call('/api/auth/branding')).json()).logoDataUrl,png);
    const { Storage } = require('../storage'), { AuthService } = require('../auth');
    const reopened = new Storage(dir);
    try { const service=new AuthService(reopened); assert.equal(service.setting('branding_logo'),png); assert.equal(service.setting('branding_site_name'),'我的收件港'); } finally { reopened.close(); }
    assert.equal((await call('/api/v1/branding',{method:'PUT',headers:{cookie},body:JSON.stringify({logoDataUrl:''})})).status,200);
    const resetLogo = await (await call('/api/auth/branding')).json();
    assert.equal(resetLogo.logoDataUrl,''); assert.equal(resetLogo.siteName,'我的收件港');
    const resetName = await (await call('/api/v1/branding',{method:'PUT',headers:{cookie},body:JSON.stringify({siteName:''})})).json();
    assert.equal(resetName.siteName,'InboxHarbor');
  } finally { server.closeAllConnections(); await new Promise(r=>server.close(r)); closeStorage(); fs.rmSync(dir,{recursive:true,force:true}); }
});

test('site name is bounded Unicode text and notification HTML escapes branding', () => {
  assert.equal(validateSiteName('  我的收件港  '), '我的收件港');
  assert.equal(validateSiteName('   '), 'InboxHarbor');
  assert.equal(validateSiteName('📬'.repeat(60)), '📬'.repeat(60));
  for (const name of [null, 42, 'x'.repeat(61), 'bad\nname', 'bad\u0000name']) assert.throws(() => validateSiteName(name));
  const { messageFor } = require('../notifications');
  const message = messageFor({siteName:'<img src=x onerror=alert(1)>'});
  assert.ok(message.title.includes('<img'));
  assert.ok(!message.html.includes('<img'));
  assert.ok(message.html.includes('&lt;img'));
});
