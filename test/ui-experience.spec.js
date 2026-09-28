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
  if (await notice.isVisible().catch(() => false))
    await notice.getByRole("button", { name: "我已安全保存" }).click();
}

async function mockMailExperience(page) {
  const account = {
    id: "account-a",
    username: "a@example.com",
    provider: "google",
    status: "active",
    readEnabled: true,
    sendEnabled: false,
    syncEnabled: true,
    health: {
      state: "normal",
      label: "同步正常",
      hint: "最近一次同步成功",
      lastSyncedAt: "2026-09-28T10:00:00.000Z",
      nextSyncAt: "2026-09-28T10:05:00.000Z",
    },
  };
  const mails = [{
    id: "mail-a",
    account: account.username,
    sender: "alerts@example.com",
    recipient: account.username,
    subject: "登录验证码",
    content: "验证码 123456",
    preview: "验证码 123456",
    code: "123456",
    category: "验证码",
    receivedAt: "2026-09-28T10:01:00.000Z",
    direction: "received",
    isRead: true,
  }];
  await page.route("**/api/accounts", route => route.fulfill({ json: { accounts: [account] } }));
  await page.route("**/api/mails?*", route => route.fulfill({
    json: { mails, pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 }, facets: { 全部: 1, 验证码: 1 } },
  }));
  await page.route("**/api/v1/notifications", route => route.fulfill({
    json: {
      catalog: { bark: { name: "Bark", icon: "●", fields: [{ key: "deviceKey", label: "Device Key", placeholder: "device" }], guide: "测试渠道" } },
      configuration: { includeFullBody: false, shareLinkDays: 30, channels: [{ id: "channel-a", type: "bark", enabled: true, configured: { deviceKey: true } }] },
    },
  }));
  await page.route("**/api/v1/notifications/deliveries?*", route => route.fulfill({
    json: { success: true, deliveries: [{ id: "delivery-a", state: "failed", attempts: 2, channelType: "bark", createdAt: "2026-09-28T10:02:00.000Z", updatedAt: "2026-09-28T10:03:00.000Z", nextRetryAt: null, mail: { subject: "登录验证码", receivedAt: "2026-09-28T10:01:00.000Z" }, error: { label: "网络异常", hint: "请检查网络后重试。" }, deliveryNote: "渠道接受不代表终端已读" }], total: 1, page: 1, pageSize: 30 },
  }));
  await page.route("**/api/v1/notifications/*/test", route => route.fulfill({ json: { success: true, message: "测试请求已接受。" } }));
  await page.reload();
  await expect(page.locator("#ih-mail-sender")).toBeVisible();
}

test.describe("mail experience", () => {
  test("desktop renders health, mail filters, copy guidance and delivery history", async ({ page }, testInfo) => {
    await page.setViewportSize({width:1440,height:960});
    await unlock(page);
    await mockMailExperience(page);
    await page.getByRole("button", { name: "邮箱账户" }).first().click();
    await expect(page.locator("#ih-accounts-list")).toBeVisible();
    await expect(page.locator(".ih-last-checked").first()).toContainText("同步正常");
    await page.getByRole("button", { name: "概览" }).first().click();
    await page.locator(".ih-mail-row").first().click();
    await expect(page.locator(".ih-code-box-prominent")).toContainText("未验证有效性");
    await page.evaluate(()=>Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async value=>{window.copiedCode=value;}}}));
    await page.getByRole("button",{name:"复制验证码"}).click();
    expect(await page.evaluate(()=>window.copiedCode)).toBe("123456");
    await page.screenshot({path:testInfo.outputPath("mail-experience-desktop.png"),fullPage:false});
    await page.getByRole("button", { name: "通知渠道" }).first().click();
    await expect(page.locator("#ih-delivery-history")).toContainText("网络异常");
    await expect(page.locator("#ih-delivery-history")).toContainText("尝试 2 次");
    await page.locator(".ih-delivery-history").scrollIntoViewIfNeeded();
    await page.screenshot({path:testInfo.outputPath("notification-history-desktop.png"),fullPage:false});
  });

  test("mobile keeps account health and filter controls readable", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await unlock(page);
    await mockMailExperience(page);
    await page.locator('.ih-mobile [data-page="accounts"]').click();
    await expect(page.locator(".ih-last-checked").first()).toBeVisible();
    await page.screenshot({path:testInfo.outputPath("health-mobile.png"),fullPage:false});
    await page.locator('.ih-mobile [data-page="overview"]').click();
    await expect(page.locator(".ih-mail-tools input")).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("notification test is mocked and reports inline feedback", async ({ page }) => {
    await unlock(page);
    await mockMailExperience(page);
    await page.getByRole("button", { name: "通知渠道" }).first().click();
    await page.locator(".ih-test").first().click();
    await expect(page.locator(".ih-inline-feedback")).toContainText("测试请求已接受");
  });

  test("filter reset and per-user storage restore without cross-user leakage", async ({ page }) => {
    await unlock(page);
    await mockMailExperience(page);
    const userId = await page.evaluate(() => fetch("/api/auth/me").then(r => r.json()).then(x => x.user.id));
    await page.locator("#ih-mail-sender").fill("alerts@example.com");
    await page.locator("#ih-mail-reset").click();
    await expect(page.locator("#ih-mail-sender")).toHaveValue("");
    await page.evaluate((id) => localStorage.setItem(`inboxharbor.mail-preferences.${id}`, JSON.stringify({ sender: "alerts@example.com" })), userId);
    await page.reload();
    await expect(page.locator("#ih-mail-sender")).toHaveValue("alerts@example.com");
    await page.evaluate(() => localStorage.setItem("inboxharbor.mail-preferences.other-user", JSON.stringify({ sender: "other@example.com" })));
    await page.reload();
    await expect(page.locator("#ih-mail-sender")).toHaveValue("alerts@example.com");
    await page.route("**/api/auth/config",route=>route.fulfill({json:{ownerInitialized:true,allowPublicRegistration:false,user:{id:"other-user",email:"other@example.com",role:"user"}}}));
    await page.reload();
    await expect(page.locator("#ih-mail-sender")).toHaveValue("other@example.com");
  });

  test("latest mail request wins when an older response arrives later", async ({ page }) => {
    await unlock(page);
    await mockMailExperience(page);
    let calls = 0;
    await page.route("**/api/mails?*", async route => {
      calls += 1;
      const query = new URL(route.request().url()).searchParams.get("sender") || "";
      if (query === "old@example.com") await new Promise(resolve => setTimeout(resolve, 600));
      await route.fulfill({ json: { mails: [{ id: query || "old", sender: query || "old@example.com", account: "a@example.com", subject: query || "old", content: "body", preview: "body", category: "通知", receivedAt: "2026-09-28T10:00:00Z" }], pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 }, facets: { 全部: 1 } } });
    });
    await page.locator("#ih-mail-sender").fill("old@example.com");
    await page.waitForTimeout(320);
    await page.locator("#ih-mail-sender").fill("new@example.com");
    await expect(page.locator(".ih-mail-row").first()).toContainText("new@example.com");
    await page.waitForTimeout(700);
    await expect(page.locator(".ih-mail-row").first()).toContainText("new@example.com");
  });
});
