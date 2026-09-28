const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { normalizePolicy, matchingChannelIds, isQuiet } = require("../notification-policy");
const { UserRepository } = require("../repository");

function boot() {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ih-policy-"));
  process.env.INBOXHARBOR_ADMIN_TOKEN = "policy-token";
  delete require.cache[require.resolve("../server")];
  return require("../server");
}
function user(storage, id, role = "user") { storage.db.prepare("INSERT INTO users VALUES (?,?,?,?,?,?,?)").run(id, id+"@example.test", "hash", role, 1, "now", "now"); }
function sessionCookie(auth, id, role = "user") {
  return `inboxharbor_session=${auth.createSession({ id, email: id + "@example.test", role })}`;
}
async function withHttp(work) {
  const instance = boot(), server = instance.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try { return await work({ ...instance, base: `http://127.0.0.1:${server.address().port}` }); }
  finally { await new Promise((resolve) => server.close(resolve)); instance.closeStorage(); }
}
async function api(base, cookie, pathname, method = "GET", body) {
  const response = await fetch(base + pathname, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, body: await response.json() };
}

test("notification policy validates tenant references and unions matching channels", () => {
  const policy = normalizePolicy({ dedupeMinutes: 10, quietHours: { enabled: false, start: "22:00", end: "08:00", timeZone: "UTC" }, rules: [
    { id: "a", accountId: "account-a", sender: "alerts@", channelIds: ["one"] },
    { id: "b", keyword: "code", channelIds: ["two", "one"] },
  ] }, { accountIds: new Set(["account-a"]), channelIds: new Set(["one", "two"]) });
  assert.deepEqual(matchingChannelIds(policy, { accountId: "account-a", sender: "alerts@example.test", subject: "Your code" }, [{ id: "one", enabled: true }, { id: "two", enabled: true }]).sort(), ["one", "two"]);
  assert.equal(isQuiet({ ...policy, quietHours: { enabled: true, start: "00:00", end: "23:59", timeZone: "UTC" } }, Date.parse("2026-01-01T12:00:00Z")), true);
  assert.throws(() => normalizePolicy({ rules: [{ channelIds: ["other"] }] }, { accountIds: new Set(), channelIds: new Set() }), /渠道/);
});

test("policy delivery is tenant-scoped, deduplicates successful repeats, queues quiet hours, and brands messages", async () => {
  const { __storage, __auth, pushTenantNotifications, closeStorage } = boot();
  try {
    user(__storage, "alice"); user(__storage, "bob");
    __auth.setSetting("branding_site_name", "收件塔");
    const alice = new UserRepository(__storage, "alice"), bob = new UserRepository(__storage, "bob");
    const account = alice.insert("accounts", { username: "a@example.test", provider: "google" }, { provider: "google", address: "a@example.test" });
    const one = alice.insert("channels", { enabled: true, type: "telegram", config: { token: "t", chatId: "1" } }, { type: "telegram" });
    const two = alice.insert("channels", { enabled: true, type: "telegram", config: { token: "u", chatId: "2" } }, { type: "telegram" });
    const bobChannel = bob.insert("channels", { enabled: true, type: "telegram", config: { token: "v", chatId: "3" } }, { type: "telegram" });
    __storage.db.prepare("INSERT INTO instance_settings (key,value) VALUES (?,?)").run("user:alice:notificationPolicy", JSON.stringify({ dedupeMinutes: 10, quietHours: { enabled: false, start: "22:00", end: "08:00", timeZone: "UTC" }, rules: [{ id: "match", accountId: account, sender: "alerts@", keyword: "code", channelIds: [one, two] }] }));
    let sent = [], messageInputs = [];
    const first = alice.insert("messages", { accountId: account, sender: "alerts@example.test", subject: "Your code", content: "1234" }, { account_id: account });
    await pushTenantNotifications([{ userId: "alice", mail: { id: first, accountId: account, sender: "alerts@example.test", subject: "Your code", content: "1234" } }], { now: Date.parse("2026-01-01T12:00:00Z"), sendFn: async (channel, message) => { sent.push([channel.id, message.subject]); }, messageForFn: (mail) => { messageInputs.push(mail.siteName); return { subject: `${mail.siteName}：新邮件` }; } });
    assert.deepEqual(sent.sort(), [[one, "收件塔：新邮件"], [two, "收件塔：新邮件"]].sort());
    assert.deepEqual(messageInputs.sort(), ["收件塔", "收件塔"]);
    const second = alice.insert("messages", { accountId: account, sender: "alerts@example.test", subject: "Your code", content: "1234" }, { account_id: account });
    await pushTenantNotifications([{ userId: "alice", mail: { id: second, accountId: account, sender: "alerts@example.test", subject: "Your code", content: "1234" } }], { now: Date.parse("2026-01-01T12:01:00Z"), sendFn: async () => { throw new Error("should dedupe"); }, messageForFn: (mail) => mail });
    assert.equal(__storage.db.prepare("SELECT count(*) AS count FROM notification_deliveries WHERE user_id=? AND message_id=?").get("alice", second).count, 2);
    const quiet = { dedupeMinutes: 0, quietHours: { enabled: true, start: "00:00", end: "23:59", timeZone: "UTC" }, rules: [{ id: "all", channelIds: [one] }] };
    __storage.db.prepare("INSERT OR REPLACE INTO instance_settings (key,value) VALUES (?,?)").run("user:alice:notificationPolicy", JSON.stringify(quiet));
    const third = alice.insert("messages", { accountId: account, sender: "other@example.test", subject: "later", content: "body" }, { account_id: account });
    await pushTenantNotifications([{ userId: "alice", mail: { id: third, accountId: account, sender: "other@example.test", subject: "later", content: "body" } }], { now: Date.parse("2026-01-01T12:00:00Z"), sendFn: async () => { throw new Error("quiet"); }, messageForFn: (mail) => mail });
    const pending = __storage.db.prepare("SELECT status FROM notification_deliveries WHERE user_id=? AND message_id=? AND channel_id=?").get("alice", third, one);
    const pendingStatus = JSON.parse(pending.status);
    assert.deepEqual({ state: pendingStatus.state, attempts: pendingStatus.attempts, deferredReason: pendingStatus.deferredReason }, { state: "pending", attempts: 0, deferredReason: "quiet_hours" });
    assert.equal(__storage.db.prepare("SELECT count(*) AS count FROM notification_deliveries WHERE user_id=?").get("bob").count, 0);
    assert.equal(bobChannel.length > 0, true);
  } finally { closeStorage(); }
});


test("batch state HTTP filters unread and starred without writing foreign or unknown mail IDs", async () => {
  await withHttp(async ({ __storage, __auth, base }) => {
    user(__storage, "alice"); user(__storage, "bob");
    const alice = new UserRepository(__storage, "alice"), bob = new UserRepository(__storage, "bob");
    const own = alice.insert("messages", { subject: "own", isRead: false, isStarred: false }, { account_id: null });
    const foreign = bob.insert("messages", { subject: "foreign", isRead: false, isStarred: false }, { account_id: null });
    const cookie = sessionCookie(__auth, "alice");

    const changed = await api(base, cookie, "/api/mails/batch-state", "POST", { ids: [own, foreign, "missing"], state: { isRead: true, isStarred: true } });
    assert.equal(changed.response.status, 200);
    assert.equal(changed.body.updatedCount, 1);
    assert.equal(changed.body.localOnly, true);
    const ownRow = alice.get("messages", own).payload, foreignRow = bob.get("messages", foreign).payload;
    assert.equal(ownRow.isRead, true); assert.equal(ownRow.isStarred, true);
    assert.equal(foreignRow.isRead, false); assert.equal(foreignRow.isStarred, false);
    assert.deepEqual(changed.body.mails.map((mail) => mail.id), [own]);
    const noOwnedSelection = await api(base, cookie, "/api/mails/batch-state", "POST", { ids: [foreign, "missing"], state: { isRead: false } });
    assert.equal(noOwnedSelection.response.status, 200);
    assert.equal(noOwnedSelection.body.updatedCount, 0);
    assert.equal(alice.get("messages", own).payload.isRead, true);
    const malformedBatch = await api(base, cookie, "/api/mails/batch-state", "POST", { ids: [own], state: { isRead: "yes" } });
    assert.equal(malformedBatch.response.status, 400);

    const unread = await api(base, cookie, "/api/mails?unread=true");
    assert.equal(unread.response.status, 200);
    assert.equal(unread.body.mails.some((mail) => mail.id === own), false);
    const starred = await api(base, cookie, "/api/mails?starred=true");
    assert.equal(starred.response.status, 200);
    assert.deepEqual(starred.body.mails.map((mail) => mail.id), [own]);
    const invalid = await api(base, cookie, "/api/mails?unread=perhaps");
    assert.equal(invalid.response.status, 400);
  });
});

test("notification policy HTTP rejects malformed and cross-tenant channel references", async () => {
  await withHttp(async ({ __storage, __auth, base }) => {
    user(__storage, "alice"); user(__storage, "bob");
    const alice = new UserRepository(__storage, "alice"), bob = new UserRepository(__storage, "bob");
    const account = alice.insert("accounts", { username: "a@example.test", provider: "google" }, { provider: "google", address: "a@example.test" });
    const ownChannel = alice.insert("channels", { enabled: true, type: "telegram", config: { token: "a", chatId: "1" } }, { type: "telegram" });
    const foreignChannel = bob.insert("channels", { enabled: true, type: "telegram", config: { token: "b", chatId: "2" } }, { type: "telegram" });
    const cookie = sessionCookie(__auth, "alice");

    const malformed = await api(base, cookie, "/api/v1/notification-rules", "PUT", { rules: "not-an-array" });
    assert.equal(malformed.response.status, 400);
    const foreign = await api(base, cookie, "/api/v1/notification-rules", "PUT", {
      rules: [{ id: "foreign", accountId: account, channelIds: [foreignChannel] }],
    });
    assert.equal(foreign.response.status, 400);
    const accepted = await api(base, cookie, "/api/v1/notification-rules", "PUT", {
      dedupeMinutes: 5,
      quietHours: { enabled: true, start: "22:00", end: "08:00", timeZone: "UTC" },
      rules: [{ id: "own", accountId: account, channelIds: [ownChannel] }],
    });
    assert.equal(accepted.response.status, 200);
    assert.deepEqual(accepted.body.policy.rules[0].channelIds, [ownChannel]);
    assert.equal(JSON.stringify(accepted.body.policy).includes(foreignChannel), false);
  });
});

test("quiet-hours delivery resumes after a cross-midnight window without spending an attempt", async () => {
  const { __storage, pushTenantNotifications, retryTenantNotifications, closeStorage } = boot();
  try {
    user(__storage, "alice");
    const alice = new UserRepository(__storage, "alice");
    const account = alice.insert("accounts", { username: "a@example.test", provider: "google" }, { provider: "google", address: "a@example.test" });
    const channel = alice.insert("channels", { enabled: true, type: "telegram", config: { token: "a", chatId: "1" } }, { type: "telegram" });
    __storage.db.prepare("INSERT INTO instance_settings (key,value) VALUES (?,?)").run("user:alice:notificationPolicy", JSON.stringify({
      dedupeMinutes: 0,
      quietHours: { enabled: true, start: "22:00", end: "08:00", timeZone: "UTC" },
      rules: [{ id: "all", channelIds: [channel] }],
    }));
    const message = alice.insert("messages", { accountId: account, sender: "alert@example.test", subject: "overnight", content: "body" }, { account_id: account });
    const queuedAt = Date.parse("2026-01-01T23:30:00Z");
    await pushTenantNotifications([{ userId: "alice", mail: { id: message, accountId: account, sender: "alert@example.test", subject: "overnight", content: "body" } }], {
      now: queuedAt, sendFn: async () => { throw new Error("must not send in quiet hours"); }, messageForFn: (mail) => mail,
    });
    const pending = JSON.parse(__storage.db.prepare("SELECT status FROM notification_deliveries WHERE user_id=? AND channel_id=? AND message_id=?").get("alice", channel, message).status);
    assert.equal(pending.state, "pending"); assert.equal(pending.attempts, 0); assert.equal(pending.deferredReason, "quiet_hours");
    const sent = [];
    await retryTenantNotifications({
      now: Date.parse("2026-01-02T08:01:00Z"),
      sendFn: async (_channel, mail) => { sent.push(mail.id); },
      messageForFn: (mail) => mail,
    });
    assert.deepEqual(sent, [message]);
    const delivered = JSON.parse(__storage.db.prepare("SELECT status FROM notification_deliveries WHERE user_id=? AND channel_id=? AND message_id=?").get("alice", channel, message).status);
    assert.equal(delivered.state, "delivered"); assert.equal(delivered.attempts, 1);
  } finally { closeStorage(); }
});

test("in-flight duplicates wait for the lease, then produce one successful delivery and a skipped duplicate", async () => {
  const { __storage, pushTenantNotifications, retryTenantNotifications, closeStorage } = boot();
  try {
    user(__storage, "alice");
    const alice = new UserRepository(__storage, "alice");
    const account = alice.insert("accounts", { username: "a@example.test", provider: "google" }, { provider: "google", address: "a@example.test" });
    const channel = alice.insert("channels", { enabled: true, type: "telegram", config: { token: "a", chatId: "1" } }, { type: "telegram" });
    __storage.db.prepare("INSERT INTO instance_settings (key,value) VALUES (?,?)").run("user:alice:notificationPolicy", JSON.stringify({
      dedupeMinutes: 10, quietHours: { enabled: false, start: "22:00", end: "08:00", timeZone: "UTC" }, rules: [{ id: "all", channelIds: [channel] }],
    }));
    const first = alice.insert("messages", { accountId: account, sender: "alert@example.test", subject: "code", content: "1234" }, { account_id: account });
    const second = alice.insert("messages", { accountId: account, sender: "alert@example.test", subject: "code", content: "1234" }, { account_id: account });
    let firstStarted, release;
    const started = new Promise((resolve) => { firstStarted = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const now = Date.parse("2026-01-01T12:00:00Z");
    const failed = pushTenantNotifications([{ userId: "alice", mail: { id: first, accountId: account, sender: "alert@example.test", subject: "code", content: "1234" } }], {
      now, sendFn: async () => { firstStarted(); await gate; throw new Error("down"); }, messageForFn: (mail) => mail,
    });
    await started;
    await pushTenantNotifications([{ userId: "alice", mail: { id: second, accountId: account, sender: "alert@example.test", subject: "code", content: "1234" } }], {
      now, sendFn: async () => { throw new Error("in-flight duplicate must wait"); }, messageForFn: (mail) => mail,
    });
    const deferred = JSON.parse(__storage.db.prepare("SELECT status FROM notification_deliveries WHERE user_id=? AND channel_id=? AND message_id=?").get("alice", channel, second).status);
    assert.deepEqual({ state: deferred.state, attempts: deferred.attempts, deferredReason: deferred.deferredReason, nextRetryAt: deferred.nextRetryAt }, {
      state: "pending", attempts: 0, deferredReason: "dedupe_retry", nextRetryAt: now + 120000,
    });
    release(); await failed;
    const sent = [];
    await retryTenantNotifications({
      now: now + 120000,
      sendFn: async (_channel, mail) => { sent.push(mail.id); },
      messageForFn: (mail) => mail,
    });
    assert.equal(sent.length, 1);
    assert.ok([first, second].includes(sent[0]));
    const states = [first, second].map((id) => JSON.parse(__storage.db.prepare("SELECT status FROM notification_deliveries WHERE user_id=? AND channel_id=? AND message_id=?").get("alice", channel, id).status).state).sort();
    assert.deepEqual(states, ["delivered", "skipped"]);
  } finally { closeStorage(); }
});

test("deleting a policy channel reference does not broaden delivery to another channel", async () => {
  const { __storage, pushTenantNotifications, closeStorage } = boot();
  try {
    user(__storage, "alice");
    const alice = new UserRepository(__storage, "alice");
    const account = alice.insert("accounts", { username: "a@example.test", provider: "google" }, { provider: "google", address: "a@example.test" });
    const removed = alice.insert("channels", { enabled: true, type: "telegram", config: { token: "removed", chatId: "1" } }, { type: "telegram" });
    const remaining = alice.insert("channels", { enabled: true, type: "telegram", config: { token: "remaining", chatId: "2" } }, { type: "telegram" });
    __storage.db.prepare("INSERT INTO instance_settings (key,value) VALUES (?,?)").run("user:alice:notificationPolicy", JSON.stringify({
      dedupeMinutes: 0, quietHours: { enabled: false, start: "22:00", end: "08:00", timeZone: "UTC" }, rules: [{ id: "only-removed", channelIds: [removed] }],
    }));
    assert.equal(alice.delete("channels", removed), true);
    const mail = alice.insert("messages", { accountId: account, sender: "alerts@example.test", subject: "no broadening", content: "body" }, { account_id: account });
    const sent = [];
    await pushTenantNotifications([{ userId: "alice", mail: { id: mail, accountId: account, sender: "alerts@example.test", subject: "no broadening", content: "body" } }], {
      sendFn: async (channel) => { sent.push(channel.id); }, messageForFn: (value) => value,
    });
    assert.deepEqual(sent, []);
    assert.equal(__storage.db.prepare("SELECT count(*) AS count FROM notification_deliveries WHERE user_id=? AND channel_id=?").get("alice", remaining).count, 0);
  } finally { closeStorage(); }
});

test("a failed delivery due during quiet hours remains queued without another attempt", async () => {
  const { __storage, pushTenantNotifications, retryTenantNotifications, closeStorage } = boot();
  try {
    user(__storage, "alice");
    const alice = new UserRepository(__storage, "alice");
    const account = alice.insert("accounts", { username: "a@example.test", provider: "google" }, { provider: "google", address: "a@example.test" });
    const channel = alice.insert("channels", { enabled: true, type: "telegram", config: { token: "a", chatId: "1" } }, { type: "telegram" });
    __storage.db.prepare("INSERT INTO instance_settings (key,value) VALUES (?,?)").run("user:alice:notificationPolicy", JSON.stringify({
      dedupeMinutes: 0, quietHours: { enabled: true, start: "22:00", end: "08:00", timeZone: "UTC" }, rules: [{ id: "all", channelIds: [channel] }],
    }));
    const mail = alice.insert("messages", { accountId: account, sender: "alerts@example.test", subject: "late", content: "body" }, { account_id: account });
    const failedAt = Date.parse("2026-01-01T21:59:30Z");
    // Create a failed row before quiet hours, as would a completed first attempt.
    __storage.db.prepare("INSERT INTO notification_deliveries VALUES (?,?,?,?,?,?)").run(
      "failed-row", "alice", channel, mail, JSON.stringify({ state: "failed", attempts: 1, nextRetryAt: failedAt + 30000 }), new Date(failedAt).toISOString(),
    );
    const sent = [];
    await retryTenantNotifications({
      now: Date.parse("2026-01-01T22:01:00Z"),
      sendFn: async (_channel, value) => { sent.push(value.id); },
      messageForFn: (value) => value,
    });
    assert.deepEqual(sent, []);
    const queued = JSON.parse(__storage.db.prepare("SELECT status FROM notification_deliveries WHERE id=?").get("failed-row").status);
    assert.deepEqual({ state: queued.state, attempts: queued.attempts, deferredReason: queued.deferredReason }, { state: "pending", attempts: 1, deferredReason: "quiet_hours" });
  } finally { closeStorage(); }
});

test("retry worker delivers due pending rows and recovers expired sending leases", async () => {
  const { __storage, retryTenantNotifications, closeStorage } = boot();
  try {
    user(__storage, "alice");
    const alice = new UserRepository(__storage, "alice");
    const account = alice.insert("accounts", { username: "a@example.test", provider: "google" }, { provider: "google", address: "a@example.test" });
    const channel = alice.insert("channels", { enabled: true, type: "telegram", config: { token: "a", chatId: "1" } }, { type: "telegram" });
    const pendingMail = alice.insert("messages", { accountId: account, sender: "a@example.test", subject: "pending", content: "body" }, { account_id: account });
    const crashedMail = alice.insert("messages", { accountId: account, sender: "a@example.test", subject: "crashed", content: "body" }, { account_id: account });
    const now = Date.parse("2026-01-01T12:00:00Z");
    __storage.db.prepare("INSERT INTO notification_deliveries VALUES (?,?,?,?,?,?)").run("pending-row", "alice", channel, pendingMail, JSON.stringify({ state: "pending", attempts: 0, nextRetryAt: now, deferredReason: "dedupe_retry" }), new Date(now).toISOString());
    __storage.db.prepare("INSERT INTO notification_deliveries VALUES (?,?,?,?,?,?)").run("crashed-row", "alice", channel, crashedMail, JSON.stringify({ state: "sending", attempts: 1, claimedAt: now - 120001 }), new Date(now - 120001).toISOString());
    const sent = [];
    await retryTenantNotifications({ now, claimTtlMs: 120000, sendFn: async (_channel, mail) => { sent.push(mail.id); }, messageForFn: (mail) => mail });
    assert.deepEqual(sent.sort(), [pendingMail, crashedMail].sort());
    const pending = JSON.parse(__storage.db.prepare("SELECT status FROM notification_deliveries WHERE id=?").get("pending-row").status);
    const crashed = JSON.parse(__storage.db.prepare("SELECT status FROM notification_deliveries WHERE id=?").get("crashed-row").status);
    assert.deepEqual({ state: pending.state, attempts: pending.attempts }, { state: "delivered", attempts: 1 });
    assert.deepEqual({ state: crashed.state, attempts: crashed.attempts }, { state: "delivered", attempts: 2 });
  } finally { closeStorage(); }
});

test("connector check stays secret-free and only an owner may change connector configuration", async () => {
  await withHttp(async ({ __storage, __auth, base }) => {
    user(__storage, "owner", "owner"); user(__storage, "member");
    const ownerCookie = sessionCookie(__auth, "owner", "owner"), memberCookie = sessionCookie(__auth, "member");
    const denied = await api(base, memberCookie, "/api/v1/connectors", "PUT", {
      googleClientId: "123456789012-abcdef.apps.googleusercontent.com", googleClientSecret: "GOCSPX-secret-value",
    });
    assert.equal(denied.response.status, 403);
    const saved = await api(base, ownerCookie, "/api/v1/connectors", "PUT", {
      googleClientId: "123456789012-abcdef.apps.googleusercontent.com", googleClientSecret: "GOCSPX-secret-value",
    });
    assert.equal(saved.response.status, 200);
    const checked = await api(base, memberCookie, "/api/v1/connectors/check");
    assert.equal(checked.response.status, 200);
    assert.equal(checked.body.results.google.ready, true);
    assert.equal(JSON.stringify(checked.body).includes("GOCSPX-secret-value"), false);
    assert.equal(Object.hasOwn(checked.body.configuration.google, "clientSecret"), false);
    assert.match(checked.body.limitations.join(" "), /不会验证 OAuth 同意屏/);
  });
});
