const express = require("express");
const fs = require("fs");
const path = require("path");
const tls = require("tls");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const {
  CHANNELS,
  publicConfig,
  send,
  sendAll,
  messageFor,
} = require("./notifications");
const { Storage } = require("./storage");
const { loadOrCreateAdminToken } = require("./instance-config");
const {
  detectProvider,
  normalizeProvider,
  supportsOAuth,
  validateOAuthIdentity,
} = require("./providers");
const {
  resolveConnectorConfig,
  toPublicConnectorConfig,
  updateStoredConnectorConfig,
} = require("./connector-config");

const app = express();
const PORT = process.env.PORT || 5555;
const HOST = process.env.HOST || "127.0.0.1";
const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const adminCredential = loadOrCreateAdminToken(DATA_DIR);
const ADMIN_TOKEN = adminCredential.token;
if (adminCredential.created) {
  console.log("\n🔑 首次启动已生成管理口令（已持久保存）：");
  console.log(`   ${ADMIN_TOKEN}`);
  console.log("   忘记时运行：npm run credentials\n");
}

// InboxHarbor is deliberately local-first. Do not expose this service to a LAN.
app.use(express.json({ limit: "512kb" }));
app.use(express.urlencoded({ extended: true, limit: "512kb" }));
app.use("/api", (req, res, next) => {
  const supplied = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const left = Buffer.from(supplied);
  const right = Buffer.from(ADMIN_TOKEN);
  if (
    supplied &&
    left.length === right.length &&
    crypto.timingSafeEqual(left, right)
  )
    return next();
  res.status(401).json({ success: false, message: "请输入本机访问口令" });
});
app.use(express.static(path.join(__dirname, "public")));

const DATA_FILE = path.join(DATA_DIR, "data.json");
const storage = new Storage(DATA_DIR);

// Default Credentials & Telegram Defaults
let GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
let GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
let MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || "";
let PUBLIC_BASE_URL = `http://localhost:${PORT}`;

function applyConnectorConfig() {
  const effective = resolveConnectorConfig(
    gData.connectorConfig,
    process.env,
    PORT,
  );
  MICROSOFT_CLIENT_ID = effective.microsoftClientId;
  GOOGLE_CLIENT_ID = effective.googleClientId;
  GOOGLE_CLIENT_SECRET = effective.googleClientSecret;
  PUBLIC_BASE_URL = effective.publicBaseUrl;
}
function publicConnectorConfig() {
  return toPublicConnectorConfig(
    {
      microsoftClientId: MICROSOFT_CLIENT_ID,
      googleClientId: GOOGLE_CLIENT_ID,
      googleClientSecret: GOOGLE_CLIENT_SECRET,
      publicBaseUrl: PUBLIC_BASE_URL,
    },
    process.env,
  );
}

// Global In-Memory Deduplication Set for TELEGRAM PUSHES ONLY
const globalPushedFingerprints = new Set();
const googleOAuthTransactions = new Map();
const microsoftOAuthTransactions = new Map();

function pruneOAuthTransactions(now = Date.now()) {
  for (const [key, transaction] of googleOAuthTransactions) {
    if (transaction.expiresAt < now) googleOAuthTransactions.delete(key);
  }
  for (const [key, transaction] of microsoftOAuthTransactions) {
    if (transaction.expiresAt < now) microsoftOAuthTransactions.delete(key);
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// SINGLE SHARED IN-MEMORY DATA STORE (PREVENTS CONCURRENT OVERWRITES)
let gData = {
  accounts: [],
  mails: [],
  tgConfig: {
    token: "",
    chatId: "",
    enabled: false,
    autoPollInterval: 5,
  },
  notificationConfig: { includeFullBody: true, channels: [] },
  connectorConfig: {},
  pushedMailIds: [],
  clearedMailIds: [], // Track cleared mail IDs and fingerprints so they NEVER reappear!
};

async function pushConfiguredNotifications(mails) {
  if (!Array.isArray(mails) || mails.length === 0) return;
  for (const mail of mails) {
    // Telegram's legacy settings are kept only for migration. A new Telegram
    // channel owns delivery once configured, avoiding a double send.
    const hasNewTelegram = (gData.notificationConfig.channels || []).some(
      (c) => c.enabled && c.type === "telegram",
    );
    const config = hasNewTelegram
      ? {
          ...gData.notificationConfig,
          channels: gData.notificationConfig.channels.filter(
            (c) => c.type !== "telegram" || c.enabled,
          ),
        }
      : gData.notificationConfig;
    const results = await sendAll(config, mail);
    results.forEach((result, index) => {
      if (result.status === "rejected")
        console.warn(
          `Notification channel ${index + 1} failed: ${result.reason?.message || result.reason}`,
        );
    });
  }
}

function loadDataFromDisk() {
  try {
    const parsed = storage.load(gData, DATA_FILE);
    gData.accounts = parsed.accounts || [];
    gData.mails = parsed.mails || [];
    if (parsed.tgConfig) gData.tgConfig = parsed.tgConfig;
    if (parsed.notificationConfig)
      gData.notificationConfig = parsed.notificationConfig;
    if (parsed.connectorConfig) gData.connectorConfig = parsed.connectorConfig;
    applyConnectorConfig();
    gData.tgConfig.autoPollInterval = 1;
    gData.pushedMailIds = parsed.pushedMailIds || [];
    gData.clearedMailIds = parsed.clearedMailIds || [];

    gData.pushedMailIds.forEach((id) => globalPushedFingerprints.add(id));
    gData.clearedMailIds.forEach((id) => globalPushedFingerprints.add(id));

    gData.accounts.forEach((acc) => {
      acc.provider = normalizeProvider(acc.provider, acc.username);
      acc.readEnabled = acc.readEnabled !== false;
      acc.sendEnabled = acc.sendEnabled === true;
    });
    return gData;
  } catch (err) {
    throw new Error(`无法加载 InboxHarbor 加密存储：${err.message}`);
  }
}

function saveDataToDisk() {
  gData.pushedMailIds = Array.from(globalPushedFingerprints);
  storage.save(gData);
}

// Decode RFC 2047 MIME Header Strings (e.g. =?UTF-8?B?...?=)
function decodeMimeHeader(headerStr) {
  if (!headerStr) return "";
  try {
    return headerStr.replace(
      /=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi,
      (match, charset, encoding, text) => {
        if (encoding.toUpperCase() === "B") {
          return Buffer.from(text, "base64").toString("utf8");
        } else if (encoding.toUpperCase() === "Q") {
          return text.replace(/=([0-9A-F]{2})/gi, (m, hex) =>
            String.fromCharCode(parseInt(hex, 16)),
          );
        }
        return match;
      },
    );
  } catch (e) {
    return headerStr;
  }
}

// Recursively decode Gmail MIME Payload Body Parts
function getGmailBody(payload) {
  if (!payload) return "";
  let body = "";
  if (payload.body && payload.body.data) {
    try {
      body += Buffer.from(payload.body.data, "base64").toString("utf8") + "\n";
    } catch (e) {}
  }
  if (payload.parts && Array.isArray(payload.parts)) {
    for (let part of payload.parts) {
      if (part.body && part.body.data) {
        try {
          body += Buffer.from(part.body.data, "base64").toString("utf8") + "\n";
        } catch (e) {}
      }
      if (part.parts) {
        body += getGmailBody(part) + "\n";
      }
    }
  }
  return body;
}

// Proxy-aware Fetch for Google & Telegram APIs with Fast 1.5s Timeout
function fetchViaHttpProxy(targetUrl, options, proxyHost, proxyPort) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const req = http.request({
      host: proxyHost,
      port: proxyPort,
      method: "CONNECT",
      path: parsed.hostname + ":443",
    });

    req.on("connect", (res, socket) => {
      if (res.statusCode !== 200)
        return reject(new Error("Proxy status " + res.statusCode));

      const tlsSocket = tls.connect(
        { socket: socket, servername: parsed.hostname },
        () => {
          let reqPath = parsed.pathname + parsed.search;
          let method = options && options.method ? options.method : "GET";
          let headers = Object.assign(
            {
              Host: parsed.hostname,
              "User-Agent": "NodeMailManager/1.0",
              Connection: "close",
            },
            options && options.headers ? options.headers : {},
          );

          let bodyData = options && options.body ? options.body : "";
          if (bodyData && typeof bodyData === "string") {
            headers["Content-Length"] = Buffer.byteLength(bodyData);
          }

          const clientReq = https.request(
            {
              hostname: parsed.hostname,
              path: reqPath,
              method: method,
              headers: headers,
              createConnection: () => tlsSocket,
            },
            (resResp) => {
              let chunks = [];
              resResp.on("data", (chunk) => chunks.push(chunk));
              resResp.on("end", () => {
                const text = Buffer.concat(chunks).toString("utf8");
                let data = null;
                try {
                  data = JSON.parse(text);
                } catch (e) {
                  data = { text };
                }
                resolve({
                  ok: resResp.statusCode >= 200 && resResp.statusCode < 300,
                  status: resResp.statusCode,
                  json: async () => data,
                  text: async () => text,
                });
              });
            },
          );

          clientReq.on("error", (err) =>
            reject(new Error("clientReq err: " + err.message)),
          );
          if (bodyData) clientReq.write(bodyData);
          clientReq.end();
        },
      );

      tlsSocket.on("error", (err) =>
        reject(new Error("tlsSocket err: " + err.message)),
      );
    });

    req.on("error", (err) =>
      reject(new Error("proxy req err: " + err.message)),
    );
    req.setTimeout(1500, () => {
      req.destroy();
      reject(new Error("Proxy connection timeout"));
    });
    req.end();
  });
}

// Memory Cache for Last Known Working Proxy Port
let cachedWorkingProxyPort = null;

async function smartProxyFetch(url, options = {}) {
  const proxyPorts = [10809, 10808, 7890, 7891, 1080];

  // Try cached working proxy port FIRST for sub-second instant response
  if (cachedWorkingProxyPort) {
    try {
      const resp = await fetchViaHttpProxy(
        url,
        options,
        "127.0.0.1",
        cachedWorkingProxyPort,
      );
      if (resp && resp.status) {
        return resp;
      }
    } catch (err) {
      cachedWorkingProxyPort = null;
    }
  }

  // Iterate other ports with 1.5s fast timeout
  for (let port of proxyPorts) {
    try {
      const resp = await fetchViaHttpProxy(url, options, "127.0.0.1", port);
      if (resp && resp.status) {
        cachedWorkingProxyPort = port;
        return resp;
      }
    } catch (err) {}
  }

  // Fallback to direct fetch
  try {
    return await fetch(url, options);
  } catch (e) {
    await new Promise((r) => setTimeout(r, 100));
    return await fetch(url, options);
  }
}

// Clean invariant fingerprint including Message ID / Code to distinguish multiple verification codes in the same thread
function getMailFingerprint(mail) {
  if (!mail) return "";
  const accStr = (mail.account || "").toLowerCase().trim();
  const subjectStr = decodeMimeHeader(mail.subject || "")
    .trim()
    .toLowerCase();
  const senderStr = decodeMimeHeader(mail.sender || "")
    .toLowerCase()
    .trim();
  const mailId = (mail.id || "").trim();
  const codeStr =
    mail.code && mail.code !== "未发现验证码" ? mail.code.trim() : "";
  return `fp_${accStr}___${senderStr}___${subjectStr}___${codeStr}___${mailId}`;
}

// Strict Telegram Push Deduplication Fingerprint by Account + Code to prevent duplicate pushes of same code
function getMailPushFingerprint(mail) {
  if (!mail) return "";
  const accStr = (mail.account || "").toLowerCase().trim();
  const codeStr =
    mail.code && mail.code !== "未发现验证码" ? mail.code.trim() : "";
  const subjectStr = decodeMimeHeader(mail.subject || "")
    .trim()
    .toLowerCase()
    .replace(/【垃圾箱】/g, "");
  if (codeStr) {
    return `tg_push_${accStr}___${codeStr}`;
  }
  return `tg_push_${accStr}___${subjectStr}___${mail.id || ""}`;
}

// --- TELEGRAM BOT PUSH SYSTEM ---

async function sendTelegramMessage(text, customToken, customChatId) {
  const cfg = gData.tgConfig || {};
  const token = customToken || cfg.token || "";
  const chatId = customChatId || cfg.chatId || "";

  if (!token || !chatId) {
    return { ok: false, error: "Telegram Token 或 Chat ID 未配置" };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  // Try 1: Markdown mode
  const paramsMd = new URLSearchParams();
  paramsMd.append("chat_id", chatId);
  paramsMd.append("text", text);
  paramsMd.append("parse_mode", "Markdown");

  try {
    const resp = await smartProxyFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: paramsMd.toString(),
    });

    const resJson = await resp.json();
    if (resJson.ok) {
      return { ok: true };
    }

    // Try 2: Plain Text Fallback
    const plainText = text.replace(/[*_]/g, "");
    const paramsPlain = new URLSearchParams();
    paramsPlain.append("chat_id", chatId);
    paramsPlain.append("text", plainText);

    const respPlain = await smartProxyFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: paramsPlain.toString(),
    });
    const resPlain = await respPlain.json();
    if (resPlain.ok) {
      return { ok: true };
    } else {
      return {
        ok: false,
        error: resPlain.description || "Telegram 接口返回错误",
      };
    }
  } catch (err) {
    return { ok: false, error: `TG 网络异常: ${err.message}` };
  }
}

async function checkAndPushNewMailsToTelegram(newMails) {
  if (
    (gData.notificationConfig.channels || []).some(
      (channel) => channel.enabled && channel.type === "telegram",
    )
  )
    return;
  if (!gData.tgConfig || !gData.tgConfig.enabled) return;

  let pushCount = 0;
  const nowTime = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  for (let mail of newMails) {
    const pushFp = getMailPushFingerprint(mail);
    const rawId = mail.id || "";

    // Ignore old historical emails (older than 24h) for TG push
    const mailTime = mail.receivedAt
      ? new Date(mail.receivedAt).getTime()
      : nowTime;
    if (nowTime - mailTime > ONE_DAY_MS) {
      globalPushedFingerprints.add(pushFp);
      if (rawId) globalPushedFingerprints.add(rawId);
      continue;
    }

    // Strict Push Deduplication by Account + Code
    if (
      globalPushedFingerprints.has(pushFp) ||
      (rawId && globalPushedFingerprints.has(rawId))
    ) {
      continue;
    }

    // PRE-LOCK IMMEDIATELY BEFORE ASYNC NETWORK CALL TO PREVENT CONCURRENT DOUBLE PUSH
    globalPushedFingerprints.add(pushFp);
    if (rawId) globalPushedFingerprints.add(rawId);

    const providerTag =
      mail.provider === "google" ? "🔴 谷歌 Gmail" : "🔷 微软 Outlook";
    const hasCode = mail.code && mail.code !== "未发现验证码";
    const codeDisplay = hasCode
      ? `\`${mail.code}\`  *(点击数字复制)*`
      : "`未发现验证码`";

    let linkDisplay = "无";
    if (mail.links && mail.links.length > 0) {
      linkDisplay = mail.links
        .map((l, idx) => `[点击打开验证链接 ${idx + 1}](${l})`)
        .join("\n");
    }

    const cleanSubject = decodeMimeHeader(mail.subject || "无主题").replace(
      /[*_`]/g,
      "",
    );
    const cleanSender = decodeMimeHeader(mail.sender || "System").replace(
      /[*_`]/g,
      "",
    );
    const cleanAccount = (mail.account || "").replace(/[*_`]/g, "");

    // Template 1
    const msg =
      `🔑 *验证码*： ${codeDisplay}\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `👤 *接收账号*: \`${cleanAccount}\` (${providerTag})\n` +
      `📩 *发 件 人*: \`${cleanSender}\` \n` +
      `📋 *邮件主题*: *${cleanSubject}*\n` +
      `⏰ *接收时间*: ${new Date(mail.receivedAt).toLocaleString()}\n` +
      `🔗 *快捷链接*: ${linkDisplay}`;

    const res = await sendTelegramMessage(msg);
    if (res.ok) {
      pushCount++;
    } else {
      // Revert lock if sending failed completely
      globalPushedFingerprints.delete(pushFp);
      if (rawId) globalPushedFingerprints.delete(rawId);
    }
  }

  saveDataToDisk();
  if (pushCount > 0)
    console.log(`🎉 成功推送到 Telegram ${pushCount} 封最新模板一邮件！`);
}

function parseCredentials(acc) {
  let clientId = GOOGLE_CLIENT_ID;
  let clientSecret = GOOGLE_CLIENT_SECRET;
  let refreshToken = "";

  if (acc.provider === "microsoft") {
    clientId = MICROSOFT_CLIENT_ID;
    clientSecret = "";
  }

  if (acc.note) {
    const parts = acc.note.split("----");
    if (parts.length >= 3) {
      clientId = parts[0].trim();
      clientSecret = parts[1].trim();
      refreshToken = parts.slice(2).join("----").trim();
    } else if (parts.length === 2 && parts[0].includes("-")) {
      clientId = parts[0].trim();
      refreshToken = parts[1].trim();
    } else if (acc.note.startsWith("M.")) {
      refreshToken = acc.note.trim();
    } else {
      refreshToken = parts[0].trim();
    }
  }

  return { clientId, clientSecret, refreshToken };
}

// Verify Microsoft Account with 1-hour Token Memory Cache
async function verifyMicrosoftAccount(acc) {
  if (
    acc._cachedToken &&
    acc._cachedExpiresAt &&
    Date.now() < acc._cachedExpiresAt
  ) {
    return { status: "active", accessToken: acc._cachedToken, error: null };
  }

  const { clientId, refreshToken } = parseCredentials(acc);

  if (!refreshToken) {
    return {
      status: "invalid",
      error: "请点击右侧【授权】连接微软账号",
      accessToken: null,
    };
  }

  try {
    const params = new URLSearchParams();
    params.append("client_id", clientId);
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", refreshToken);
    params.append(
      "scope",
      `openid profile email https://graph.microsoft.com/Mail.Read${acc.sendEnabled ? " https://graph.microsoft.com/Mail.Send" : ""} offline_access`,
    );

    const resp = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      },
    );

    const data = await resp.json();

    if (resp.ok && data.access_token) {
      acc._cachedToken = data.access_token;
      acc._cachedExpiresAt =
        Date.now() +
        (data.expires_in ? (data.expires_in - 120) * 1000 : 3400 * 1000);
      if (data.refresh_token) acc.note = data.refresh_token;
      if (data.scope) acc.providerScopes = data.scope;
      saveDataToDisk();
      return {
        status: "active",
        accessToken: data.access_token,
        newRefreshToken: data.refresh_token || refreshToken,
        error: null,
      };
    } else {
      return {
        status: "invalid",
        error:
          data.error_description ||
          data.error ||
          "Token 被撤销，请重新点击【授权】",
        accessToken: null,
      };
    }
  } catch (err) {
    return {
      status: "invalid",
      error: `网络通信异常: ${err.message}`,
      accessToken: null,
    };
  }
}

// Verify Google Gmail Account with 1-hour Token Memory Cache
async function verifyGoogleAccount(acc) {
  if (acc.isMock) {
    return {
      status: "active",
      accessToken: "mock_gmail_access_token",
      error: null,
    };
  }

  if (
    acc._cachedToken &&
    acc._cachedExpiresAt &&
    Date.now() < acc._cachedExpiresAt
  ) {
    return { status: "active", accessToken: acc._cachedToken, error: null };
  }

  const { clientId, clientSecret, refreshToken } = parseCredentials(acc);

  if (refreshToken) {
    try {
      const params = new URLSearchParams();
      params.append("client_id", clientId || GOOGLE_CLIENT_ID);
      if (clientSecret || GOOGLE_CLIENT_SECRET) {
        params.append("client_secret", clientSecret || GOOGLE_CLIENT_SECRET);
      }
      params.append("refresh_token", refreshToken);
      params.append("grant_type", "refresh_token");

      const resp = await smartProxyFetch(
        "https://oauth2.googleapis.com/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        },
      );

      const data = await resp.json();
      if (resp.ok && data.access_token) {
        if (data.scope) acc.providerScopes = data.scope;
        acc._cachedToken = data.access_token;
        acc._cachedExpiresAt =
          Date.now() +
          (data.expires_in ? (data.expires_in - 120) * 1000 : 3400 * 1000);
        return {
          status: "active",
          accessToken: data.access_token,
          error: null,
        };
      }
    } catch (err) {}
  }

  return {
    status: "invalid",
    error: "请点击右侧【授权】连接谷歌账号",
    accessToken: null,
  };
}

// Smart Code & Link Extraction with matchAll iterator
function extractCodeAndLinks(subject, bodyText, rawContent) {
  const combined =
    (subject || "") + " \n " + (bodyText || "") + " \n " + (rawContent || "");
  let code = null;
  let codeType = "";

  const stopWords = new Set([
    "for",
    "the",
    "with",
    "your",
    "from",
    "have",
    "this",
    "that",
    "here",
    "ready",
    "next",
    "stay",
    "cool",
    "launch",
    "updates",
  ]);

  // Global iterator to avoid subject header false positive match traps
  const contextMatches = [
    ...combined.matchAll(
      /(?:验证码|动态码|安全码|安全代码|PIN|OTP|code|verify|verification)[:：\s]*([A-Z0-9]{4,8})\b/gi,
    ),
  ];
  for (let match of contextMatches) {
    if (match && match[1]) {
      const val = match[1].trim();
      if (!stopWords.has(val.toLowerCase()) && !/^[a-zA-Z]+$/.test(val)) {
        code = val;
        codeType = "智能识别码";
        break;
      }
    }
  }

  if (!code) {
    const match6 = combined.match(/\b(\d{6})\b/);
    if (match6) {
      code = match6[1];
      codeType = "6位数字码";
    }
  }

  if (!code) {
    const matchFlex = combined.match(/\b(\d{4,8})\b/);
    if (matchFlex) {
      code = matchFlex[1];
      codeType = `${code.length}位数字码`;
    }
  }

  if (!code) {
    const matchAlpha = combined.match(/\b([A-Z0-9]{3,4}[- ][A-Z0-9]{3,4})\b/i);
    if (matchAlpha && !matchAlpha[1].toLowerCase().includes("http")) {
      code = matchAlpha[1];
      codeType = "字母数字混合码";
    }
  }

  const linkRegex =
    /(https?:\/\/[^\s"'<>]+?(?:verify|confirm|activate|login|auth|token|reset|action|click)[^\s"'<>]*)/gi;
  const rawLinks = combined.match(linkRegex) || [];
  const uniqueLinks = [...new Set(rawLinks)].slice(0, 3);

  return {
    code: code || "未发现验证码",
    codeType: code ? codeType : "",
    links: uniqueLinks,
  };
}

async function fetchMicrosoftMails(acc, accessToken) {
  const mails = [];
  try {
    const resp = await fetch(
      "https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,body,bodyPreview,from,receivedDateTime",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (resp.ok) {
      const data = await resp.json();
      for (let item of data.value || []) {
        const rawContent = item.body?.content || "";
        const cleanBody = rawContent.replace(/<[^>]*>?/gm, "").trim();
        const cleanSubject = decodeMimeHeader(item.subject || "无主题");
        const cleanSender = decodeMimeHeader(
          item.from?.emailAddress?.address || "System",
        );
        const extracted = extractCodeAndLinks(
          cleanSubject,
          cleanBody,
          rawContent,
        );

        mails.push({
          id: "mail_" + item.id,
          account: acc.username,
          provider: "microsoft",
          sender: cleanSender,
          subject: cleanSubject,
          content: cleanBody || "无正文内容",
          preview: item.bodyPreview || cleanBody.substr(0, 100),
          code: extracted.code,
          codeType: extracted.codeType,
          links: extracted.links,
          receivedAt: item.receivedDateTime || new Date().toISOString(),
        });
      }
    }
  } catch (e) {}
  return mails;
}

async function fetchGoogleMails(acc, accessToken) {
  if (acc.isMock) {
    const mockCode = Math.floor(100000 + Math.random() * 900000).toString();
    const mockLink = `https://accounts.google.com/verify?token=${mockCode}&user=${acc.username}`;
    const extracted = extractCodeAndLinks(
      "【Google 安全验证】您的验证码是 " + mockCode,
      "您的 Gmail 安全验证码为: " + mockCode + "\n请点击激活链接: " + mockLink,
      mockLink,
    );

    return [
      {
        id: "mail_gmail_mock_" + Date.now(),
        account: acc.username,
        provider: "google",
        sender: "no-reply@accounts.google.com",
        subject: "【Google 验证码】您的登录验证码是 " + mockCode,
        content: `您好！正在登录 Google 账号。\n您的验证码为：${mockCode}\n请点击下方安全验证链接确认：\n${mockLink}`,
        preview: `您的 Gmail 安全验证码为: ${mockCode}`,
        code: extracted.code,
        codeType: extracted.codeType,
        links: extracted.links,
        receivedAt: new Date().toISOString(),
      },
    ];
  }

  if (accessToken) {
    const mails = [];
    try {
      const queryUrl =
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=15&q=" +
        encodeURIComponent("in:inbox OR in:spam");
      const listResp = await smartProxyFetch(queryUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (listResp && listResp.ok) {
        const listData = await listResp.json();
        for (let msg of listData.messages || []) {
          const detailResp = await smartProxyFetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
            },
          );

          if (detailResp && detailResp.ok) {
            const item = await detailResp.json();
            const headers = item.payload?.headers || [];
            const rawSubject =
              headers.find((h) => h.name.toLowerCase() === "subject")?.value ||
              "";
            const rawFrom =
              headers.find((h) => h.name.toLowerCase() === "from")?.value || "";
            const dateHeader = headers.find(
              (h) => h.name.toLowerCase() === "date",
            );
            const snippet = item.snippet || "";

            // Decode Full Payload Body HTML/Text
            const fullPayloadBody = getGmailBody(item.payload);
            const cleanBody = fullPayloadBody
              ? fullPayloadBody.replace(/<[^>]*>?/gm, "").trim()
              : snippet;

            const cleanSubject = decodeMimeHeader(rawSubject) || "无主题";
            const cleanSender = decodeMimeHeader(rawFrom) || "Google System";

            const isSpam = item.labelIds && item.labelIds.includes("SPAM");
            const prefix = isSpam ? "【垃圾箱】" : "";

            // Run extractCodeAndLinks on full body content + subject + snippet
            const extracted = extractCodeAndLinks(
              cleanSubject,
              cleanBody,
              snippet,
            );

            let validTime = new Date().toISOString();
            if (dateHeader && dateHeader.value) {
              const d = new Date(dateHeader.value);
              if (!isNaN(d.getTime())) validTime = d.toISOString();
            }

            mails.push({
              id: "mail_gmail_" + item.id,
              account: acc.username,
              provider: "google",
              sender: cleanSender,
              subject: prefix + cleanSubject,
              content: cleanBody || snippet || "无正文内容",
              preview: snippet.substr(0, 100),
              code: extracted.code,
              codeType: extracted.codeType,
              links: extracted.links,
              receivedAt: validTime,
            });
          }
        }
      }
      return mails;
    } catch (e) {
      // Silent auto-recovery
    }
  }

  return [];
}

async function sendMicrosoftMail(accessToken, targetEmail, testCode, testLink) {
  const mailPayload = {
    message: {
      subject: `【测试验证码】您的登录验证码是 ${testCode}`,
      body: {
        contentType: "Text",
        content: `尊敬的用户：\n\n您正在发起本地测试校验，您的 6 位数字验证码为：${testCode}\n\n如果您需要完成账号激活或验证，请点击下方测试确认链接：\n${testLink}\n\n该验证码有效期为 10 分钟。`,
      },
      toRecipients: [
        {
          emailAddress: {
            address: targetEmail,
          },
        },
      ],
    },
  };

  const resp = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(mailPayload),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("Microsoft sendMail API error status:", resp.status, errText);
    return {
      ok: false,
      error: `微软返回 HTTP ${resp.status} (若无写权限请点击该账号【授权】刷新权限)`,
    };
  }

  return { ok: true };
}

async function sendGoogleMail(accessToken, targetEmail, testCode, testLink) {
  const subject = `【测试验证码】您的登录验证码是 ${testCode}`;
  const content = `您好！\r\n\r\n您的 6 位数字验证码为：${testCode}\r\n\r\n测试确认链接：${testLink}`;
  const raw = Buffer.from(
    `To: ${targetEmail}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${content}`,
  ).toString("base64url");
  const resp = await smartProxyFetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    },
  );
  if (!resp.ok) return { ok: false, error: `Gmail 返回 HTTP ${resp.status}` };
  return { ok: true };
}

function parseImportText(text) {
  const lines = text.split(/\r?\n/);
  const accounts = [];

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    let parts = line.includes("----")
      ? line.split("----")
      : line.includes(",")
        ? line.split(",")
        : [line];
    const username = parts[0] ? parts[0].trim() : "";

    if (username) {
      accounts.push({
        id: "acc_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
        username: username,
        password: "",
        note: "",
        provider: detectProvider(username),
        status: "pending",
        lastChecked: new Date().toISOString(),
        mailCount: 0,
        createdAt: new Date().toISOString(),
        readEnabled: true,
        sendEnabled: false,
      });
    }
  }
  return accounts;
}

// --- MICROSOFT OFFICIAL DEVICE CODE FLOW ---

app.post("/api/auth/microsoft/device-code", async (req, res) => {
  pruneOAuthTransactions();
  if (!MICROSOFT_CLIENT_ID)
    return res.status(503).json({
      success: false,
      message: "未配置 MICROSOFT_CLIENT_ID，无法发起 Microsoft OAuth。",
    });
  const requested = gData.accounts.find((a) => a.id === req.body.accountId);
  if (!requested)
    return res.status(404).json({ success: false, message: "账号不存在" });
  if (requested.provider !== "microsoft")
    return res.status(400).json({
      success: false,
      message: "该账号未选择 Microsoft OAuth 连接器。",
    });
  const clientId = MICROSOFT_CLIENT_ID;
  const params = new URLSearchParams();
  params.append("client_id", clientId);
  params.append(
    "scope",
    `openid profile email https://graph.microsoft.com/Mail.Read${requested && requested.sendEnabled ? " https://graph.microsoft.com/Mail.Send" : ""} offline_access`,
  );

  try {
    const resp = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/devicecode",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      },
    );

    const data = await resp.json();
    if (resp.ok && data.user_code && data.device_code) {
      microsoftOAuthTransactions.set(data.device_code, {
        accountId: requested.id,
        clientId,
        expiresAt: Date.now() + Number(data.expires_in || 600) * 1000,
      });
      res.json({
        success: true,
        userCode: data.user_code,
        deviceCode: data.device_code,
        verificationUri:
          data.verification_uri || "https://microsoft.com/devicelogin",
        expiresIn: data.expires_in,
      });
    } else {
      res.status(400).json({
        success: false,
        message: data.error_description || "发起微软设备码失败",
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/auth/microsoft/poll-device-token", async (req, res) => {
  pruneOAuthTransactions();
  const { deviceCode } = req.body;
  if (!deviceCode)
    return res.status(400).json({ success: false, message: "缺失 deviceCode" });
  const transaction = microsoftOAuthTransactions.get(deviceCode);
  if (!transaction)
    return res.status(400).json({
      success: false,
      message: "Microsoft 授权事务不存在或已经结束。",
    });
  if (transaction.expiresAt < Date.now()) {
    microsoftOAuthTransactions.delete(deviceCode);
    return res
      .status(400)
      .json({ success: false, message: "Microsoft 授权事务已过期。" });
  }
  const targetAcc = gData.accounts.find(
    (account) => account.id === transaction.accountId,
  );
  if (!targetAcc || targetAcc.provider !== "microsoft") {
    microsoftOAuthTransactions.delete(deviceCode);
    return res.status(409).json({
      success: false,
      message: "原 Microsoft 账户不存在或连接器已改变。",
    });
  }

  if (!transaction.clientId)
    return res
      .status(503)
      .json({ success: false, message: "未配置 MICROSOFT_CLIENT_ID。" });
  const clientId = transaction.clientId;
  const params = new URLSearchParams();
  params.append("grant_type", "urn:ietf:params:oauth:grant-type:device_code");
  params.append("client_id", clientId);
  params.append("device_code", deviceCode);

  try {
    const resp = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        signal: AbortSignal.timeout(15000),
      },
    );

    const tokenData = await resp.json();

    if (resp.ok && (tokenData.access_token || tokenData.refresh_token)) {
      let userEmail = "";

      // Try 1: Parse ID Token JWT Payload (preferred_username)
      if (tokenData.id_token) {
        try {
          const parts = tokenData.id_token.split(".");
          const payload = JSON.parse(
            Buffer.from(parts[1], "base64").toString("utf8"),
          );
          if (payload.preferred_username)
            userEmail = payload.preferred_username;
          else if (payload.email) userEmail = payload.email;
          else if (payload.upn) userEmail = payload.upn;
        } catch (e) {}
      }

      // Try 2: Fetch /v1.0/me API
      if (!userEmail) {
        try {
          const userResp = await fetch("https://graph.microsoft.com/v1.0/me", {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
          });
          const userData = await userResp.json();
          if (userData.userPrincipalName)
            userEmail = userData.userPrincipalName;
          else if (userData.mail) userEmail = userData.mail;
        } catch (e) {}
      }

      const identity = validateOAuthIdentity(
        gData.accounts,
        targetAcc,
        userEmail,
      );
      if (!identity.ok) {
        microsoftOAuthTransactions.delete(deviceCode);
        return res
          .status(409)
          .json({ success: false, status: "failed", error: identity.reason });
      }

      const refreshToken = tokenData.refresh_token || "";

      targetAcc.username = identity.identity;
      targetAcc.status = "active";
      targetAcc.note = refreshToken;
      targetAcc.providerScopes =
        tokenData.scope || targetAcc.providerScopes || "";
      targetAcc.lastChecked = new Date().toISOString();

      microsoftOAuthTransactions.delete(deviceCode);
      saveDataToDisk();
      res.json({
        success: true,
        status: "completed",
        account: publicAccount(targetAcc),
      });
    } else {
      if (tokenData.error === "authorization_pending") {
        res.json({ success: true, status: "pending" });
      } else {
        microsoftOAuthTransactions.delete(deviceCode);
        res.json({
          success: false,
          status: "failed",
          error: tokenData.error_description || tokenData.error,
        });
      }
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- GOOGLE OAUTH BROWSER FLOW ---

app.get("/api/auth/google/url", (req, res) => {
  pruneOAuthTransactions();
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET)
    return res.status(503).json({
      success: false,
      message:
        "未配置 GOOGLE_CLIENT_ID 或 GOOGLE_CLIENT_SECRET，无法发起 Google OAuth。",
    });
  const accountId = String(req.query.id || "");
  const account = gData.accounts.find((item) => item.id === accountId);
  if (!account)
    return res.status(404).json({ success: false, message: "账号不存在" });
  if (account.provider !== "google")
    return res
      .status(400)
      .json({ success: false, message: "该账号未选择 Google OAuth 连接器。" });
  const state = crypto.randomBytes(24).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  const scope = `https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email${account.sendEnabled ? " https://www.googleapis.com/auth/gmail.send" : ""}`;
  const redirectUri = `${PUBLIC_BASE_URL}/auth/google/callback`;
  googleOAuthTransactions.set(state, {
    accountId,
    verifier,
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256&state=${encodeURIComponent(state)}`;
  res.json({ success: true, url });
});

app.get("/auth/google/login", (req, res) => {
  res.status(410).json({
    success: false,
    message: "此入口已弃用，请通过受保护的 /api/auth/google/url 创建授权链接。",
  });
});

app.get("/auth/google/callback", async (req, res) => {
  const { code, state, error } = req.query;
  const transaction = googleOAuthTransactions.get(state);
  googleOAuthTransactions.delete(state);
  if (!transaction || transaction.expiresAt < Date.now())
    return res
      .status(400)
      .send("授权会话已过期，请回到 InboxHarbor 重新发起授权。");

  if (error || !code) {
    return res.send(`
      <div style="font-family: sans-serif; text-align: center; padding: 50px; background: #0f172a; color: #ef4444;">
        <h2>❌ 谷歌登录授权取消或失败</h2>
        <p>${escapeHtml(error || "未接收到 Authorization Code")}</p>
        <button onclick="window.close()" style="padding: 10px 20px; background: #334155; color: #fff; border: none; border-radius: 6px; cursor: pointer;">关闭窗口</button>
      </div>
    `);
  }

  try {
    const params = new URLSearchParams();
    params.append("code", code);
    params.append("client_id", transaction.clientId);
    params.append("client_secret", transaction.clientSecret);
    params.append("redirect_uri", transaction.redirectUri);
    params.append("grant_type", "authorization_code");
    params.append("code_verifier", transaction.verifier);

    const tokenResp = await smartProxyFetch(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      },
    );

    const tokenData = await tokenResp.json();

    if (tokenResp.ok && (tokenData.access_token || tokenData.refresh_token)) {
      let userEmail = "";
      try {
        const userResp = await smartProxyFetch(
          "https://www.googleapis.com/oauth2/v2/userinfo",
          {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
          },
        );
        const userData = await userResp.json();
        if (userData.email) userEmail = userData.email;
      } catch (e) {}

      const targetAcc = gData.accounts.find(
        (a) => a.id === transaction.accountId,
      );
      if (!targetAcc || targetAcc.provider !== "google") {
        return res
          .status(409)
          .send(
            "原 Google 账户已不存在或服务商已变更，请回到 InboxHarbor 重新添加并授权。",
          );
      }

      const identity = validateOAuthIdentity(
        gData.accounts,
        targetAcc,
        userEmail,
      );
      if (!identity.ok)
        return res.status(409).send(escapeHtml(identity.reason));

      const refreshToken =
        tokenData.refresh_token || parseCredentials(targetAcc).refreshToken;
      targetAcc.username = identity.identity;
      targetAcc.status = "active";
      targetAcc.note = refreshToken;
      targetAcc.providerScopes =
        tokenData.scope || targetAcc.providerScopes || "";
      targetAcc.lastChecked = new Date().toISOString();

      saveDataToDisk();

      res.send(`
        <div style="font-family: sans-serif; text-align: center; padding: 50px; background: #0f172a; color: #10b981;">
          <h2>🎉 谷歌 OAuth2 授权成功！</h2>
          <p style="color: #cbd5e1;">已获取 Refresh Token 并成功绑定账号: <strong>${escapeHtml(userEmail)}</strong></p>
          <script>
            if (window.opener) {
              window.opener.location.reload();
              setTimeout(() => window.close(), 1500);
            } else {
              setTimeout(() => { window.location.href = '/'; }, 2000);
            }
          </script>
        </div>
      `);
    } else {
      res.send(`
        <div style="font-family: sans-serif; text-align: center; padding: 50px; background: #0f172a; color: #ef4444;">
          <h2>❌ 令牌兑换失败</h2>
          <p>${escapeHtml(tokenData.error_description || tokenData.error || "无法由 Authorization Code 换取 Token")}</p>
        </div>
      `);
    }
  } catch (err) {
    res.send(
      `<div style="font-family: sans-serif; text-align: center; padding: 50px; background: #0f172a; color: #ef4444;"><h2>❌ 网络请求失败</h2><p>${escapeHtml(err.message)}</p></div>`,
    );
  }
});

// --- REST API ENDPOINTS ---

function publicAccount(account) {
  const {
    password,
    note,
    accessToken,
    refreshToken,
    token,
    _cachedToken,
    _cachedExpiresAt,
    ...safe
  } = account;
  return safe;
}

app.get("/api/tg/config", (req, res) => {
  res.json({
    success: true,
    tgConfig: {
      enabled: !!gData.tgConfig.enabled,
      autoPollInterval: gData.tgConfig.autoPollInterval,
      configured: {
        token: !!gData.tgConfig.token,
        chatId: !!gData.tgConfig.chatId,
      },
    },
  });
});

app.post("/api/tg/config", (req, res) => {
  const { token, chatId, enabled, autoPollInterval } = req.body;
  gData.tgConfig = {
    token: token !== undefined ? token : gData.tgConfig.token,
    chatId: chatId !== undefined ? chatId : gData.tgConfig.chatId,
    enabled: enabled !== undefined ? enabled : gData.tgConfig.enabled,
    autoPollInterval: autoPollInterval ? parseInt(autoPollInterval) : 1,
  };
  saveDataToDisk();
  res.json({
    success: true,
    tgConfig: {
      enabled: !!gData.tgConfig.enabled,
      autoPollInterval: gData.tgConfig.autoPollInterval,
      configured: {
        token: !!gData.tgConfig.token,
        chatId: !!gData.tgConfig.chatId,
      },
    },
  });
});

app.post("/api/tg/test", async (req, res) => {
  const { token, chatId } = req.body;
  const msg =
    `🔑 *验证码*： \`742651\`  *(点击数字复制)*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👤 *接收账号*: \`demo_user@gmail.com\` (🔴 谷歌 Gmail)\n` +
    `📩 *发 件 人*: \`Microsoft 帐户团队\`\n` +
    `📋 *邮件主题*: *个人 Microsoft 帐户安全代码*\n` +
    `⏰ *接收时间*: ${new Date().toLocaleString()}\n` +
    `🔗 *快捷链接*: 无`;

  const result = await sendTelegramMessage(msg, token, chatId);
  if (result.ok) {
    res.json({ success: true, message: "测试消息已成功发送至您的 Telegram！" });
  } else {
    res.status(400).json({ success: false, message: result.error });
  }
});

app.get("/api/stats", (req, res) => {
  const msCount = gData.accounts.filter(
    (a) => (a.provider || detectProvider(a.username)) === "microsoft",
  ).length;
  const ggCount = gData.accounts.filter(
    (a) => (a.provider || detectProvider(a.username)) === "google",
  ).length;

  res.json({
    totalAccounts: gData.accounts.length,
    activeAccounts: gData.accounts.filter((a) => a.status === "active").length,
    invalidAccounts: gData.accounts.filter((a) => a.status === "invalid")
      .length,
    microsoftAccounts: msCount,
    googleAccounts: ggCount,
    totalMails: gData.mails.length,
    totalCodes: gData.mails.filter((m) => m.code && m.code !== "未发现验证码")
      .length,
  });
});

app.get("/api/accounts", (req, res) => {
  const accounts = gData.accounts.map(publicAccount);
  res.json({ success: true, accounts });
});

app.put("/api/accounts/:id/permissions", (req, res) => {
  const account = gData.accounts.find((a) => a.id === req.params.id);
  if (!account)
    return res.status(404).json({ success: false, message: "账号不存在" });
  if (typeof req.body.readEnabled === "boolean")
    account.readEnabled = req.body.readEnabled;
  if (typeof req.body.sendEnabled === "boolean")
    account.sendEnabled = req.body.sendEnabled;
  saveDataToDisk();
  res.json({
    success: true,
    account: publicAccount(account),
    message: "权限已保存；变更发信权限后请重新授权。",
  });
});

app.get("/api/v1/notifications", (req, res) => {
  res.json({
    success: true,
    catalog: CHANNELS,
    configuration: publicConfig(gData.notificationConfig),
  });
});

app.get("/api/v1/connectors", (req, res) =>
  res.json({ success: true, configuration: publicConnectorConfig() }),
);
app.put("/api/v1/connectors", (req, res) => {
  try {
    const previous = gData.connectorConfig;
    const candidate = updateStoredConnectorConfig(
      gData.connectorConfig,
      req.body || {},
    );
    resolveConnectorConfig(candidate, process.env, PORT);
    gData.connectorConfig = candidate;
    try {
      saveDataToDisk();
    } catch (error) {
      gData.connectorConfig = previous;
      throw error;
    }
    applyConnectorConfig();
    res.json({ success: true, configuration: publicConnectorConfig() });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.post("/api/v1/connectors/check", (req, res) => {
  const configuration = publicConnectorConfig();
  const results = {
    microsoft: {
      ready: configuration.microsoft.configured,
      message: configuration.microsoft.configured
        ? "本地格式检查通过，可以逐个授权 Microsoft 邮箱。"
        : "请填写 Microsoft Client ID。",
    },
    google: {
      ready:
        configuration.google.clientIdConfigured &&
        configuration.google.clientSecretConfigured,
      message:
        configuration.google.clientIdConfigured &&
        configuration.google.clientSecretConfigured
          ? `本地格式检查通过。请确认 Google 控制台回调地址为 ${configuration.googleCallbackUrl}`
          : "请同时填写 Google Client ID 与 Client Secret。",
    },
  };
  res.json({
    success: true,
    ready: results.microsoft.ready || results.google.ready,
    results,
    configuration,
  });
});

app.put("/api/v1/notifications", (req, res) => {
  try {
    const incoming = Array.isArray(req.body.channels) ? req.body.channels : [];
    const previous = Array.isArray(gData.notificationConfig.channels)
      ? gData.notificationConfig.channels
      : [];
    const channels = incoming.map((channel, index) => {
      if (!CHANNELS[channel.type])
        throw new Error(`未知通知渠道: ${channel.type}`);
      const old = previous.find(
        (item) => item.id === channel.id || item.type === channel.type,
      );
      return {
        id: old?.id || channel.id || `${channel.type}_${Date.now()}_${index}`,
        type: channel.type,
        enabled: channel.enabled === true,
        config: { ...(old?.config || {}), ...(channel.config || {}) },
      };
    });
    gData.notificationConfig = {
      includeFullBody: req.body.includeFullBody !== false,
      channels,
    };
    saveDataToDisk();
    res.json({
      success: true,
      configuration: publicConfig(gData.notificationConfig),
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.post("/api/v1/notifications/:type/test", async (req, res) => {
  const type = req.params.type;
  if (!CHANNELS[type])
    return res.status(404).json({ success: false, message: "通知渠道不存在" });
  const saved = (gData.notificationConfig.channels || []).find(
    (item) => item.type === type,
  );
  const channel = {
    type,
    config: { ...(saved?.config || {}), ...(req.body.config || {}) },
  };
  try {
    await send(
      channel,
      messageFor({
        subject: "InboxHarbor 通知测试",
        account: "local@inboxharbor.app",
        sender: "InboxHarbor",
        content: "渠道连接正常。之后的新邮件可按当前设置发送完整正文。",
      }),
    );
    res.json({ success: true, message: `${CHANNELS[type].name} 测试成功` });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Single Account & Verification Code Fast Lookup API
app.get("/api/accounts/lookup", (req, res) => {
  const query = (req.query.username || req.query.email || "")
    .toLowerCase()
    .trim();
  if (!query)
    return res
      .status(400)
      .json({ success: false, message: "缺失 username 参数" });

  let acc = gData.accounts.find(
    (a) =>
      a.username.toLowerCase().trim() === query ||
      a.username.toLowerCase().split("@")[0] === query,
  );

  if (!acc) {
    return res.json({
      success: true,
      found: false,
      message: "数据库中未找到该账号",
    });
  }

  const clearedSet = new Set(gData.clearedMailIds || []);
  const latestMail = gData.mails.find((m) => {
    if (!m || !m.code || m.code === "未发现验证码" || m.code === "707070")
      return false;
    if (clearedSet.has(m.id) || clearedSet.has(m.code)) return false;

    const accName = (m.account || "").toLowerCase().trim();
    return accName === acc.username.toLowerCase().trim() || accName === query;
  });

  res.json({
    success: true,
    found: true,
    account: {
      id: acc.id,
      username: acc.username,
      provider: acc.provider,
      status: acc.status,
    },
    latestCode: latestMail
      ? {
          code: latestMail.code,
          codeType: latestMail.codeType,
          receivedAt: latestMail.receivedAt,
          links: latestMail.links || [],
        }
      : null,
  });
});

app.get("/api/export-ms-txt", (req, res) => {
  res.status(410).json({
    success: false,
    message: "为保护本机凭据，明文账号密码导出已移除。",
  });
});

// Import Accounts Endpoint with Smart Upsert (Updates existing accounts if username matches)
app.post("/api/accounts/import", (req, res) => {
  res.status(410).json({
    success: false,
    message:
      "旧导入接口已停用，请在邮箱账户页批量添加，并明确选择 Google 或 Microsoft。",
  });
});

app.post("/api/accounts/add-outlook-tool", (req, res) =>
  res.status(410).json({
    success: false,
    message:
      "旧添加接口已停用，请使用 /api/accounts/add 并明确选择 Microsoft。",
  }),
);

app.post("/api/accounts/add", (req, res) => {
  const username = String(req.body.username || "")
    .trim()
    .toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(username))
    return res
      .status(400)
      .json({ success: false, message: "请输入有效邮箱地址" });
  const existing = gData.accounts.find(
    (item) => item.username.toLowerCase() === username,
  );
  if (existing)
    return res.json({
      success: true,
      account: publicAccount(existing),
      existing: true,
    });
  const requestedProvider = String(req.body.provider || "");
  const provider = requestedProvider
    ? normalizeProvider(requestedProvider, username)
    : detectProvider(username);
  if (!supportsOAuth(provider))
    return res.status(400).json({
      success: false,
      message: "当前版本仅支持 Google 与 Microsoft 邮箱。",
    });
  const account = {
    id: `acc_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    username,
    provider,
    status: "pending",
    readEnabled: true,
    sendEnabled: false,
    mailCount: 0,
    lastChecked: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    password: "",
    note: "",
  };
  gData.accounts.unshift(account);
  saveDataToDisk();
  res.json({ success: true, account: publicAccount(account) });
});

app.post("/api/accounts/add-gmail-tool", (req, res) =>
  res.status(410).json({
    success: false,
    message: "旧添加接口已停用，请使用 /api/accounts/add 并明确选择 Google。",
  }),
);

app.post("/api/accounts/update-password", (req, res) => {
  res.status(410).json({
    success: false,
    message: "InboxHarbor 不保存邮箱密码，请使用 OAuth 授权。",
  });
});

app.delete("/api/accounts/:id", (req, res) => {
  const { id } = req.params;
  gData.accounts = gData.accounts.filter((a) => a.id !== id);
  saveDataToDisk();
  res.json({ success: true });
});

app.post("/api/accounts/batch-delete", (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ success: false });

  gData.accounts = gData.accounts.filter((a) => !ids.includes(a.id));
  saveDataToDisk();
  res.json({ success: true });
});

app.post("/api/accounts/check-status", async (req, res) => {
  const { ids } = req.body;
  const now = new Date().toISOString();

  const targetAccounts = gData.accounts.filter(
    (acc) =>
      acc.readEnabled !== false &&
      (!ids || ids.length === 0 || ids.includes(acc.id)),
  );
  let checkedCount = 0;

  for (let acc of targetAccounts) {
    if (!supportsOAuth(acc.provider)) {
      acc.status = "unsupported";
      acc.errorDetail = "该服务商连接器暂未接入";
      acc.lastChecked = now;
      checkedCount++;
      continue;
    }
    let result;
    if (acc.provider === "google") {
      result = await verifyGoogleAccount(acc);
    } else {
      result = await verifyMicrosoftAccount(acc);
    }

    acc.status = result.status;
    acc.errorDetail = result.error;
    acc.lastChecked = now;
    checkedCount++;
  }

  saveDataToDisk();
  res.json({
    success: true,
    checkedCount,
    accounts: gData.accounts.map(publicAccount),
  });
});

// Single Mail Fetcher Core Logic (Strict TOP 10 recent messages)
async function processSingleAccountFetch(acc, dataStore) {
  if (acc.readEnabled === false) return [];
  if (!supportsOAuth(acc.provider)) {
    acc.status = "unsupported";
    acc.errorDetail = "该服务商连接器暂未接入";
    acc.lastChecked = new Date().toISOString();
    return [];
  }
  let verify =
    acc.provider === "google"
      ? await verifyGoogleAccount(acc)
      : await verifyMicrosoftAccount(acc);
  acc.status = verify.status;
  acc.errorDetail = verify.error;
  acc.lastChecked = new Date().toISOString();

  const newMails = [];
  if (verify.status === "active") {
    let fetched =
      acc.provider === "google"
        ? await fetchGoogleMails(acc, verify.accessToken)
        : await fetchMicrosoftMails(acc, verify.accessToken);

    fetched.sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
    const top10 = fetched.slice(0, 10);

    const existingIds = new Set(dataStore.mails.map((m) => m.id));
    const existingFps = new Set(
      dataStore.mails.map((m) => getMailFingerprint(m)),
    );
    const clearedSet = new Set(dataStore.clearedMailIds || []);

    for (let m of top10) {
      const fp = getMailFingerprint(m);
      if (
        !existingIds.has(m.id) &&
        !existingFps.has(fp) &&
        !clearedSet.has(m.id) &&
        !clearedSet.has(fp)
      ) {
        dataStore.mails.unshift(m);
        newMails.push(m);
        existingIds.add(m.id);
        existingFps.add(fp);
      }
    }
    if (dataStore.mails.length > 200) {
      dataStore.mails = dataStore.mails.slice(0, 200);
    }
    acc.mailCount = (acc.mailCount || 0) + newMails.length;
  }
  return newMails;
}

app.post("/api/accounts/fetch-mail", async (req, res) => {
  const { ids } = req.body;
  const targetAccounts = gData.accounts.filter(
    (acc) =>
      acc.readEnabled !== false &&
      (!ids || ids.length === 0 || ids.includes(acc.id)),
  );
  const newMailsAll = [];

  // Run in Parallel batches of 15
  const batchSize = 15;
  for (let i = 0; i < targetAccounts.length; i += batchSize) {
    const batch = targetAccounts.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((acc) => processSingleAccountFetch(acc, gData)),
    );
    batchResults.forEach((mList) => newMailsAll.push(...mList));
  }

  saveDataToDisk();

  // Directly trigger Telegram Push for new mails!
  if (newMailsAll.length > 0) {
    await checkAndPushNewMailsToTelegram(newMailsAll);
    await pushConfiguredNotifications(newMailsAll);
  }

  res.json({
    success: true,
    fetchedCount: newMailsAll.length,
    mails: newMailsAll,
  });
});

app.post("/api/accounts/send-test-mail", async (req, res) => {
  const { fromId, targetEmail } = req.body;

  let senderAcc = gData.accounts.find(
    (a) => a.id === fromId || a.username === fromId,
  );
  if (!senderAcc) {
    senderAcc =
      gData.accounts.find((a) => a.status === "active") || gData.accounts[0];
  }

  if (!senderAcc) {
    return res
      .status(400)
      .json({ success: false, message: "未找到可用的账号" });
  }

  if (!supportsOAuth(senderAcc.provider))
    return res.status(400).json({
      success: false,
      message: "该服务商连接器暂未接入，当前不能发信。",
    });

  if (senderAcc.sendEnabled !== true) {
    return res.status(403).json({
      success: false,
      message: "该账户未开启发信权限，请先开启并重新完成 OAuth 授权。",
    });
  }

  const recipient = targetEmail || senderAcc.username;
  const testCode = Math.floor(100000 + Math.random() * 900000).toString();
  const testLink = `https://example.invalid/inboxharbor-test?code=${testCode}`;

  const verify =
    senderAcc.provider === "google"
      ? await verifyGoogleAccount(senderAcc)
      : await verifyMicrosoftAccount(senderAcc);
  if (verify.status !== "active" || !verify.accessToken)
    return res.status(400).json({
      success: false,
      message: verify.error || "账户授权无效，请重新授权。",
    });
  const scopes = String(senderAcc.providerScopes || "").split(/\s+/);
  const requiredScope =
    senderAcc.provider === "google"
      ? "https://www.googleapis.com/auth/gmail.send"
      : "Mail.Send";
  if (!scopes.includes(requiredScope))
    return res.status(403).json({
      success: false,
      message: "当前 OAuth 授权未包含发信权限，请重新授权。",
    });
  const sendResult =
    senderAcc.provider === "google"
      ? await sendGoogleMail(verify.accessToken, recipient, testCode, testLink)
      : await sendMicrosoftMail(
          verify.accessToken,
          recipient,
          testCode,
          testLink,
        );
  if (!sendResult.ok)
    return res
      .status(502)
      .json({ success: false, message: sendResult.error || "邮件发送失败" });

  res.json({
    success: true,
    message: `测试邮件已真实发送至 ${recipient}`,
    testCode,
    testLink,
  });
});

app.get("/api/mails", (req, res) => {
  res.json({ success: true, mails: gData.mails });
});

app.post("/api/mails/clear", (req, res) => {
  if (!gData.clearedMailIds) gData.clearedMailIds = [];
  const clearedSet = new Set(gData.clearedMailIds);

  for (let m of gData.mails) {
    if (m.id) clearedSet.add(m.id);
    const fp = getMailFingerprint(m);
    if (fp) clearedSet.add(fp);
  }

  gData.clearedMailIds = Array.from(clearedSet);
  gData.mails = [];
  saveDataToDisk();
  res.json({ success: true });
});

// --- PARALLEL ULTRA HIGH-SPEED BACKGROUND POLLING LOOP (1-SECOND REAL-TIME INTERVAL) ---
let isPolling = false;
setInterval(async () => {
  if (isPolling) return;
  const notificationEnabled = (gData.notificationConfig.channels || []).some(
    (c) => c.enabled,
  );
  if ((!gData.tgConfig || !gData.tgConfig.enabled) && !notificationEnabled)
    return;

  isPolling = true;
  try {
    const allAccounts = (gData.accounts || []).filter(
      (acc) => acc.readEnabled !== false,
    );
    if (allAccounts.length > 0) {
      // True full concurrency across all accounts simultaneously for sub-second scan!
      const batchResults = await Promise.all(
        allAccounts.map((acc) => processSingleAccountFetch(acc, gData)),
      );
      const newMailsAll = batchResults.flat();

      saveDataToDisk();

      if (newMailsAll.length > 0) {
        await checkAndPushNewMailsToTelegram(newMailsAll);
        await pushConfiguredNotifications(newMailsAll);
      }
    }
  } catch (err) {
    // Silent recovery
  } finally {
    isPolling = false;
  }
}, 1000); // 1s ultra-fast real-time polling

// Seed initial memory set from disk
loadDataFromDisk();

app.listen(PORT, HOST, () => {
  console.log(`====================================================`);
  console.log(` ⚓ InboxHarbor（收件港）- 本机邮箱管理台`);
  console.log(` 🚀 访问地址: http://${HOST}:${PORT}`);
  console.log(`====================================================`);
});
