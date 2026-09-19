const test = require("node:test");
const assert = require("node:assert/strict");
const {
  clearGmailBootstrap,
  fetchGmailIncremental,
  fetchMicrosoftDelta,
  getPendingGmailBootstrap,
  stageGmailBootstrap,
} = require("../mail-sync");

function jsonResponse(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return data; } };
}

test("Gmail 首次同步读取消息列表并保存 profile historyId", async () => {
  const urls = [];
  const result = await fetchGmailIncremental({
    accessToken: "token",
    cursor: null,
    fetchImpl: async (url) => {
      urls.push(url);
      return url.endsWith("/profile") ? jsonResponse({ historyId: "9001" }) : jsonResponse({ messages: [{ id: "a" }, { id: "b" }] });
    },
  });
  assert.deepEqual(result, { messageIds: ["a", "b"], cursor: "9001", reset: false, bootstrap: true });
  assert.equal(urls[0].endsWith("/profile"), true);
  assert.equal(urls.some((url) => url.endsWith("/profile")), true);
});

test("Gmail history 增量同步翻页并去重 messageAdded", async () => {
  let call = 0;
  const result = await fetchGmailIncremental({
    accessToken: "token",
    cursor: "9001",
    fetchImpl: async (url) => {
      call += 1;
      assert.match(url, /historyTypes=messageAdded/);
      return call === 1
        ? jsonResponse({ history: [{ messagesAdded: [{ message: { id: "a" } }, { message: { id: "b" } }] }], historyId: "9002", nextPageToken: "next" })
        : jsonResponse({ history: [{ messagesAdded: [{ message: { id: "b" } }, { message: { id: "c" } }] }], historyId: "9003" });
    },
  });
  assert.deepEqual(result, { messageIds: ["a", "b", "c"], cursor: "9003", reset: false, bootstrap: false });
});

test("Gmail historyId 失效 404 时安全回退首次同步", async () => {
  const result = await fetchGmailIncremental({
    accessToken: "token",
    cursor: "123456",
    fetchImpl: async (url) => {
      if (url.includes("/history?")) return jsonResponse({}, 404);
      if (url.endsWith("/profile")) return jsonResponse({ historyId: "fresh" });
      return jsonResponse({ messages: [{ id: "latest" }] });
    },
  });
  assert.deepEqual(result, { messageIds: ["latest"], cursor: "fresh", reset: true, bootstrap: true });
});

test("Gmail 旧版邮件 ID 游标自动迁移为首次原生同步", async () => {
  const urls = [];
  const result = await fetchGmailIncremental({
    accessToken: "token",
    cursor: "mail_gmail_legacy-id",
    fetchImpl: async (url) => {
      urls.push(url);
      return url.endsWith("/profile") ? jsonResponse({ historyId: "fresh" }) : jsonResponse({ messages: [] });
    },
  });
  assert.equal(result.cursor, "fresh");
  assert.equal(urls.some((url) => url.includes("/history?")), false);
});

test("Gmail bootstrap 详情失败后重试固定基线与待处理邮件", () => {
  const account = {};
  const firstBatch = { messageIds: ["older", "newer", "older"], cursor: "9001", bootstrap: true };
  assert.equal(stageGmailBootstrap(account, firstBatch), true);

  // Simulate a transient detail failure: the staged state remains on the
  // account even if a later provider list no longer contains "older".
  assert.deepEqual(getPendingGmailBootstrap(account), {
    messageIds: ["older", "newer"],
    cursor: "9001",
    reset: false,
    bootstrap: true,
  });
  clearGmailBootstrap(account);
  assert.equal(getPendingGmailBootstrap(account), null);
});

test("Microsoft delta 跟随 nextLink 并保存 deltaLink", async () => {
  const urls = [];
  const result = await fetchMicrosoftDelta({
    accessToken: "token",
    cursor: null,
    fetchImpl: async (url) => {
      urls.push(url);
      return urls.length === 1
        ? jsonResponse({ value: [{ id: "one" }, { id: "deleted", "@removed": { reason: "deleted" } }], "@odata.nextLink": "https://graph.microsoft.com/page-2" })
        : jsonResponse({ value: [{ id: "two" }], "@odata.deltaLink": "https://graph.microsoft.com/delta?$deltatoken=abc" });
    },
  });
  assert.deepEqual(result.messages.map((mail) => mail.id), ["one", "two"]);
  assert.match(urls[0], /\/me\/mailFolders\/inbox\/messages\/delta\?/);
  assert.match(urls[0], /changeType=created/);
  assert.equal(result.cursor, "https://graph.microsoft.com/delta?$deltatoken=abc");
  assert.equal(result.complete, true);
  assert.deepEqual(urls.slice(1), ["https://graph.microsoft.com/page-2"]);
});

test("Microsoft delta 有限分页后保存 nextLink 供下轮继续", async () => {
  const result = await fetchMicrosoftDelta({
    accessToken: "token",
    cursor: "https://graph.microsoft.com/start",
    maxPages: 1,
    fetchImpl: async () => jsonResponse({ value: [{ id: "one" }], "@odata.nextLink": "https://graph.microsoft.com/resume" }),
  });
  assert.equal(result.cursor, "https://graph.microsoft.com/resume");
  assert.equal(result.complete, false);
});

test("Microsoft 旧版邮件 ID 游标自动迁移为首次 delta 同步", async () => {
  let requestedUrl = "";
  await fetchMicrosoftDelta({
    accessToken: "token",
    cursor: "mail_legacy-id",
    fetchImpl: async (url) => {
      requestedUrl = url;
      return jsonResponse({ value: [], "@odata.deltaLink": "https://graph.microsoft.com/delta?$deltatoken=fresh" });
    },
  });
  assert.match(requestedUrl, /\/me\/mailFolders\/inbox\/messages\/delta\?/);
});

test("Microsoft deltaLink 失效 410 时安全回退首次同步", async () => {
  let call = 0;
  const result = await fetchMicrosoftDelta({
    accessToken: "token",
    cursor: "https://graph.microsoft.com/expired",
    fetchImpl: async (url) => {
      call += 1;
      if (call === 1) return jsonResponse({}, 410);
      assert.match(url, /\/me\/mailFolders\/inbox\/messages\/delta\?/);
      return jsonResponse({ value: [{ id: "fresh" }], "@odata.deltaLink": "https://graph.microsoft.com/delta?$deltatoken=new" });
    },
  });
  assert.deepEqual(result.messages.map((mail) => mail.id), ["fresh"]);
  assert.equal(result.complete, true);
});
