const {test,expect}=require('@playwright/test');
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
 // Use the existing real owner fixture when available, otherwise verify the
 // owner form with an isolated API fixture without changing shared users.
 await page.route('**/api/auth/config',route=>route.fulfill({json:{success:true,ownerInitialized:true,allowPublicRegistration:false,user:{id:'legal-ui-owner',email:'owner@example.com',role:'owner'}}}));
 await page.goto('/');await page.getByRole('button',{name:'管理后台',exact:true}).click();
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
