const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 5555;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = path.join(__dirname, 'data.json');

// Default Credentials & Telegram Defaults
let GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
let GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

// Global In-Memory Deduplication Set for TELEGRAM PUSHES ONLY
const globalPushedFingerprints = new Set();

// SINGLE SHARED IN-MEMORY DATA STORE (PREVENTS CONCURRENT OVERWRITES)
let gData = {
  accounts: [],
  mails: [],
  tgConfig: {
    token: '',
    chatId: '',
    enabled: false,
    autoPollInterval: 5
  },
  pushedMailIds: [],
  clearedMailIds: [] // Track cleared mail IDs and fingerprints so they NEVER reappear!
};

function loadDataFromDisk() {
  if (!fs.existsSync(DATA_FILE)) {
    saveDataToDisk();
    return gData;
  }
  try {
    const fileContent = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(fileContent);
    gData.accounts = parsed.accounts || [];
    gData.mails = parsed.mails || [];
    if (parsed.tgConfig) gData.tgConfig = parsed.tgConfig;
    gData.tgConfig.autoPollInterval = 1;
    gData.pushedMailIds = parsed.pushedMailIds || [];
    gData.clearedMailIds = parsed.clearedMailIds || [];

    gData.pushedMailIds.forEach(id => globalPushedFingerprints.add(id));
    gData.clearedMailIds.forEach(id => globalPushedFingerprints.add(id));

    gData.accounts.forEach(acc => {
      acc.provider = detectProvider(acc.username);
    });
    return gData;
  } catch (err) {
    return gData;
  }
}

function saveDataToDisk() {
  gData.pushedMailIds = Array.from(globalPushedFingerprints);
  fs.writeFileSync(DATA_FILE, JSON.stringify(gData, null, 2), 'utf8');
}

// Decode RFC 2047 MIME Header Strings (e.g. =?UTF-8?B?...?=)
function decodeMimeHeader(headerStr) {
  if (!headerStr) return '';
  try {
    return headerStr.replace(/=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi, (match, charset, encoding, text) => {
      if (encoding.toUpperCase() === 'B') {
        return Buffer.from(text, 'base64').toString('utf8');
      } else if (encoding.toUpperCase() === 'Q') {
        return text.replace(/=([0-9A-F]{2})/gi, (m, hex) => String.fromCharCode(parseInt(hex, 16)));
      }
      return match;
    });
  } catch(e) {
    return headerStr;
  }
}

// Recursively decode Gmail MIME Payload Body Parts
function getGmailBody(payload) {
  if (!payload) return '';
  let body = '';
  if (payload.body && payload.body.data) {
    try {
      body += Buffer.from(payload.body.data, 'base64').toString('utf8') + '\n';
    } catch(e) {}
  }
  if (payload.parts && Array.isArray(payload.parts)) {
    for (let part of payload.parts) {
      if (part.body && part.body.data) {
        try {
          body += Buffer.from(part.body.data, 'base64').toString('utf8') + '\n';
        } catch(e) {}
      }
      if (part.parts) {
        body += getGmailBody(part) + '\n';
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
      method: 'CONNECT',
      path: parsed.hostname + ':443'
    });

    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) return reject(new Error('Proxy status ' + res.statusCode));

      const tlsSocket = tls.connect({ socket: socket, servername: parsed.hostname }, () => {
        let reqPath = parsed.pathname + parsed.search;
        let method = (options && options.method) ? options.method : 'GET';
        let headers = Object.assign({
          'Host': parsed.hostname,
          'User-Agent': 'NodeMailManager/1.0',
          'Connection': 'close'
        }, (options && options.headers) ? options.headers : {});

        let bodyData = (options && options.body) ? options.body : '';
        if (bodyData && typeof bodyData === 'string') {
          headers['Content-Length'] = Buffer.byteLength(bodyData);
        }

        const clientReq = https.request({
          hostname: parsed.hostname,
          path: reqPath,
          method: method,
          headers: headers,
          createConnection: () => tlsSocket
        }, (resResp) => {
          let chunks = [];
          resResp.on('data', chunk => chunks.push(chunk));
          resResp.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let data = null;
            try { data = JSON.parse(text); } catch(e) { data = { text }; }
            resolve({
              ok: resResp.statusCode >= 200 && resResp.statusCode < 300,
              status: resResp.statusCode,
              json: async () => data,
              text: async () => text
            });
          });
        });

        clientReq.on('error', err => reject(new Error('clientReq err: ' + err.message)));
        if (bodyData) clientReq.write(bodyData);
        clientReq.end();
      });

      tlsSocket.on('error', err => reject(new Error('tlsSocket err: ' + err.message)));
    });

    req.on('error', err => reject(new Error('proxy req err: ' + err.message)));
    req.setTimeout(1500, () => {
      req.destroy();
      reject(new Error('Proxy connection timeout'));
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
      const resp = await fetchViaHttpProxy(url, options, '127.0.0.1', cachedWorkingProxyPort);
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
      const resp = await fetchViaHttpProxy(url, options, '127.0.0.1', port);
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
    await new Promise(r => setTimeout(r, 100));
    return await fetch(url, options);
  }
}

function detectProvider(email) {
  if (!email) return 'microsoft';
  const lower = email.toLowerCase();
  if (lower.includes('gmail') || lower.includes('google')) {
    return 'google';
  }
  return 'microsoft';
}

// Clean invariant fingerprint including Message ID / Code to distinguish multiple verification codes in the same thread
function getMailFingerprint(mail) {
  if (!mail) return '';
  const accStr = (mail.account || '').toLowerCase().trim();
  const subjectStr = decodeMimeHeader(mail.subject || '').trim().toLowerCase();
  const senderStr = decodeMimeHeader(mail.sender || '').toLowerCase().trim();
  const mailId = (mail.id || '').trim();
  const codeStr = (mail.code && mail.code !== '未发现验证码') ? mail.code.trim() : '';
  return `fp_${accStr}___${senderStr}___${subjectStr}___${codeStr}___${mailId}`;
}

// Strict Telegram Push Deduplication Fingerprint by Account + Code to prevent duplicate pushes of same code
function getMailPushFingerprint(mail) {
  if (!mail) return '';
  const accStr = (mail.account || '').toLowerCase().trim();
  const codeStr = (mail.code && mail.code !== '未发现验证码') ? mail.code.trim() : '';
  const subjectStr = decodeMimeHeader(mail.subject || '').trim().toLowerCase().replace(/【垃圾箱】/g, '');
  if (codeStr) {
    return `tg_push_${accStr}___${codeStr}`;
  }
  return `tg_push_${accStr}___${subjectStr}___${mail.id || ''}`;
}

// --- TELEGRAM BOT PUSH SYSTEM ---

async function sendTelegramMessage(text, customToken, customChatId) {
  const cfg = gData.tgConfig || {};
  const token = customToken || cfg.token || '';
  const chatId = customChatId || cfg.chatId || '';

  if (!token || !chatId) {
    return { ok: false, error: 'Telegram Token 或 Chat ID 未配置' };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  
  // Try 1: Markdown mode
  const paramsMd = new URLSearchParams();
  paramsMd.append('chat_id', chatId);
  paramsMd.append('text', text);
  paramsMd.append('parse_mode', 'Markdown');

  try {
    const resp = await smartProxyFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: paramsMd.toString()
    });

    const resJson = await resp.json();
    if (resJson.ok) {
      return { ok: true };
    }

    // Try 2: Plain Text Fallback
    const plainText = text.replace(/[*_]/g, '');
    const paramsPlain = new URLSearchParams();
    paramsPlain.append('chat_id', chatId);
    paramsPlain.append('text', plainText);

    const respPlain = await smartProxyFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: paramsPlain.toString()
    });
    const resPlain = await respPlain.json();
    if (resPlain.ok) {
      return { ok: true };
    } else {
      return { ok: false, error: resPlain.description || 'Telegram 接口返回错误' };
    }
  } catch (err) {
    return { ok: false, error: `TG 网络异常: ${err.message}` };
  }
}

async function checkAndPushNewMailsToTelegram(newMails) {
  if (!gData.tgConfig || !gData.tgConfig.enabled) return;

  let pushCount = 0;
  const nowTime = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  for (let mail of newMails) {
    const pushFp = getMailPushFingerprint(mail);
    const rawId = mail.id || '';

    // Ignore old historical emails (older than 24h) for TG push
    const mailTime = mail.receivedAt ? new Date(mail.receivedAt).getTime() : nowTime;
    if (nowTime - mailTime > ONE_DAY_MS) {
      globalPushedFingerprints.add(pushFp);
      if (rawId) globalPushedFingerprints.add(rawId);
      continue;
    }

    // Strict Push Deduplication by Account + Code
    if (globalPushedFingerprints.has(pushFp) || (rawId && globalPushedFingerprints.has(rawId))) {
      continue;
    }

    // PRE-LOCK IMMEDIATELY BEFORE ASYNC NETWORK CALL TO PREVENT CONCURRENT DOUBLE PUSH
    globalPushedFingerprints.add(pushFp);
    if (rawId) globalPushedFingerprints.add(rawId);

    const providerTag = mail.provider === 'google' ? '🔴 谷歌 Gmail' : '🔷 微软 Outlook';
    const hasCode = mail.code && mail.code !== '未发现验证码';
    const codeDisplay = hasCode ? `\`${mail.code}\`  *(点击数字复制)*` : '`未发现验证码`';
    
    let linkDisplay = '无';
    if (mail.links && mail.links.length > 0) {
      linkDisplay = mail.links.map((l, idx) => `[点击打开验证链接 ${idx + 1}](${l})`).join('\n');
    }

    const cleanSubject = decodeMimeHeader(mail.subject || '无主题').replace(/[*_`]/g, '');
    const cleanSender = decodeMimeHeader(mail.sender || 'System').replace(/[*_`]/g, '');
    const cleanAccount = (mail.account || '').replace(/[*_`]/g, '');

    // Template 1
    const msg = `🔑 *验证码*： ${codeDisplay}\n` +
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
  if (pushCount > 0) console.log(`🎉 成功推送到 Telegram ${pushCount} 封最新模板一邮件！`);
}

function parseCredentials(acc) {
  let clientId = GOOGLE_CLIENT_ID;
  let clientSecret = GOOGLE_CLIENT_SECRET;
  let refreshToken = '';

  if (acc.provider === 'microsoft') {
    clientId = '9e5f94bc-e8a4-4e73-b8be-63364c29d753';
    clientSecret = '';
  }

  if (acc.note) {
    const parts = acc.note.split('----');
    if (parts.length >= 3) {
      clientId = parts[0].trim();
      clientSecret = parts[1].trim();
      refreshToken = parts.slice(2).join('----').trim();
    } else if (parts.length === 2 && parts[0].includes('-')) {
      clientId = parts[0].trim();
      refreshToken = parts[1].trim();
    } else if (acc.note.startsWith('M.')) {
      refreshToken = acc.note.trim();
    } else {
      refreshToken = parts[0].trim();
    }
  }

  return { clientId, clientSecret, refreshToken };
}

// Verify Microsoft Account with 1-hour Token Memory Cache
async function verifyMicrosoftAccount(acc) {
  if (acc._cachedToken && acc._cachedExpiresAt && Date.now() < acc._cachedExpiresAt) {
    return { status: 'active', accessToken: acc._cachedToken, error: null };
  }

  const { clientId, refreshToken } = parseCredentials(acc);

  if (!refreshToken) {
    return { status: 'invalid', error: '请点击右侧【授权】连接微软账号', accessToken: null };
  }

  try {
    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);

    const resp = await fetch('https://login.live.com/oauth20_token.srf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const data = await resp.json();

    if (resp.ok && data.access_token) {
      acc._cachedToken = data.access_token;
      acc._cachedExpiresAt = Date.now() + (data.expires_in ? (data.expires_in - 120) * 1000 : 3400 * 1000);
      return {
        status: 'active',
        accessToken: data.access_token,
        newRefreshToken: data.refresh_token || refreshToken,
        error: null
      };
    } else {
      return {
        status: 'invalid',
        error: data.error_description || data.error || 'Token 被撤销，请重新点击【授权】',
        accessToken: null
      };
    }
  } catch (err) {
    return { status: 'invalid', error: `网络通信异常: ${err.message}`, accessToken: null };
  }
}

// Verify Google Gmail Account with 1-hour Token Memory Cache
async function verifyGoogleAccount(acc) {
  if (acc.isMock) {
    return { status: 'active', accessToken: 'mock_gmail_access_token', error: null };
  }

  if (acc._cachedToken && acc._cachedExpiresAt && Date.now() < acc._cachedExpiresAt) {
    return { status: 'active', accessToken: acc._cachedToken, error: null };
  }

  const { clientId, clientSecret, refreshToken } = parseCredentials(acc);

  if (refreshToken) {
    try {
      const params = new URLSearchParams();
      params.append('client_id', clientId || GOOGLE_CLIENT_ID);
      if (clientSecret || GOOGLE_CLIENT_SECRET) {
        params.append('client_secret', clientSecret || GOOGLE_CLIENT_SECRET);
      }
      params.append('refresh_token', refreshToken);
      params.append('grant_type', 'refresh_token');

      const resp = await smartProxyFetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      const data = await resp.json();
      if (resp.ok && data.access_token) {
        acc._cachedToken = data.access_token;
        acc._cachedExpiresAt = Date.now() + (data.expires_in ? (data.expires_in - 120) * 1000 : 3400 * 1000);
        return { status: 'active', accessToken: data.access_token, error: null };
      }
    } catch (err) {}
  }

  return { status: 'invalid', error: '请点击右侧【授权】连接谷歌账号', accessToken: null };
}

// Smart Code & Link Extraction with matchAll iterator
function extractCodeAndLinks(subject, bodyText, rawContent) {
  const combined = (subject || '') + ' \n ' + (bodyText || '') + ' \n ' + (rawContent || '');
  let code = null;
  let codeType = '';

  const stopWords = new Set(['for', 'the', 'with', 'your', 'from', 'have', 'this', 'that', 'here', 'ready', 'next', 'stay', 'cool', 'launch', 'updates']);

  // Global iterator to avoid subject header false positive match traps
  const contextMatches = [...combined.matchAll(/(?:验证码|动态码|安全码|安全代码|PIN|OTP|code|verify|verification)[:：\s]*([A-Z0-9]{4,8})\b/gi)];
  for (let match of contextMatches) {
    if (match && match[1]) {
      const val = match[1].trim();
      if (!stopWords.has(val.toLowerCase()) && !/^[a-zA-Z]+$/.test(val)) {
        code = val;
        codeType = '智能识别码';
        break;
      }
    }
  }

  if (!code) {
    const match6 = combined.match(/\b(\d{6})\b/);
    if (match6) {
      code = match6[1];
      codeType = '6位数字码';
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
    if (matchAlpha && !matchAlpha[1].toLowerCase().includes('http')) {
      code = matchAlpha[1];
      codeType = '字母数字混合码';
    }
  }

  const linkRegex = /(https?:\/\/[^\s"'<>]+?(?:verify|confirm|activate|login|auth|token|reset|action|click)[^\s"'<>]*)/gi;
  const rawLinks = combined.match(linkRegex) || [];
  const uniqueLinks = [...new Set(rawLinks)].slice(0, 3);

  return {
    code: code || '未发现验证码',
    codeType: code ? codeType : '',
    links: uniqueLinks
  };
}

async function fetchMicrosoftMails(acc, accessToken) {
  const mails = [];
  try {
    const resp = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,body,bodyPreview,from,receivedDateTime', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (resp.ok) {
      const data = await resp.json();
      for (let item of (data.value || [])) {
        const rawContent = item.body?.content || '';
        const cleanBody = rawContent.replace(/<[^>]*>?/gm, '').trim();
        const cleanSubject = decodeMimeHeader(item.subject || '无主题');
        const cleanSender = decodeMimeHeader(item.from?.emailAddress?.address || 'System');
        const extracted = extractCodeAndLinks(cleanSubject, cleanBody, rawContent);

        mails.push({
          id: 'mail_' + item.id,
          account: acc.username,
          provider: 'microsoft',
          sender: cleanSender,
          subject: cleanSubject,
          content: cleanBody || '无正文内容',
          preview: item.bodyPreview || cleanBody.substr(0, 100),
          code: extracted.code,
          codeType: extracted.codeType,
          links: extracted.links,
          receivedAt: item.receivedDateTime || new Date().toISOString()
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
    const extracted = extractCodeAndLinks('【Google 安全验证】您的验证码是 ' + mockCode, '您的 Gmail 安全验证码为: ' + mockCode + '\n请点击激活链接: ' + mockLink, mockLink);

    return [{
      id: 'mail_gmail_mock_' + Date.now(),
      account: acc.username,
      provider: 'google',
      sender: 'no-reply@accounts.google.com',
      subject: '【Google 验证码】您的登录验证码是 ' + mockCode,
      content: `您好！正在登录 Google 账号。\n您的验证码为：${mockCode}\n请点击下方安全验证链接确认：\n${mockLink}`,
      preview: `您的 Gmail 安全验证码为: ${mockCode}`,
      code: extracted.code,
      codeType: extracted.codeType,
      links: extracted.links,
      receivedAt: new Date().toISOString()
    }];
  }

  if (accessToken) {
    const mails = [];
    try {
      const queryUrl = 'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=15&q=' + encodeURIComponent('in:inbox OR in:spam');
      const listResp = await smartProxyFetch(queryUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (listResp && listResp.ok) {
        const listData = await listResp.json();
        for (let msg of (listData.messages || [])) {
          const detailResp = await smartProxyFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          });

          if (detailResp && detailResp.ok) {
            const item = await detailResp.json();
            const headers = item.payload?.headers || [];
            const rawSubject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
            const rawFrom = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
            const dateHeader = headers.find(h => h.name.toLowerCase() === 'date');
            const snippet = item.snippet || '';

            // Decode Full Payload Body HTML/Text
            const fullPayloadBody = getGmailBody(item.payload);
            const cleanBody = fullPayloadBody ? fullPayloadBody.replace(/<[^>]*>?/gm, '').trim() : snippet;

            const cleanSubject = decodeMimeHeader(rawSubject) || '无主题';
            const cleanSender = decodeMimeHeader(rawFrom) || 'Google System';

            const isSpam = item.labelIds && item.labelIds.includes('SPAM');
            const prefix = isSpam ? '【垃圾箱】' : '';

            // Run extractCodeAndLinks on full body content + subject + snippet
            const extracted = extractCodeAndLinks(cleanSubject, cleanBody, snippet);

            let validTime = new Date().toISOString();
            if (dateHeader && dateHeader.value) {
              const d = new Date(dateHeader.value);
              if (!isNaN(d.getTime())) validTime = d.toISOString();
            }

            mails.push({
              id: 'mail_gmail_' + item.id,
              account: acc.username,
              provider: 'google',
              sender: cleanSender,
              subject: prefix + cleanSubject,
              content: cleanBody || snippet || '无正文内容',
              preview: snippet.substr(0, 100),
              code: extracted.code,
              codeType: extracted.codeType,
              links: extracted.links,
              receivedAt: validTime
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
        contentType: 'Text',
        content: `尊敬的用户：\n\n您正在发起本地测试校验，您的 6 位数字验证码为：${testCode}\n\n如果您需要完成账号激活或验证，请点击下方测试确认链接：\n${testLink}\n\n该验证码有效期为 10 分钟。`
      },
      toRecipients: [
        {
          emailAddress: {
            address: targetEmail
          }
        }
      ]
    }
  };

  const resp = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(mailPayload)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error('Microsoft sendMail API error status:', resp.status, errText);
    return { ok: false, error: `微软返回 HTTP ${resp.status} (若无写权限请点击该账号【授权】刷新权限)` };
  }

  return { ok: true };
}

function parseImportText(text) {
  const lines = text.split(/\r?\n/);
  const accounts = [];
  
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    
    let parts = line.includes('----') ? line.split('----') : (line.includes(',') ? line.split(',') : [line]);
    const username = parts[0] ? parts[0].trim() : '';
    const password = parts[1] ? parts[1].trim() : '';
    const note = parts.slice(2).join('----').trim();
    
    if (username) {
      accounts.push({
        id: 'acc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        username: username,
        password: password,
        note: note,
        provider: detectProvider(username),
        status: 'pending',
        lastChecked: new Date().toISOString(),
        mailCount: 0,
        createdAt: new Date().toISOString()
      });
    }
  }
  return accounts;
}

// --- MICROSOFT OFFICIAL DEVICE CODE FLOW ---

app.post('/api/auth/microsoft/device-code', async (req, res) => {
  const clientId = '9e5f94bc-e8a4-4e73-b8be-63364c29d753';
  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('scope', 'openid profile email https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send offline_access');

  try {
    const resp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/devicecode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const data = await resp.json();
    if (resp.ok && data.user_code) {
      res.json({
        success: true,
        userCode: data.user_code,
        deviceCode: data.device_code,
        verificationUri: data.verification_uri || 'https://microsoft.com/devicelogin',
        expiresIn: data.expires_in
      });
    } else {
      res.status(400).json({ success: false, message: data.error_description || '发起微软设备码失败' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/microsoft/poll-device-token', async (req, res) => {
  const { accountId, deviceCode } = req.body;
  if (!deviceCode) return res.status(400).json({ success: false, message: '缺失 deviceCode' });

  const clientId = '9e5f94bc-e8a4-4e73-b8be-63364c29d753';
  const params = new URLSearchParams();
  params.append('grant_type', 'urn:ietf:params:oauth:grant-type:device_code');
  params.append('client_id', clientId);
  params.append('device_code', deviceCode);

  try {
    const resp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const tokenData = await resp.json();

    if (resp.ok && (tokenData.access_token || tokenData.refresh_token)) {
      let targetAcc = gData.accounts.find(a => a.id === accountId);
      let userEmail = '';

      // Try 1: Parse ID Token JWT Payload (preferred_username)
      if (tokenData.id_token) {
        try {
          const parts = tokenData.id_token.split('.');
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
          if (payload.preferred_username) userEmail = payload.preferred_username;
          else if (payload.email) userEmail = payload.email;
          else if (payload.upn) userEmail = payload.upn;
        } catch(e) {}
      }

      // Try 2: Fetch /v1.0/me API
      if (!userEmail) {
        try {
          const userResp = await fetch('https://graph.microsoft.com/v1.0/me', {
            headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
          });
          const userData = await userResp.json();
          if (userData.userPrincipalName) userEmail = userData.userPrincipalName;
          else if (userData.mail) userEmail = userData.mail;
        } catch (e) {}
      }

      if (!targetAcc && userEmail) {
        targetAcc = gData.accounts.find(a => a.username.toLowerCase() === userEmail.toLowerCase());
      }

      if (targetAcc && !userEmail) {
        userEmail = targetAcc.username;
      }

      const refreshToken = tokenData.refresh_token || '';

      if (!targetAcc) {
        targetAcc = {
          id: 'acc_ms_' + Date.now(),
          username: userEmail || 'outlook_account@outlook.com',
          password: '',
          note: refreshToken,
          provider: 'microsoft',
          status: 'active',
          lastChecked: new Date().toISOString(),
          mailCount: 0,
          createdAt: new Date().toISOString()
        };
        gData.accounts.unshift(targetAcc);
      } else {
        if (userEmail && !userEmail.includes('outlook_account')) {
          targetAcc.username = userEmail;
        }
        targetAcc.status = 'active';
        targetAcc.provider = 'microsoft';
        targetAcc.note = refreshToken;
        targetAcc.lastChecked = new Date().toISOString();
      }

      saveDataToDisk();
      res.json({ success: true, status: 'completed', account: targetAcc });
    } else {
      if (tokenData.error === 'authorization_pending') {
        res.json({ success: true, status: 'pending' });
      } else {
        res.json({ success: false, status: 'failed', error: tokenData.error_description || tokenData.error });
      }
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- GOOGLE OAUTH BROWSER FLOW ---

app.get('/auth/google/login', (req, res) => {
  const accountId = req.query.id || '';
  const redirectUri = `http://localhost:${PORT}/auth/google/callback`;

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `response_type=code` +
    `&client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent('https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email')}` +
    `&access_type=offline` +
    `&prompt=consent` +
    `&state=${encodeURIComponent(accountId)}`;

  res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error || !code) {
    return res.send(`
      <div style="font-family: sans-serif; text-align: center; padding: 50px; background: #0f172a; color: #ef4444;">
        <h2>❌ 谷歌登录授权取消或失败</h2>
        <p>${error || '未接收到 Authorization Code'}</p>
        <button onclick="window.close()" style="padding: 10px 20px; background: #334155; color: #fff; border: none; border-radius: 6px; cursor: pointer;">关闭窗口</button>
      </div>
    `);
  }

  const redirectUri = `http://localhost:${PORT}/auth/google/callback`;

  try {
    const params = new URLSearchParams();
    params.append('code', code);
    params.append('client_id', GOOGLE_CLIENT_ID);
    params.append('client_secret', GOOGLE_CLIENT_SECRET);
    params.append('redirect_uri', redirectUri);
    params.append('grant_type', 'authorization_code');

    const tokenResp = await smartProxyFetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const tokenData = await tokenResp.json();

    if (tokenResp.ok && (tokenData.access_token || tokenData.refresh_token)) {
      let userEmail = 'gmail_account@gmail.com';
      try {
        const userResp = await smartProxyFetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
        });
        const userData = await userResp.json();
        if (userData.email) userEmail = userData.email;
      } catch (e) {}

      let targetAcc = gData.accounts.find(a => a.id === state || a.username.toLowerCase() === userEmail.toLowerCase());

      const refreshToken = tokenData.refresh_token || (targetAcc ? parseCredentials(targetAcc).refreshToken : '');

      if (!targetAcc) {
        targetAcc = {
          id: 'acc_gmail_' + Date.now(),
          username: userEmail,
          password: '',
          note: `${GOOGLE_CLIENT_ID}----${GOOGLE_CLIENT_SECRET}----${refreshToken}`,
          provider: 'google',
          status: 'active',
          lastChecked: new Date().toISOString(),
          mailCount: 0,
          createdAt: new Date().toISOString()
        };
        gData.accounts.unshift(targetAcc);
      } else {
        targetAcc.username = userEmail;
        targetAcc.status = 'active';
        targetAcc.provider = 'google';
        targetAcc.note = `${GOOGLE_CLIENT_ID}----${GOOGLE_CLIENT_SECRET}----${refreshToken}`;
        targetAcc.lastChecked = new Date().toISOString();
      }

      saveDataToDisk();

      res.send(`
        <div style="font-family: sans-serif; text-align: center; padding: 50px; background: #0f172a; color: #10b981;">
          <h2>🎉 谷歌 OAuth2 授权成功！</h2>
          <p style="color: #cbd5e1;">已获取 Refresh Token 并成功绑定账号: <strong>${userEmail}</strong></p>
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
          <p>${tokenData.error_description || tokenData.error || '无法由 Authorization Code 换取 Token'}</p>
        </div>
      `);
    }
  } catch (err) {
    res.send(`<div style="font-family: sans-serif; text-align: center; padding: 50px; background: #0f172a; color: #ef4444;"><h2>❌ 网络请求失败</h2><p>${err.message}</p></div>`);
  }
});

// --- REST API ENDPOINTS ---

app.get('/api/tg/config', (req, res) => {
  res.json({ success: true, tgConfig: gData.tgConfig });
});

app.post('/api/tg/config', (req, res) => {
  const { token, chatId, enabled, autoPollInterval } = req.body;
  gData.tgConfig = {
    token: token !== undefined ? token : gData.tgConfig.token,
    chatId: chatId !== undefined ? chatId : gData.tgConfig.chatId,
    enabled: enabled !== undefined ? enabled : gData.tgConfig.enabled,
    autoPollInterval: autoPollInterval ? parseInt(autoPollInterval) : 1
  };
  saveDataToDisk();
  res.json({ success: true, tgConfig: gData.tgConfig });
});

app.post('/api/tg/test', async (req, res) => {
  const { token, chatId } = req.body;
  const msg = `🔑 *验证码*： \`742651\`  *(点击数字复制)*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👤 *接收账号*: \`demo_user@gmail.com\` (🔴 谷歌 Gmail)\n` +
    `📩 *发 件 人*: \`Microsoft 帐户团队\`\n` +
    `📋 *邮件主题*: *个人 Microsoft 帐户安全代码*\n` +
    `⏰ *接收时间*: ${new Date().toLocaleString()}\n` +
    `🔗 *快捷链接*: 无`;

  const result = await sendTelegramMessage(msg, token, chatId);
  if (result.ok) {
    res.json({ success: true, message: '测试消息已成功发送至您的 Telegram！' });
  } else {
    res.status(400).json({ success: false, message: result.error });
  }
});

app.get('/api/stats', (req, res) => {
  const msCount = gData.accounts.filter(a => (a.provider || detectProvider(a.username)) === 'microsoft').length;
  const ggCount = gData.accounts.filter(a => (a.provider || detectProvider(a.username)) === 'google').length;

  res.json({
    totalAccounts: gData.accounts.length,
    activeAccounts: gData.accounts.filter(a => a.status === 'active').length,
    invalidAccounts: gData.accounts.filter(a => a.status === 'invalid').length,
    microsoftAccounts: msCount,
    googleAccounts: ggCount,
    totalMails: gData.mails.length,
    totalCodes: gData.mails.filter(m => m.code && m.code !== '未发现验证码').length
  });
});

app.get('/api/accounts', (req, res) => {
  res.json({ success: true, accounts: gData.accounts });
});

// Single Account & Verification Code Fast Lookup API
app.get('/api/accounts/lookup', (req, res) => {
  const query = (req.query.username || req.query.email || '').toLowerCase().trim();
  if (!query) return res.status(400).json({ success: false, message: '缺失 username 参数' });

  let acc = gData.accounts.find(a => a.username.toLowerCase().trim() === query || a.username.toLowerCase().split('@')[0] === query);

  if (!acc) {
    return res.json({ success: true, found: false, message: '数据库中未找到该账号' });
  }

  const clearedSet = new Set(gData.clearedMailIds || []);
  const latestMail = gData.mails.find(m => {
    if (!m || !m.code || m.code === '未发现验证码' || m.code === '707070') return false;
    if (clearedSet.has(m.id) || clearedSet.has(m.code)) return false;

    const accName = (m.account || '').toLowerCase().trim();
    return accName === acc.username.toLowerCase().trim() || accName === query;
  });

  res.json({
    success: true,
    found: true,
    account: {
      id: acc.id,
      username: acc.username,
      password: acc.password || '',
      provider: acc.provider,
      status: acc.status
    },
    latestCode: latestMail ? {
      code: latestMail.code,
      codeType: latestMail.codeType,
      receivedAt: latestMail.receivedAt,
      links: latestMail.links || []
    } : null
  });
});

app.get('/api/export-ms-txt', (req, res) => {
  try {
    const msAccounts = (gData.accounts || []).filter(a => {
      const p = (a.provider || '').toLowerCase();
      const u = (a.username || '').toLowerCase();
      return p !== 'google' && !u.includes('gmail.com');
    });
    const lines = msAccounts.map(a => `${a.username}----${a.password || ''}\r\n`).join('');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="microsoft_accounts.txt"');
    return res.send(lines);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Import Accounts Endpoint with Smart Upsert (Updates existing accounts if username matches)
app.post('/api/accounts/import', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ success: false, message: '内容不能为空' });

  const imported = parseImportText(text);
  let addedCount = 0;
  let updatedCount = 0;

  for (let acc of imported) {
    const existingIndex = gData.accounts.findIndex(a => a.username.toLowerCase() === acc.username.toLowerCase());
    if (existingIndex >= 0) {
      if (acc.password) gData.accounts[existingIndex].password = acc.password;
      if (acc.note) gData.accounts[existingIndex].note = acc.note;
      gData.accounts[existingIndex].lastChecked = new Date().toISOString();
      updatedCount++;
    } else {
      gData.accounts.unshift(acc);
      addedCount++;
    }
  }

  saveDataToDisk();
  res.json({ success: true, addedCount, updatedCount, total: gData.accounts.length });
});

app.post('/api/accounts/add-outlook-tool', (req, res) => {
  const { username, password, note } = req.body;
  const email = username ? (username.includes('@') ? username : username + '@outlook.com') : `user_${Math.floor(1000 + Math.random() * 9000)}@outlook.com`;

  let exists = gData.accounts.find(a => a.username.toLowerCase() === email.toLowerCase());

  if (!exists) {
    exists = {
      id: 'acc_ms_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      username: email,
      password: password || '',
      note: note || '',
      provider: 'microsoft',
      status: 'pending',
      lastChecked: new Date().toISOString(),
      mailCount: 0,
      createdAt: new Date().toISOString()
    };
    gData.accounts.unshift(exists);
    saveDataToDisk();
  }

  res.json({ success: true, account: exists, total: gData.accounts.length });
});

app.post('/api/accounts/add-gmail-tool', (req, res) => {
  const { username, password, note, isMock } = req.body;
  const email = username ? (username.includes('@') ? username : username + '@gmail.com') : `user_${Math.floor(1000 + Math.random() * 9000)}@gmail.com`;

  const exists = gData.accounts.find(a => a.username.toLowerCase() === email.toLowerCase());

  if (exists) {
    return res.status(400).json({ success: false, message: '该 Gmail 账号已存在' });
  }

  const newAcc = {
    id: 'acc_gmail_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    username: email,
    password: password || '',
    note: note || 'Gmail 16位应用专用密码 / OAuth',
    provider: 'google',
    status: isMock ? 'active' : 'pending',
    isMock: !!isMock,
    lastChecked: new Date().toISOString(),
    mailCount: 0,
    createdAt: new Date().toISOString()
  };

  gData.accounts.unshift(newAcc);
  saveDataToDisk();
  res.json({ success: true, account: newAcc, total: gData.accounts.length });
});

app.post('/api/accounts/update-password', (req, res) => {
  const { id, password } = req.body;
  const acc = gData.accounts.find(a => a.id === id || a.username.toLowerCase() === (id || '').toLowerCase());
  if (acc) {
    acc.password = password || '';
    saveDataToDisk();
    return res.json({ success: true, account: acc });
  }
  res.status(400).json({ success: false, message: '未找到该账号' });
});

app.delete('/api/accounts/:id', (req, res) => {
  const { id } = req.params;
  gData.accounts = gData.accounts.filter(a => a.id !== id);
  saveDataToDisk();
  res.json({ success: true });
});

app.post('/api/accounts/batch-delete', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ success: false });

  gData.accounts = gData.accounts.filter(a => !ids.includes(a.id));
  saveDataToDisk();
  res.json({ success: true });
});

app.post('/api/accounts/check-status', async (req, res) => {
  const { ids } = req.body;
  const now = new Date().toISOString();

  const targetAccounts = gData.accounts.filter(acc => !ids || ids.length === 0 || ids.includes(acc.id));
  let checkedCount = 0;

  for (let acc of targetAccounts) {
    let result;
    if (acc.provider === 'google') {
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
  res.json({ success: true, checkedCount, accounts: gData.accounts });
});

// Single Mail Fetcher Core Logic (Strict TOP 10 recent messages)
async function processSingleAccountFetch(acc, dataStore) {
  let verify = acc.provider === 'google' ? await verifyGoogleAccount(acc) : await verifyMicrosoftAccount(acc);
  acc.status = verify.status;
  acc.errorDetail = verify.error;
  acc.lastChecked = new Date().toISOString();

  const newMails = [];
  if (verify.status === 'active') {
    let fetched = acc.provider === 'google' ? await fetchGoogleMails(acc, verify.accessToken) : await fetchMicrosoftMails(acc, verify.accessToken);
    
    fetched.sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
    const top10 = fetched.slice(0, 10);

    const existingIds = new Set(dataStore.mails.map(m => m.id));
    const existingFps = new Set(dataStore.mails.map(m => getMailFingerprint(m)));
    const clearedSet = new Set(dataStore.clearedMailIds || []);

    for (let m of top10) {
      const fp = getMailFingerprint(m);
      if (!existingIds.has(m.id) && !existingFps.has(fp) && !clearedSet.has(m.id) && !clearedSet.has(fp)) {
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

app.post('/api/accounts/fetch-mail', async (req, res) => {
  const { ids } = req.body;
  const targetAccounts = gData.accounts.filter(acc => !ids || ids.length === 0 || ids.includes(acc.id));
  const newMailsAll = [];

  // Run in Parallel batches of 15
  const batchSize = 15;
  for (let i = 0; i < targetAccounts.length; i += batchSize) {
    const batch = targetAccounts.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(acc => processSingleAccountFetch(acc, gData)));
    batchResults.forEach(mList => newMailsAll.push(...mList));
  }

  saveDataToDisk();

  // Directly trigger Telegram Push for new mails!
  if (newMailsAll.length > 0) {
    await checkAndPushNewMailsToTelegram(newMailsAll);
  }

  res.json({ success: true, fetchedCount: newMailsAll.length, mails: newMailsAll });
});

app.post('/api/accounts/send-test-mail', async (req, res) => {
  const { fromId, targetEmail } = req.body;

  let senderAcc = gData.accounts.find(a => a.id === fromId || a.username === fromId);
  if (!senderAcc) {
    senderAcc = gData.accounts.find(a => a.status === 'active') || gData.accounts[0];
  }

  if (!senderAcc) {
    return res.status(400).json({ success: false, message: '未找到可用的账号' });
  }

  const recipient = targetEmail || senderAcc.username;
  const testCode = Math.floor(100000 + Math.random() * 900000).toString();
  const testLink = `https://login.live.com/oauth20_authorize.srf?client_id=9e5f94bc-e8a4-4e73-b8be-63364c29d753&scope=mail.read&response_type=code&redirect_uri=https://example.com/activate?token=${testCode}`;

  let isSentViaApi = false;
  const verify = senderAcc.provider === 'google' ? await verifyGoogleAccount(senderAcc) : await verifyMicrosoftAccount(senderAcc);
  
  if (verify.status === 'active' && verify.accessToken && senderAcc.provider === 'microsoft') {
    const sendRes = await sendMicrosoftMail(verify.accessToken, recipient, testCode, testLink);
    if (sendRes.ok) {
      isSentViaApi = true;
    }
  }

  // Smart Fallback: Generate real test mail entry & push to TG instantly!
  const testMail = {
    id: 'mail_test_' + Date.now(),
    account: recipient,
    provider: senderAcc.provider || 'microsoft',
    sender: senderAcc.username,
    subject: `【测试验证码】您的登录验证码是 ${testCode}`,
    content: `您好！正在对账号 [${recipient}] 进行本地极速探查校验。\n验证码：${testCode}\n确认链接：${testLink}`,
    preview: `您的测试验证码为: ${testCode}`,
    code: testCode,
    codeType: '6位数字码',
    links: [testLink],
    receivedAt: new Date().toISOString()
  };

  gData.mails.unshift(testMail);
  saveDataToDisk();

  // Instant Push to Telegram
  await checkAndPushNewMailsToTelegram([testMail]);

  const tipMsg = isSentViaApi
    ? `已通过微软真实服务器发送测试邮件！验证码为: ${testCode}`
    : `测试验证码邮件已自动生成并推送到 TG！验证码为: ${testCode}`;

  res.json({
    success: true,
    message: tipMsg,
    testCode,
    testLink
  });
});

app.get('/api/mails', (req, res) => {
  res.json({ success: true, mails: gData.mails });
});

app.post('/api/mails/clear', (req, res) => {
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
  if (!gData.tgConfig || !gData.tgConfig.enabled) return;

  isPolling = true;
  try {
    const allAccounts = gData.accounts || [];
    if (allAccounts.length > 0) {
      // True full concurrency across all accounts simultaneously for sub-second scan!
      const batchResults = await Promise.all(allAccounts.map(acc => processSingleAccountFetch(acc, gData)));
      const newMailsAll = batchResults.flat();

      saveDataToDisk();

      if (newMailsAll.length > 0) {
        await checkAndPushNewMailsToTelegram(newMailsAll);
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(` ⚡ MailPulse - 现代化多邮局极速管理控制台`);
  console.log(` 🚀 访问地址: http://localhost:${PORT}`);
  console.log(`====================================================`);
});
