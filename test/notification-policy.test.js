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
function user(storage, id) { storage.db.prepare("INSERT INTO users VALUES (?,?,?,?,?,?,?)").run(id, id+"@example.test", "hash", "user", 1, "now", "now"); }

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
