const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function boot() {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ih-connectors-"));
  process.env.INBOXHARBOR_ADMIN_TOKEN = "connector-token";
  delete require.cache[require.resolve("../server")];
  return require("../server");
}
function user(storage, id, role) {
  storage.db.prepare("INSERT INTO users VALUES (?,?,?,?,?,?,?)").run(id, id + "@example.test", "hash", role, 1, "now", "now");
}
function cookie(auth, id, role) {
  return "inboxharbor_session=" + auth.createSession({ id, email: id + "@example.test", role });
}
async function start(work) {
  const keys = ["MICROSOFT_CLIENT_ID", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "PUBLIC_BASE_URL"];
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  const instance = boot(), server = instance.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try { return await work({ ...instance, base: "http://127.0.0.1:" + server.address().port }); }
  finally {
    await new Promise((resolve) => server.close(resolve)); instance.closeStorage();
    for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
  }
}
async function api(base, session, pathname, method = "GET", body) {
  const response = await fetch(base + pathname, {
    method,
    headers: { ...(session ? { cookie: session } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, body: await response.json() };
}

test("connector details and checks are Owner-only while status is safe for every logged-in role", async () => {
  await start(async ({ __storage, __auth, base }) => {
    user(__storage, "owner", "owner"); user(__storage, "admin", "admin"); user(__storage, "member", "user");
    const owner = cookie(__auth, "owner", "owner"), admin = cookie(__auth, "admin", "admin"), member = cookie(__auth, "member", "user");

    const anonymous = await api(base, "", "/api/v1/connectors/status");
    assert.equal(anonymous.response.status, 401);
    for (const session of [owner, admin, member]) {
      const status = await api(base, session, "/api/v1/connectors/status");
      assert.equal(status.response.status, 200);
      assert.deepEqual(status.body, { success: true, providers: { google: { configured: false }, microsoft: { configured: false } } });
    }

    for (const session of [admin, member]) {
      for (const endpoint of ["/api/v1/connectors", "/api/v1/connectors/check"]) {
        const get = await api(base, session, endpoint);
        assert.equal(get.response.status, 403);
        assert.match(get.body.message, /仅 Owner 可以管理连接器配置/);
      }
      const post = await api(base, session, "/api/v1/connectors/check", "POST", {});
      assert.equal(post.response.status, 403);
      assert.match(post.body.message, /仅 Owner 可以管理连接器配置/);
    }

    const saved = await api(base, owner, "/api/v1/connectors", "PUT", {
      microsoftClientId: "00001111-aaaa-2222-bbbb-3333cccc4444",
      googleClientId: "123456789012-abcdef.apps.googleusercontent.com",
      googleClientSecret: "GOCSPX-private-value",
    });
    assert.equal(saved.response.status, 200);
    const detail = await api(base, owner, "/api/v1/connectors");
    const check = await api(base, owner, "/api/v1/connectors/check", "POST", {});
    assert.equal(detail.response.status, 200); assert.equal(check.response.status, 200);
    assert.equal(detail.body.configuration.google.clientIdConfigured, true);
    assert.equal(check.body.results.google.ready, true);

    for (const session of [owner, admin, member]) {
      const status = await api(base, session, "/api/v1/connectors/status");
      assert.deepEqual(status.body, { success: true, providers: { google: { configured: true }, microsoft: { configured: true } } });
      const serialized = JSON.stringify(status.body);
      assert.equal(serialized.includes("GOCSPX-private-value"), false);
      assert.equal(serialized.includes("apps.googleusercontent.com"), false);
      assert.equal(serialized.includes("googleCallbackUrl"), false);
      assert.equal(serialized.includes("publicBaseUrl"), false);
    }
  });
});
