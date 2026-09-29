const {test,expect}=require('@playwright/test');
const token = process.env.INBOXHARBOR_ADMIN_TOKEN || "qa-local-token";

async function unlock(page) {
  await page.goto("/");
  const bootstrap = page.getByRole("button", { name: "首次设置 Owner" });
  if (await bootstrap.isVisible().catch(() => false)) {
    await bootstrap.click();
    await page.getByPlaceholder("邮箱地址").fill("qa-owner@example.com");
    await page.getByPlaceholder("至少 12 位密码").fill("qa safe password");
    await page.getByPlaceholder("本机管理口令（仅首次使用）").fill(token);
    await page.getByRole("button", { name: "继续" }).click();
  } else {
    await page.getByPlaceholder("邮箱地址").fill("qa-owner@example.com");
    await page.locator('#harbor-ui input[placeholder="密码"]').fill("qa safe password");
    await page.getByRole("button", { name: "登录" }).click();
  }
  await expect(page.getByRole("heading", { name: "邮件中心" })).toBeVisible();
  const notice = page.getByRole("dialog", { name: "请保存恢复码" });
  if (await notice.isVisible().catch(() => false))
    await notice.getByRole("button", { name: "我已安全保存" }).click();
}


for(const width of [1440,390])test('public policies and owner legal settings at '+width,async({page})=>{
 await page.setViewportSize({width,height:960});
 await page.goto('/');
 await expect(page.getByRole('navigation',{name:'政策与条款'})).toBeVisible();
 await page.getByRole('navigation',{name:'政策与条款'}).getByRole('link',{name:'隐私权政策',exact:true}).click();
 await expect(page.getByRole('heading',{name:'隐私权政策',exact:true})).toBeVisible();
 await expect(page.locator('body')).toContainText('Limited Use');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)).toBe(false);
 await page.screenshot({path:'test-results/legal-privacy-'+width+'.png',fullPage:true});
 await page.getByRole('navigation',{name:'公开页面'}).getByRole('link',{name:'服务条款',exact:true}).click();
 await expect(page.getByRole('heading',{name:'服务条款',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)).toBe(false);
 await page.goto('/');await page.screenshot({path:'test-results/legal-login-'+width+'.png'});
 await unlock(page);await page.locator(width<600?'.ih-mobile [data-page=admin]':'.ih-side [data-page=admin]').click();
 await expect(page.getByRole('heading',{name:'公开运营信息'})).toBeVisible();
 const section=page.locator('#ih-legal-settings');
 await section.getByLabel('运营者名称',{exact:true}).fill('测试运营团队');
 await section.getByLabel('公开联系邮箱',{exact:true}).fill('contact@example.com');
 let payload;await page.route('**/api/v1/legal-settings',async route=>{payload=route.request().postDataJSON();await route.fulfill({json:{success:true,...payload,updatedAt:'2026-09-29T00:00:00Z'}});});
 await section.getByRole('button',{name:'保存公开运营信息'}).click();await expect(section.getByRole('status')).toContainText('已保存');expect(payload).toEqual({operatorName:'测试运营团队',contactEmail:'contact@example.com'});
 await expect(section.getByLabel('隐私权政策地址',{exact:true})).toHaveValue(/\/privacy$/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)).toBe(false);
 await page.screenshot({path:'test-results/legal-settings-'+width+'.png',fullPage:true});
});
