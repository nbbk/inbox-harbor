const { test, expect } = require("@playwright/test");

const baseURL = process.env.INBOXHARBOR_TEST_URL || "http://127.0.0.1:5555";
const token = process.env.INBOXHARBOR_ADMIN_TOKEN || "qa-local-token";

async function unlock(page) {
  await page.goto(baseURL);
  await expect(page).toHaveTitle(/InboxHarbor/);
  await page.getByPlaceholder("本机访问口令").fill(token);
  await page.getByRole("button", { name: "进入收件港" }).click();
  await expect(page.getByText("你的邮件，安静地靠岸。")).toBeVisible();
}

test("desktop notification settings render and expose channel guidance", async ({
  page,
}) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await unlock(page);
  await page.getByRole("button", { name: "通知渠道" }).click();
  await expect(page.locator(".ih-channel")).toHaveCount(9);
  await expect(page.getByText("电子邮件（SMTP）")).toBeVisible();
  await page.locator(".ih-channel").filter({ hasText: "Bark (iOS)" }).click();
  await expect(page.locator("#ih-channel-guide")).toContainText("Device Key");
  await expect(page.getByLabel("完整正文")).toBeChecked();
  await page.screenshot({
    path: "../qa/inboxharbor-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("mobile layout has bottom navigation and no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await unlock(page);
  await page
    .locator(".ih-mobile")
    .getByRole("button", { name: "通知" })
    .click();
  await expect(page.locator(".ih-mobile")).toBeVisible();
  const overflows = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
  await page.screenshot({
    path: "../qa/inboxharbor-mobile.png",
    fullPage: true,
  });
});

test("account page exposes read and send permission switches", async ({
  page,
}) => {
  const accounts = Array.from({ length: 23 }, (_, index) => ({
    id: `fixture-${index + 1}`,
    username:
      index % 2
        ? `microsoft-${index + 1}@outlook.com`
        : `google-${index + 1}@gmail.com`,
    provider: index % 2 ? "microsoft" : "google",
    status: index < 3 ? "pending" : "active",
    readEnabled: true,
    sendEnabled: index % 3 === 0,
    lastChecked: "2026-09-05T08:00:00.000Z",
  }));
  accounts.push({
    id: "legacy-1",
    username: "legacy@example.net",
    provider: "other",
    status: "unsupported",
    lastChecked: "2026-09-05T08:00:00.000Z",
  });
  const additions = [];
  await page.route("**/api/accounts", (route) =>
    route.fulfill({ json: { success: true, accounts } }),
  );
  await page.route("**/api/accounts/add", async (route) => {
    additions.push(route.request().postDataJSON());
    await route.fulfill({ json: { success: true } });
  });
  await unlock(page);
  await page.getByRole("button", { name: "邮箱账户" }).click();
  await expect(page.getByRole("button", { name: "添加邮箱" })).toBeVisible();
  await expect(
    page.locator(".ih-account-row:not(.ih-account-row-head)"),
  ).toHaveCount(10);
  await expect(page.getByRole("button", { name: "Google  12" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Microsoft  11" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "全部账户  24" }),
  ).toBeVisible();
  await page.getByLabel("授权状态").selectOption("unsupported");
  const legacyRow = page
    .locator(".ih-account-row:not(.ih-account-row-head)")
    .filter({ hasText: "legacy@example.net" });
  await expect(legacyRow).toContainText("仅可清理");
  await expect(legacyRow.getByRole("button", { name: "授权" })).toHaveCount(0);
  await expect(legacyRow.getByRole("button", { name: "删除" })).toBeVisible();
  await page.getByLabel("授权状态").selectOption("all");
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page.getByRole("button", { name: "第 2 页" })).toHaveClass(
    /active/,
  );
  await page.getByLabel("每页展示数量").selectOption("20");
  await expect(
    page.locator(".ih-account-row:not(.ih-account-row-head)"),
  ).toHaveCount(20);
  await page.getByRole("button", { name: "Google  12" }).click();
  await expect(
    page.locator(".ih-account-row:not(.ih-account-row-head)"),
  ).toHaveCount(12);
  await page.screenshot({
    path: "../qa/inboxharbor-accounts-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "添加邮箱" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("授权服务商").selectOption("microsoft");
  await page
    .getByLabel("邮箱地址")
    .fill("first@outlook.com\nsecond@company.example");
  await page.screenshot({
    path: "../qa/inboxharbor-add-accounts.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "添加账户" }).click();
  await expect.poll(() => additions.length).toBe(2);
  expect(additions.every((item) => item.provider === "microsoft")).toBe(true);
});

test("account authorization errors are visible and mobile account layout does not overflow", async ({
  page,
}) => {
  await page.route("**/api/accounts", (route) =>
    route.fulfill({
      json: {
        success: true,
        accounts: [
          {
            id: "google-1",
            username: "owner@gmail.com",
            provider: "google",
            status: "pending",
            readEnabled: true,
            sendEnabled: false,
          },
        ],
      },
    }),
  );
  await page.route("**/api/auth/google/url**", (route) =>
    route.fulfill({
      status: 503,
      json: { success: false, message: "尚未配置 Google OAuth" },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await unlock(page);
  await page
    .locator(".ih-mobile")
    .getByRole("button", { name: "账户" })
    .click();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("尚未配置 Google OAuth");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "授权" }).click();
  await expect(
    page.locator(".ih-account-row:not(.ih-account-row-head)"),
  ).toHaveCount(1);
  await expect(page.locator(".ih-account-row-head")).toBeHidden();
  const overflows = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
  const separated = await page
    .locator(".ih-account-row:not(.ih-account-row-head)")
    .evaluate((row) => {
      const parts = [
        ".ih-account-identity",
        ".ih-permissions",
        ".ih-last-checked",
        ".ih-account-actions",
      ].map((selector) => row.querySelector(selector).getBoundingClientRect());
      return parts.every(
        (rect, index) => index === 0 || rect.top >= parts[index - 1].bottom,
      );
    });
  expect(separated).toBe(true);
  await page.screenshot({
    path: "../qa/inboxharbor-accounts-mobile.png",
    fullPage: true,
  });
});

test("connector setup guides beginners, saves once, and supports multiple mailbox authorization", async ({
  page,
}) => {
  let configuration = {
    microsoft: { configured: false, clientId: "", managedByEnvironment: false },
    google: {
      clientIdConfigured: false,
      clientId: "",
      clientSecretConfigured: false,
      clientIdManagedByEnvironment: false,
      clientSecretManagedByEnvironment: false,
    },
    publicBaseUrl: "http://localhost:5555",
    publicBaseUrlManagedByEnvironment: false,
    googleCallbackUrl: "http://localhost:5555/auth/google/callback",
  };
  let savedBody;
  await page.route("**/api/v1/connectors", async (route) => {
    if (route.request().method() === "PUT") {
      savedBody = route.request().postDataJSON();
      configuration = {
        microsoft: {
          configured: true,
          clientId: savedBody.microsoftClientId,
          managedByEnvironment: false,
        },
        google: {
          clientIdConfigured: true,
          clientId: savedBody.googleClientId,
          clientSecretConfigured: true,
          clientIdManagedByEnvironment: false,
          clientSecretManagedByEnvironment: false,
        },
        publicBaseUrl: savedBody.publicBaseUrl,
        publicBaseUrlManagedByEnvironment: false,
        googleCallbackUrl: `${savedBody.publicBaseUrl}/auth/google/callback`,
      };
    }
    await route.fulfill({ json: { success: true, configuration } });
  });
  await page.route("**/api/v1/connectors/check", (route) =>
    route.fulfill({
      json: {
        success: true,
        ready: true,
        results: {
          microsoft: { ready: true, message: "可以逐个授权 Microsoft 邮箱。" },
          google: { ready: true, message: "配置完整。" },
        },
        configuration,
      },
    }),
  );
  await page.setViewportSize({ width: 1440, height: 960 });
  await unlock(page);
  await page.getByRole("button", { name: "连接器设置" }).click();
  await expect(page.getByText("每个平台只配置一次应用")).toBeVisible();
  await expect(page.getByText("如何授权多个邮箱")).toBeVisible();
  await page.getByLabel("PUBLIC_BASE_URL").fill("https://mail.example.com");
  await page
    .getByLabel("Application (client) ID")
    .fill("00001111-aaaa-2222-bbbb-3333cccc4444");
  await page
    .getByLabel("Google Client ID")
    .fill("123456789012-abcdef.apps.googleusercontent.com");
  await page.locator("#cx-secret").fill("GOCSPX-example-secret");
  await page.getByRole("button", { name: "保存并检测配置" }).click();
  await expect(page.locator("#cx-result")).toContainText("保存成功");
  expect(savedBody.googleClientSecret).toBe("GOCSPX-example-secret");
  await expect(page.locator("#cx-secret")).toHaveValue("");
  await expect(page.locator("#cx-summary")).toContainText(
    "可授权多个 Google 邮箱",
  );
  await page.screenshot({
    path: "../qa/inboxharbor-connectors-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.locator(".ih-mobile").getByRole("button", { name: "设置" }),
  ).toBeVisible();
  const overflows = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
  await page.screenshot({
    path: "../qa/inboxharbor-connectors-mobile.png",
    fullPage: true,
  });
});
