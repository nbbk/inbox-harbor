const {test,expect}=require("@playwright/test");
const token=process.env.INBOXHARBOR_ADMIN_TOKEN||"qa-local-token";
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
  if (await notice.isVisible().catch(() => false)) await notice.getByRole("button", { name: "我已安全保存" }).click();
}



for(const role of ["user","admin"])for(const width of [1440,390]){
 test(role+" sees mailbox status and user help without owner settings at "+width,async({page})=>{
  await page.setViewportSize({width,height:900});await unlock(page);
  const config=await(await page.request.get("/api/auth/config")).json();
  await page.evaluate(id=>sessionStorage.setItem("inboxharbor.active-page."+id,"connectors"),config.user.id);
  await page.route("**/api/auth/config",route=>route.fulfill({json:{...config,user:{...config.user,role}}}));
  let settingsRequests=0;
  page.on("request",request=>{if(/\/api\/v1\/connectors(?:\/check)?$/.test(new URL(request.url()).pathname))settingsRequests++;});
  await page.route("**/api/v1/connectors/status",route=>route.fulfill({json:{success:true,providers:{google:{configured:true},microsoft:{configured:false}}}}));
  await page.reload();
  await expect(page.locator(".ih-page.active")).toHaveAttribute("id","ih-overview");
  await expect(page.locator('[data-page="connectors"]')).toHaveCount(0);
  await expect(page.locator("#ih-connectors")).toHaveCount(0);
  await expect(page.locator("#cx-secret")).toHaveCount(0);
  const nav=width===390?".ih-mobile":".ih-nav";
  await page.locator(nav+' [data-page="accounts"]').click();
  await expect(page.locator("#ih-connector-status")).toContainText("Google：已配置");
  await expect(page.locator("#ih-connector-status")).toContainText("Microsoft：尚未配置");
  await page.reload();
  await expect(page.locator(".ih-page.active")).toHaveAttribute("id","ih-accounts");
  await page.locator(nav+' [data-page="guide"]').click();
  await expect(page.getByRole("heading",{name:"邮箱使用帮助"})).toBeVisible();
  await expect(page.locator("#ih-guide")).not.toContainText("Docker");
  await expect(page.locator("#ih-guide")).not.toContainText("git pull");
  await expect(page.locator("#ih-guide")).not.toContainText("/www/wwwroot");
  await expect(page.locator("#ih-guide")).toContainText("添加与授权邮箱");
  expect(settingsRequests).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  if(role==="user")await page.screenshot({path:"test-results/member-help-"+width+".png",fullPage:true});
 });
}
