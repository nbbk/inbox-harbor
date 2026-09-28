const { test, expect } = require("@playwright/test");
const token = process.env.INBOXHARBOR_ADMIN_TOKEN || "qa-local-token";
const png1x1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

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

async function mockProductivity(page) {
  let mailState = [
    {id:"m1",subject:"账单提醒",sender:"billing@example.com",account:"a@example.com",content:"one",preview:"one",category:"账单",receivedAt:"2026-09-29T10:00:00Z",isRead:false,isStarred:false},
    {id:"m2",subject:"登录验证码",sender:"alerts@example.com",account:"a@example.com",content:"two",preview:"two",category:"验证码",receivedAt:"2026-09-29T09:00:00Z",isRead:true,isStarred:true}
  ];
  let batchBody;
  await page.route("**/api/accounts", route => route.fulfill({json:{accounts:[{id:"a",username:"a@example.com",provider:"google",status:"active",health:{state:"normal",label:"同步正常",lastSyncedAt:"2026-09-29T09:00:00Z"}}]}}));
  await page.route("**/api/mails?*", async route => {
    const url = new URL(route.request().url());
    const unread = url.searchParams.get("unread"), starred = url.searchParams.get("starred");
    let visible = mailState.filter(mail => (unread === null || unread === "" || String(!mail.isRead) === unread) && (starred === null || starred === "" || String(mail.isStarred) === starred));
    await route.fulfill({json:{mails:visible,pagination:{page:1,pageSize:50,total:visible.length,totalPages:1},facets:{全部:visible.length,账单:1,验证码:1}}});
  });
  await page.route("**/api/mails/batch-state", async route => {
    batchBody = JSON.parse(route.request().postData() || "{}");
    mailState = mailState.map(mail => batchBody.ids.includes(mail.id) ? {...mail,...batchBody.state} : mail);
    await route.fulfill({json:{success:true,updatedCount:batchBody.ids.length,mails:mailState.filter(mail => batchBody.ids.includes(mail.id))}});
  });
  await page.route("**/api/v1/notifications", route => route.fulfill({json:{catalog:{bark:{name:"Bark",icon:"●",fields:[],guide:"/guide"}},configuration:{shareLinkDays:30,channels:[{id:"channel-a",type:"bark",name:"Bark",enabled:true}]}}}));
  await page.route("**/api/v1/notifications/deliveries?*", route => route.fulfill({json:{deliveries:[],total:0,page:1,pageSize:20}}));
  await page.route("**/api/v1/notification-rules", route => route.fulfill({json:{policy:{rules:[{id:"r1",enabled:true,sender:"",keyword:"",channelIds:["channel-a"]}],quietHours:{enabled:false,start:"22:00",end:"07:00",timeZone:"Asia/Shanghai"},dedupeMinutes:5}}}));
  await page.route("**/api/v1/connectors/check", route => route.fulfill({json:{results:{google:{ready:true,label:"配置完整",hint:"可以授权"},microsoft:{ready:false,label:"未配置",hint:"填写 Client ID"}}}}));
  await page.reload();
  await expect(page.locator("#ih-mail-list")).toBeVisible();
  return {getBatch:()=>batchBody};
}

test("batch state uses visible tenant ids and refreshes unread filter", async ({page}) => {
  await unlock(page); const state = await mockProductivity(page);
  await page.locator("[data-page=overview]").first().click();
  await page.selectOption("#ih-mail-unread", "true");
  await expect(page.locator("#ih-mail-list")).toContainText("账单提醒");
  await page.locator("#ih-mail-select-page").check();
  await expect(page.locator("#ih-mail-selected-count")).toContainText("1");
  await page.getByRole("button", {name:"标记已读"}).click();
  await expect.poll(() => state.getBatch()).toMatchObject({ids:["m1"],state:{isRead:true}});
  await expect(page.locator("#ih-mail-list")).not.toContainText("账单提醒");
  await page.selectOption("#ih-mail-unread", "");
  await page.selectOption("#ih-mail-starred", "true");
  await expect(page.locator("#ih-mail-list")).toContainText("登录验证码");
  await page.locator("#ih-mail-list input[type=checkbox]").first().check();
  await page.locator("#ih-mail-batch").getByRole("button", {name:"取消收藏",exact:true}).click();
  await expect.poll(() => state.getBatch()).toMatchObject({ids:["m2"],state:{isStarred:false}});
});

test("notification rules save channel ids and quiet hours", async ({page}) => {
  let body;
  await unlock(page); await mockProductivity(page);
  await page.unroute("**/api/v1/notification-rules");
  await page.route("**/api/v1/notification-rules", async route => {
    if (route.request().method() === "PUT") { body=JSON.parse(route.request().postData()||"{}"); await route.fulfill({json:{success:true,policy:body}}); }
    else await route.fulfill({json:{policy:{rules:[{id:"r1",enabled:true,channelIds:["channel-a"]}],quietHours:{enabled:false,start:"22:00",end:"07:00",timeZone:"Asia/Shanghai"},dedupeMinutes:5}}});
  });
  await page.locator("[data-page=notifications]").first().click();
  const row = page.locator(".ih-rule-row").first();
  await row.locator("input[placeholder=发件人]").fill("alerts@example.com");
  await row.locator(".ih-rule-channels input[value=channel-a]").check();
  await page.locator("#ih-quiet-enabled").check();
  await page.locator("#ih-quiet-start").fill("22:00"); await page.locator("#ih-quiet-end").fill("07:00");
  await page.getByRole("button",{name:"保存规则",exact:true}).click();
  await expect.poll(()=>body).toMatchObject({quietHours:{enabled:true,start:"22:00",end:"07:00",timeZone:"Asia/Shanghai"}});
  expect(body.rules[0].channelIds).toEqual(["channel-a"]);
  expect(body.rules[0].sender).toBe("alerts@example.com");
  expect(body.dedupeMinutes).toBe(5);
  await page.screenshot({path:"test-results/ui-policy-desktop.png",fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({path:"test-results/ui-policy-mobile.png",fullPage:true});
});

test("connector check exposes ready state and actionable limitation", async ({page}) => {
  await unlock(page); await mockProductivity(page);
  await page.locator("[data-page=connectors]").first().click();
  await page.getByRole("button",{name:"仅检查当前配置"}).click();
  await expect(page.locator("#cx-result")).toContainText("配置完整");
  await expect(page.locator("#cx-result")).toContainText("未配置");
  await expect(page.locator("#cx-result")).toHaveClass(/error/);
});

test("branding stays text safe, preserves logo, restores preferences, and fits mobile", async ({page}) => {
  let name = "InboxHarbor", logo = "";
  await page.route("**/api/auth/branding", route => route.fulfill({json:{siteName:name,logoDataUrl:logo}}));
  await page.route("**/api/v1/branding", async route => {
    const body=JSON.parse(route.request().postData()||"{}");
    if (Object.prototype.hasOwnProperty.call(body,"siteName")) name=String(body.siteName).trim() || "InboxHarbor";
    if (Object.prototype.hasOwnProperty.call(body,"logoDataUrl")) logo=body.logoDataUrl;
    await route.fulfill({json:{siteName:name,logoDataUrl:logo}});
  });
  await page.setViewportSize({width:390,height:844});
  await unlock(page); await mockProductivity(page);
  await page.getByRole("button",{name:"我的"}).click();
  await page.getByRole("button",{name:"管理"}).click();
  const hostile = "<img src=x onerror=alert(1)>收件港";
  await page.locator("#ih-site-name").fill(hostile);
  await page.getByRole("button",{name:"保存站点名称"}).click();
  await expect(page).toHaveTitle(hostile.trim());
  expect(await page.locator("body img").count()).toBe(0);
  const logoInput=page.locator(".ih-branding-settings input[type=file]");
  await logoInput.setInputFiles({name:"pixel.png",mimeType:"image/png",buffer:Buffer.from(png1x1.split(",")[1],"base64")});
  await page.getByRole("button",{name:"保存 Logo"}).click();
  await expect.poll(()=>logo).toBe(png1x1);
  await page.getByRole("button",{name:"恢复默认 Logo"}).click();
  await expect.poll(()=>name).toBe(hostile.trim());
  await page.locator(".ih-mobile [data-page=overview]").click();
  await page.selectOption("#ih-mail-unread","true"); await page.selectOption("#ih-mail-starred","false");
  await page.reload();
  await expect(page.locator("#ih-mail-unread")).toHaveValue("true");
  await expect(page.locator("#ih-mail-starred")).toHaveValue("false");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({path:"test-results/ui-productivity-mobile.png",fullPage:true});
  await page.locator(".ih-mobile [data-page=admin]").click();
  const longName="x".repeat(60);
  await page.locator("#ih-site-name").fill(longName);await page.getByRole("button",{name:"保存站点名称"}).click();
  await expect(page).toHaveTitle(longName);
  await page.getByRole("button",{name:"退出",exact:true}).click();
  await expect(page.locator(".ih-lock h1")).toHaveText(longName);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({path:"test-results/ui-branding-mobile.png",fullPage:true});
});
