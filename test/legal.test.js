const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {validateLegalSettings}=require('../legal');
test('legal fields reject malformed contact details and control characters',()=>{
  assert.equal(validateLegalSettings({operatorName:'📬'.repeat(100),contactEmail:'privacy@example.com'}).operatorName.length,200);
  for(const value of [{},{operatorName:'x'.repeat(101),contactEmail:'a@example.com'},{operatorName:'bad\nname',contactEmail:'a@example.com'},{operatorName:'ok',contactEmail:'bad'},{operatorName:'ok',contactEmail:'a@example.com?subject=x'},{operatorName:42,contactEmail:'a@example.com'}])assert.throws(()=>validateLegalSettings(value));
});
test('public legal pages, owner-only atomic settings and persistent escaped content',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ih-legal-'));process.env.DATA_DIR=dir;process.env.INBOXHARBOR_ADMIN_TOKEN='legal-test-token';
 const {app,__auth,closeStorage}=require('../server');
 const owner=await __auth.bootstrapOwner('legal-owner@example.com','legal strong password');
 const users=[owner];for(const role of ['admin','user']){const email=role+'@example.com';const invitation=__auth.createInvitation(owner,email,role);await __auth.acceptInvitation(invitation,email,'legal strong password');users.push(__auth.db.prepare('SELECT * FROM users WHERE email=?').get(email));}
 const cookies=users.map(u=>'inboxharbor_session='+__auth.createSession(u));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const call=(url,options={})=>fetch(base+url,{...options,headers:{'content-type':'application/json',connection:'close',...options.headers}});
 const body={operatorName:'<script>operator</script>',contactEmail:'privacy@example.com'};
 try{
  const initial=await(await call('/api/auth/branding')).json();assert.equal(initial.legal.contactEmail,'nianbaa@gmail.com');assert.equal(initial.legal.operatorName,'');
  for(const route of ['/privacy','/terms']){const response=await call(route);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/html/);assert.equal(response.headers.get('cache-control'),'no-store');assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);const html=await response.text();assert.match(html,/nianbaa@gmail.com/);assert.match(html,/href="\/privacy"/);assert.match(html,/href="\/terms"/);}
  assert.equal((await call('/api/v1/legal-settings',{method:'PUT',body:JSON.stringify(body)})).status,401);
  for(const cookie of cookies.slice(1))assert.equal((await call('/api/v1/legal-settings',{method:'PUT',headers:{cookie},body:JSON.stringify(body)})).status,403);
  assert.equal((await call('/api/v1/legal-settings',{method:'PUT',headers:{cookie:cookies[0],origin:'https://evil.example'},body:JSON.stringify(body)})).status,403);
  const result=await call('/api/v1/legal-settings',{method:'PUT',headers:{cookie:cookies[0]},body:JSON.stringify(body)});assert.equal(result.status,200);const saved=await result.json();assert.equal(saved.contactEmail,body.contactEmail);assert.ok(saved.updatedAt);
  __auth.setSetting('branding_site_name','<img src=x>');
  for(const route of ['/privacy','/terms']){const html=await(await call(route)).text();assert.match(html,/&lt;script&gt;operator&lt;\/script&gt;/);assert.match(html,/&lt;img src=x&gt;/);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x>'));assert.match(html,/privacy@example.com/);}
  assert.equal((await call('/api/v1/legal-settings',{method:'PUT',headers:{cookie:cookies[0]},body:JSON.stringify({operatorName:'changed',contactEmail:'bad'})})).status,400);
  assert.equal((await(await call('/api/auth/branding')).json()).legal.operatorName,body.operatorName);
  const {Storage}=require('../storage'),{AuthService}=require('../auth');const reopened=new Storage(dir);try{const auth=new AuthService(reopened);assert.equal(auth.setting('legal_contact_email'),body.contactEmail);assert.equal(auth.setting('legal_operator_name'),body.operatorName);}finally{reopened.close();}
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));closeStorage();fs.rmSync(dir,{recursive:true,force:true});}
});
