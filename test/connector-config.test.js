const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizePublicBaseUrl,
  updateStoredConnectorConfig,
  resolveConnectorConfig,
  toPublicConnectorConfig,
} = require("../connector-config");

test("normalizes safe public URLs and rejects unsafe callback bases", () => {
  assert.equal(
    normalizePublicBaseUrl("https://mail.example.com/"),
    "https://mail.example.com",
  );
  assert.equal(
    normalizePublicBaseUrl("http://localhost:5555"),
    "http://localhost:5555",
  );
  assert.throws(
    () => normalizePublicBaseUrl("http://mail.example.com"),
    /https/,
  );
  assert.throws(
    () => normalizePublicBaseUrl("https://mail.example.com/path"),
    /路径/,
  );
  assert.throws(() => normalizePublicBaseUrl("javascript:alert(1)"), /http/);
});

test("validates connector identifiers and keeps an omitted secret", () => {
  const current = { googleClientSecret: "GOCSPX-existing-secret" };
  const next = updateStoredConnectorConfig(current, {
    microsoftClientId: "00001111-aaaa-2222-bbbb-3333cccc4444",
    googleClientId: "123456789012-abcdef.apps.googleusercontent.com",
    googleClientSecret: "",
    publicBaseUrl: "https://mail.example.com/",
  });
  assert.equal(next.googleClientSecret, current.googleClientSecret);
  assert.equal(next.publicBaseUrl, "https://mail.example.com");
  assert.throws(
    () => updateStoredConnectorConfig({}, { microsoftClientId: "not-an-id" }),
    /36 位 UUID/,
  );
  assert.throws(
    () => updateStoredConnectorConfig({}, { googleClientId: "not-an-id" }),
    /googleusercontent/,
  );
});

test("only an explicit clear flag removes the saved Google secret", () => {
  const next = updateStoredConnectorConfig(
    { googleClientSecret: "GOCSPX-existing-secret" },
    { clearGoogleClientSecret: true },
  );
  assert.equal(Object.hasOwn(next, "googleClientSecret"), false);
});

test("public connector state never exposes the Google secret", () => {
  const effective = resolveConnectorConfig(
    {
      googleClientId: "123456789012-abcdef.apps.googleusercontent.com",
      googleClientSecret: "GOCSPX-top-secret",
    },
    {},
    5555,
  );
  const publicState = toPublicConnectorConfig(effective, {});
  assert.equal(publicState.google.clientSecretConfigured, true);
  assert.equal(
    JSON.stringify(publicState).includes("GOCSPX-top-secret"),
    false,
  );
  assert.equal(Object.hasOwn(publicState.google, "clientSecret"), false);
});

test("environment overrides are validated instead of reported as ready", () => {
  assert.throws(
    () => resolveConnectorConfig({}, { MICROSOFT_CLIENT_ID: "placeholder" }),
    /36 位 UUID/,
  );
  assert.throws(
    () =>
      resolveConnectorConfig(
        {},
        { PUBLIC_BASE_URL: "http://mail.example.com" },
      ),
    /https/,
  );
});
