const { test, expect } = require('@playwright/test');
const base = process.env.INBOXHARBOR_TEST_URL || 'http://127.0.0.1:5555';
const password = 'qa safe password';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMZkAAAAASUVORK5CYII=';
async function owner(request) {
  const config = await (await request.get(base+'/api/auth/config')).json();
  if (!config.ownerInitialized) {
    const response = await request.post(base+'/api/auth/bootstrap', {headers:{Authorization:'Bearer '+(process.env.INBOXHARBOR_ADMIN_TOKEN||'qa-local-token')}, data:{email:'qa-owner@example.com',password}});
    expect(response.ok()).toBeTruthy();
  }
  expect((await request.post(base+'/api/auth/login',{data:{email:'qa-owner@example.com',password}})).ok()).toBeTruthy();
}
async function login(page) {
  await page.goto(base);
  await page.getByPlaceholder('邮箱地址').fill('qa-owner@example.com');
  await page.getByPlaceholder('密码',{exact:true}).fill(password);
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await expect(page.getByRole('heading',{name:'邮件中心'})).toBeVisible();
}
function health(page) {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  return errors;
}
for (const width of [1440,390]) {
  test('login layout keeps centered logo and aligned actions at '+width, async ({page,request},info) => {
    await owner(request);
    const errors=health(page); await page.setViewportSize({width,height:900});
    await page.route('**/api/auth/config',async route=>{const response=await route.fetch();await route.fulfill({json:{...await response.json(),user:null,allowPublicRegistration:true}});});
    await page.goto(base+'/?invite=layout-test-only');
    await expect(page).toHaveTitle(/InboxHarbor/);
    await expect(page.getByRole('heading',{name:'InboxHarbor',exact:true})).toBeVisible();
    const card=await page.locator('.ih-lock > div').boundingBox();
    const mark=await page.locator('.ih-lock .ih-mark').boundingBox();
    const email=await page.getByPlaceholder('邮箱地址').boundingBox();
    const primary=await page.getByRole('button',{name:'登录',exact:true}).boundingBox();
    expect(Math.abs(mark.x+mark.width/2-card.x-card.width/2)).toBeLessThan(2);
    expect(Math.abs(primary.width-email.width)).toBeLessThan(2);
    const actions=await page.locator('.ih-auth-actions button').all();
    for(const control of actions){const bounds=await control.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(card.x);expect(bounds.x+bounds.width).toBeLessThanOrEqual(card.x+card.width+1);expect(bounds.height).toBeGreaterThanOrEqual(44);}
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    await page.screenshot({path:info.outputPath('login-'+width+'.png'),fullPage:true});
    await page.getByRole('button',{name:'忘记密码'}).click();
    await expect(page.getByRole('heading',{name:'恢复访问'})).toBeVisible();
    await expect(page.getByPlaceholder('一次性恢复码')).toBeVisible();
    await page.getByRole('button',{name:'返回登录'}).click();
    await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();
    expect(errors).toEqual([]);
  });
  test('recovery codes stay in a modal and never leak below notifications at '+width,async({page,request},info)=>{
    await owner(request);
    const email='layout-'+width+'@example.com';
    const response=await request.post(base+'/api/auth/invitations',{data:{email,role:'user'}});
    const invitation=await response.json(); expect(response.ok()).toBeTruthy();
    const errors=health(page); await page.setViewportSize({width,height:900});
    await page.goto(base+'/?invite='+encodeURIComponent(invitation.token));
    await page.getByRole('button',{name:'接受邀请'}).click();
    await page.getByPlaceholder('邮箱地址').fill(email);
    await page.getByPlaceholder('至少 12 位密码').fill('layout safe password');
    await page.getByRole('button',{name:'继续',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'请保存恢复码'});
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(el=>el.matches(':modal'))).toBe(true);
    const box=await dialog.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x+box.width).toBeLessThanOrEqual(width);expect(box.y+box.height).toBeLessThanOrEqual(900);
    await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
    await page.screenshot({path:info.outputPath('recovery-'+width+'.png'),fullPage:false,mask:[page.locator('.ih-recovery-codes')],maskColor:'#e9f1f5'});
    await dialog.getByRole('button',{name:'我已安全保存'}).click();
    await expect(dialog).toHaveCount(0);
    await (width<768?page.locator('.ih-mobile').getByRole('button',{name:'通知',exact:true}):page.getByRole('button',{name:'通知渠道',exact:true})).click();
    await expect(page.locator('#ih-notifications')).toBeVisible();
    // Members cannot configure SMTP or arbitrary Webhook targets.
    await expect(page.locator('.ih-channel')).toHaveCount(7);
    await page.locator('#ih-save').scrollIntoViewIfNeeded();
    expect(await page.locator('.ih-recovery-codes').count()).toBe(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    await page.screenshot({path:info.outputPath('notifications-'+width+'.png'),fullPage:true});
    await page.getByRole('button',{name:'退出',exact:true}).click();
    await expect(page.locator('.ih-lock')).toBeVisible();
    await expect(page.locator('.ih-recovery-codes')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
test('owner logo upload, public login display and default reset',async({page,request},info)=>{
  await owner(request);const errors=health(page);
  await login(page);await page.getByRole('button',{name:'管理后台',exact:true}).click();
  await page.getByLabel('上传 Logo').setInputFiles({name:'logo.png',mimeType:'image/png',buffer:Buffer.from(png.split(',')[1],'base64')});
  await expect(page.getByRole('button',{name:'保存 Logo',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'保存 Logo',exact:true}).click();
  await expect(page.locator('.ih-brand .ih-mark img')).toHaveAttribute('src',png);
  await page.getByRole('button',{name:'退出',exact:true}).click();
  await page.reload();
  await expect(page.locator('.ih-lock .ih-mark img')).toHaveAttribute('src',png);
  await page.screenshot({path:info.outputPath('custom-logo.png')});
  await page.getByPlaceholder('邮箱地址').fill('qa-owner@example.com');
  await page.getByPlaceholder('密码',{exact:true}).fill(password);
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.getByRole('button',{name:'管理后台',exact:true}).click();
  await page.getByRole('button',{name:'恢复默认 Logo'}).click();
  await expect(page.locator('.ih-brand .ih-mark')).toHaveText('IH');
  expect(errors).toEqual([]);
});
