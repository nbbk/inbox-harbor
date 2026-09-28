const { test, expect } = require("@playwright/test");
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
  if (await notice.isVisible().catch(() => false)) await notice.getByRole("button", { name: "我已安全保存" }).click();
}


for (const width of [1440,390]) {
  test("refresh restores every permitted page at " + width, async ({page}) => {
    await page.setViewportSize({width,height:900});
    await unlock(page);
    const nav=width===390?".ih-mobile":".ih-nav";
    for(const target of ["accounts","connectors","notifications","profile","admin","guide","overview"]) {
      await page.locator(nav+' [data-page="'+target+'"]').click();
      await expect(page.locator(".ih-page.active")).toHaveAttribute("id","ih-"+target);
      await page.reload();
      await expect(page.locator(".ih-page.active")).toHaveAttribute("id","ih-"+target);
      await expect(page.locator(nav+' [data-page="'+target+'"]')).toHaveClass(/active/);
    }
  });
}
test("invalid or inaccessible saved pages fall back without leaking another user position",async({page})=>{
  await unlock(page);
  const config=await (await page.request.get("/api/auth/config")).json();
  const key="inboxharbor.active-page."+config.user.id;
  await page.evaluate(key=>sessionStorage.setItem(key,"missing-page"),key);
  await page.reload();
  await expect(page.locator(".ih-page.active")).toHaveAttribute("id","ih-overview");
  await page.evaluate(key=>sessionStorage.setItem(key,"admin"),key);
  await page.route("**/api/auth/config",route=>route.fulfill({json:{...config,user:{...config.user,role:"user"}}}));
  await page.reload();
  await expect(page.locator(".ih-page.active")).toHaveAttribute("id","ih-overview");
  await expect(page.locator("#ih-admin")).toHaveCount(0);
  await page.evaluate(key=>sessionStorage.setItem(key,"notifications"),key);
  await page.unroute("**/api/auth/config");
  await page.route("**/api/auth/config",route=>route.fulfill({json:{...config,user:{...config.user,id:"different-user",role:"user"}}}));
  await page.reload();
  await expect(page.locator(".ih-page.active")).toHaveAttribute("id","ih-overview");
});
