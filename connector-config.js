function normalizePublicBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new Error(
      "外部访问地址必须是完整网址，例如 https://mail.example.com",
    );
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error("外部访问地址只允许 http 或 https");
  if (parsed.username || parsed.password || parsed.search || parsed.hash)
    throw new Error("外部访问地址不能包含账号、密码、查询参数或锚点");
  if (parsed.pathname !== "/" && parsed.pathname !== "")
    throw new Error("外部访问地址不能包含路径");
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !local)
    throw new Error("公网域名必须使用 https");
  return parsed.origin;
}

function validateMicrosoftClientId(value) {
  const normalized = String(value || "").trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      normalized,
    )
  ) {
    throw new Error("Microsoft Client ID 格式不正确，应为 36 位 UUID");
  }
  return normalized;
}

function validateGoogleClientId(value) {
  const normalized = String(value || "").trim();
  if (!/^[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(normalized)) {
    throw new Error(
      "Google Client ID 格式不正确，应以 .apps.googleusercontent.com 结尾",
    );
  }
  return normalized;
}

function validateGoogleClientSecret(value) {
  const normalized = String(value || "").trim();
  if (
    normalized.length < 8 ||
    normalized.length > 512 ||
    /\s/.test(normalized)
  ) {
    throw new Error(
      "Google Client Secret 格式不正确，请完整复制且不要包含空格",
    );
  }
  return normalized;
}

function updateStoredConnectorConfig(current, input) {
  const next = { ...(current || {}) };
  if (
    typeof input.microsoftClientId === "string" &&
    input.microsoftClientId.trim()
  )
    next.microsoftClientId = validateMicrosoftClientId(input.microsoftClientId);
  if (input.clearMicrosoftClientId === true) delete next.microsoftClientId;
  if (typeof input.googleClientId === "string" && input.googleClientId.trim())
    next.googleClientId = validateGoogleClientId(input.googleClientId);
  if (input.clearGoogleClientId === true) delete next.googleClientId;
  if (
    typeof input.googleClientSecret === "string" &&
    input.googleClientSecret.trim()
  )
    next.googleClientSecret = validateGoogleClientSecret(
      input.googleClientSecret,
    );
  if (input.clearGoogleClientSecret === true) delete next.googleClientSecret;
  if (typeof input.publicBaseUrl === "string" && input.publicBaseUrl.trim())
    next.publicBaseUrl = normalizePublicBaseUrl(input.publicBaseUrl);
  return next;
}

function resolveConnectorConfig(saved = {}, env = {}, port = 5555) {
  const microsoftClientId =
    env.MICROSOFT_CLIENT_ID || saved.microsoftClientId || "";
  const googleClientId = env.GOOGLE_CLIENT_ID || saved.googleClientId || "";
  const googleClientSecret =
    env.GOOGLE_CLIENT_SECRET || saved.googleClientSecret || "";
  return {
    microsoftClientId: microsoftClientId
      ? validateMicrosoftClientId(microsoftClientId)
      : "",
    googleClientId: googleClientId
      ? validateGoogleClientId(googleClientId)
      : "",
    googleClientSecret: googleClientSecret
      ? validateGoogleClientSecret(googleClientSecret)
      : "",
    publicBaseUrl: normalizePublicBaseUrl(
      env.PUBLIC_BASE_URL || saved.publicBaseUrl || `http://localhost:${port}`,
    ),
  };
}

function toPublicConnectorConfig(effective, env = {}) {
  return {
    microsoft: {
      configured: !!effective.microsoftClientId,
      clientId: effective.microsoftClientId,
      managedByEnvironment: !!env.MICROSOFT_CLIENT_ID,
    },
    google: {
      clientIdConfigured: !!effective.googleClientId,
      clientId: effective.googleClientId,
      clientSecretConfigured: !!effective.googleClientSecret,
      clientIdManagedByEnvironment: !!env.GOOGLE_CLIENT_ID,
      clientSecretManagedByEnvironment: !!env.GOOGLE_CLIENT_SECRET,
    },
    publicBaseUrl: effective.publicBaseUrl,
    publicBaseUrlManagedByEnvironment: !!env.PUBLIC_BASE_URL,
    googleCallbackUrl: `${effective.publicBaseUrl}/auth/google/callback`,
  };
}

module.exports = {
  normalizePublicBaseUrl,
  validateMicrosoftClientId,
  validateGoogleClientId,
  validateGoogleClientSecret,
  updateStoredConnectorConfig,
  resolveConnectorConfig,
  toPublicConnectorConfig,
};
