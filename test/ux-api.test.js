const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { UserRepository } = require("../repository");
const { accountHealth, safeFailure } = require("../health-status");

function boot(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.DATA_DIR = dir;
  process.env.INBOXHARBOR_ADMIN_TOKEN = "ux-api-token";
  delete require.cache[require.resolve("../server")];
  return require("../server");
}

test("health projection uses stable safe categories without provider detail", () => {
  assert.equal(accountHealth({ status: "active", syncEnabled: false }).state, "paused");
  assert.equal(accountHealth({ status: "invalid", lastSyncError: "invalid_grant: refresh token abc" }).state, "authorization");
  assert.equal(accountHealth({ status: "active", syncStatus: "failed", lastSyncError: "ENOTFOUND internal.example" }).state, "network");
  assert.equal(accountHealth({ status: "active", syncStatus: "failed", lastSyncError: "unexpected sync failure" }).state, "unsynced");
  assert.equal(safeFailure("permission denied for token xyz").code, "permission");
});

test("tenant health, manual partial sync, filters, and delivery history are safe", async () => {
  const { app, __auth, __storage, setSyncCoreForTest, closeStorage } = boot("ih-ux-api-");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const owner = await __auth.bootstrapOwner("owner@example.test", "long safe password");
    for (const email of ["alice@example.test", "bob@example.test"]) {
      const invitation = __auth.createInvitation(owner, email, "user");
      await __auth.acceptInvitation(invitation, email, "long safe password");
    }
    const users = Object.fromEntries(__auth.listUsers().map((user) => [user.email, user]));
    const alice = new UserRepository(__storage, users["alice@example.test"].id);
    const bob = new UserRepository(__storage, users["bob@example.test"].id);
    const healthyId = alice.insert("accounts", {
      username: "good@example.test", provider: "google", status: "active", readEnabled: true, syncEnabled: true, syncStatus: "idle", lastSyncAt: "2026-01-02T10:00:00.000Z",
    }, { provider: "google", address: "good@example.test" });
    const brokenId = alice.insert("accounts", {
      username: "broken@example.test", provider: "google", status: "pending", readEnabled: true, syncEnabled: true, syncStatus: "pending",
    }, { provider: "google", address: "broken@example.test" });
    const pausedId = alice.insert("accounts", {
      username: "paused@example.test", provider: "google", status: "active", readEnabled: true, syncEnabled: false, syncStatus: "idle",
    }, { provider: "google", address: "paused@example.test" });
    const mailId = alice.insert("messages", {
      subject: "Receipt", sender: "billing@example.test", account: "good@example.test", receivedAt: "2026-01-02T12:00:00.000Z", content: "safe body",
    }, { account_id: healthyId });
    alice.insert("messages", {
      subject: "Older", sender: "other@example.test", account: "good@example.test", receivedAt: "2025-12-31T12:00:00.000Z",
    }, { account_id: healthyId });
    const channelId = alice.insert("channels", { type: "webhook", enabled: true, config: { url: "https://example.test/hook" } }, { type: "webhook" });
    const bobAccount = bob.insert("accounts", { username: "bob@example.test", provider: "google" }, { provider: "google", address: "bob@example.test" });
    const bobMail = bob.insert("messages", { subject: "Bob private", sender: "bob@example.test", account: "bob@example.test", receivedAt: "2026-01-01T00:00:00.000Z" }, { account_id: bobAccount });
    __storage.db.prepare("INSERT INTO notification_deliveries VALUES (?,?,?,?,?,?)").run(
      "alice-delivery", users["alice@example.test"].id, channelId, mailId,
      JSON.stringify({ state: "failed", attempts: 3, updatedAt: "2026-01-02T12:01:00.000Z", nextRetryAt: Date.parse("2026-01-02T12:02:00.000Z"), error: "ECONNRESET token=secret" }),
      "2026-01-02T12:00:00.000Z",
    );
    __storage.db.prepare("INSERT INTO notification_deliveries VALUES (?,?,?,?,?,?)").run(
      "bob-delivery", users["bob@example.test"].id, null, bobMail,
      JSON.stringify({ state: "delivered", attempts: 1 }), "2026-01-02T12:00:00.000Z",
    );
    __storage.db.prepare("INSERT INTO notification_deliveries VALUES (?,?,?,?,?,?)").run(
      "alice-malformed", users["alice@example.test"].id, null, null, "not-json", "2026-01-02T12:00:00.000Z",
    );

    const login = async (email) => {
      const response = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "long safe password" }) });
      return response.headers.get("set-cookie").split(";")[0];
    };
    const aliceCookie = await login("alice@example.test");

    const accounts = await (await fetch(base + "/api/accounts", { headers: { cookie: aliceCookie } })).json();
    const good = accounts.accounts.find((account) => account.id === healthyId);
    assert.equal(good.health.state, "normal");
    assert.equal(Object.hasOwn(good.health, "lastSyncError"), false);

    const filtered = await (await fetch(base + "/api/mails?sender=billing&start=2026-01-02&end=2026-01-02", { headers: { cookie: aliceCookie } })).json();
    assert.equal(filtered.mails.length, 1);
    assert.equal(filtered.mails[0].sender, "billing@example.test");
    assert.equal((await fetch(base + "/api/mails?dateFrom=not-a-date", { headers: { cookie: aliceCookie } })).status, 400);

    const history = await (await fetch(base + "/api/v1/notifications/deliveries?state=failed", { headers: { cookie: aliceCookie } })).json();
    assert.equal(history.total, 1);
    assert.equal(history.deliveries[0].channelType, "webhook");
    assert.equal(history.deliveries[0].mail.subject, "Receipt");
    assert.equal(history.deliveries[0].error.code, "network");
    assert.equal(history.deliveries[0].nextRetryAt, null);
    assert.equal(JSON.stringify(history).includes("secret"), false);

    const testFailure = await fetch(base + "/api/v1/notifications/webhook/test", { method: "POST", headers: { cookie: aliceCookie, "content-type": "application/json" }, body: JSON.stringify({ config: { url: "" } }) });
    assert.equal(testFailure.status, 400);
    const afterTest = await (await fetch(base + "/api/v1/notifications/deliveries", { headers: { cookie: aliceCookie } })).json();
    assert.ok(afterTest.deliveries.some((delivery) => delivery.kind === "test" && delivery.mail === null && delivery.error && delivery.nextRetryAt === null));

    setSyncCoreForTest(async (account) => {
      if (account.id === brokenId) throw new Error("ENOTFOUND provider.internal.example token=secret");
      account.status = "active";
      account.syncStatus = "idle";
      account.lastSyncAt = "2026-01-02T13:00:00.000Z";
      return [];
    });
    const manual = await (await fetch(base + "/api/accounts/fetch-mail", { method: "POST", headers: { cookie: aliceCookie, "content-type": "application/json" }, body: JSON.stringify({ ids: [healthyId, brokenId, pausedId] }) })).json();
    assert.equal(manual.success, true);
    assert.equal(manual.attemptedCount, 2);
    assert.equal(manual.succeededCount, 1);
    assert.equal(manual.failedCount, 1);
    assert.equal(manual.skippedCount, 1);
    assert.equal(manual.results.find((result) => result.accountId === pausedId).skipped, true);
    assert.equal(manual.results.find((result) => result.accountId === brokenId).health.state, "network");
    assert.equal(JSON.stringify(manual).includes("provider.internal.example"), false);
  } finally {
    setSyncCoreForTest(null);
    server.close();
    closeStorage();
  }
});
