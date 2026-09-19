const namedEntities = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeHtmlEntities(value) {
  return value.replace(
    /&(#x?[0-9a-f]+|amp|apos|gt|lt|nbsp|quot);/gi,
    (entity, code) => {
      if (code[0] !== "#") return namedEntities[code.toLowerCase()] || entity;
      const hex = code[1].toLowerCase() === "x";
      const point = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(point) || point > 0x10ffff) return entity;
      try {
        return String.fromCodePoint(point);
      } catch {
        return entity;
      }
    },
  );
}

function isNakedCssBlock(value) {
  const text = String(value || "").trim();
  if (!text || !text.includes("{") || !text.includes("}")) return false;
  if (
    !/^(?:@(?:media|font-face|supports)\b[^{]*|[.#][a-z_][\w-]*(?:[\s.#:[>,+~][^{]*)?|(?:body|html|table|td|img|h[1-6])(?:\s|[.#:[>,+~])[^{]*)\s*\{/i.test(
      text,
    )
  )
    return false;
  return /(?:^|[;{])\s*(?:--[\w-]+|color|background(?:-color)?|font(?:-[\w-]+)?|line-height|letter-spacing|padding(?:-[\w-]+)?|margin(?:-[\w-]+)?|width|height|min-(?:width|height)|max-(?:width|height)|display|position|top|right|bottom|left|border(?:-[\w-]+)?|outline|text-(?:align|decoration|size-adjust)|vertical-align|overflow(?:-[xy])?|opacity|visibility|box-sizing|border-collapse|-ms-[\w-]+|-webkit-[\w-]+)\s*:\s*[^;{}]+/im.test(
    text,
  );
}

function stripNakedCssBlocks(value) {
  const lines = String(value || "").split(/\r?\n/);
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^(?:\s*@(?:media|font-face|supports)\b|\s*[.#][a-z_][\w-]*|\s*(?:body|html|table|td|img|h[1-6])(?:\s|[.#:[>,+~]))/i.test(line)) {
      output.push(line);
      continue;
    }
    const candidate = [line];
    let depth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    while (depth > 0 && index + 1 < lines.length) {
      index += 1;
      candidate.push(lines[index]);
      depth += (lines[index].match(/\{/g) || []).length;
      depth -= (lines[index].match(/\}/g) || []).length;
    }
    const block = candidate.join("\n");
    if (depth !== 0 || !isNakedCssBlock(block)) output.push(...candidate);
  }
  return output.join("\n");
}

function cleanMailText(value) {
  const withoutMarkup = decodeHtmlEntities(
    String(value || "")
      .replace(/<(style|script|head|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<img[^>]*>/gi, " [图片] ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " "),
  );
  return stripNakedCssBlocks(withoutMarkup)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const MAIL_CATEGORIES = ["验证码", "通知", "账单", "社交", "推广", "其他"];

function normalizeEmail(value) {
  const text = String(value || "").trim().toLowerCase();
  const angleMatch = text.match(/<([^<>\s]+@[^<>\s]+)>/);
  if (angleMatch) return angleMatch[1];
  const plainMatch = text.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+/i);
  return plainMatch ? plainMatch[0].toLowerCase() : text;
}

function categoryFromRules(mail, rules = []) {
  if (mail.direction === "sent") return "";
  const sender = normalizeEmail(mail.sender);
  const domain = sender.includes("@") ? sender.split("@").pop() : "";
  const matches = [...rules]
    .filter((rule) => rule && MAIL_CATEGORIES.includes(rule.category))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const exact = matches.find(
    (rule) => rule.type === "sender" && normalizeEmail(rule.value) === sender,
  );
  if (exact) return exact.category;
  const byDomain = matches.find(
    (rule) =>
      rule.type === "domain" &&
      domain &&
      String(rule.value || "").trim().toLowerCase().replace(/^@/, "") === domain,
  );
  return byDomain?.category || "";
}

function classifyMail(mail = {}, rules = []) {
  if (mail.direction === "sent") return "已发送";
  if (MAIL_CATEGORIES.includes(mail.categoryOverride)) return mail.categoryOverride;
  const ruleCategory = categoryFromRules(mail, rules);
  if (ruleCategory) return ruleCategory;
  const text = `${mail.subject || ""} ${mail.sender || ""} ${mail.content || ""}`.toLowerCase();
  const subject = String(mail.subject || "").toLowerCase();
  if (/账单|发票|invoice|receipt|payment|付款|支付|扣款|续费|amount due|due date/.test(text))
    return "账单";
  if (/linkedin|facebook|instagram|twitter|社交|好友|关注了你|评论了/.test(text))
    return "社交";
  if (/优惠|促销|discount|\bsale\b|推广|newsletter|unsubscribe|退订|affiliate|referral/.test(text))
    return "推广";
  const hasVerificationContext =
    /验证码|校验码|动态码|security code|verification code|verify code|one[- ]time (?:code|password)|\botp\b/.test(
      `${subject} ${String(mail.content || "").slice(0, 600).toLowerCase()}`,
    );
  if (
    hasVerificationContext &&
    mail.code &&
    mail.code !== "未发现验证码"
  )
    return "验证码";
  if (/通知|notification|提醒|alert|安全|登录|订单|物流|变更/.test(text))
    return "通知";
  return "其他";
}

function publicMail(mail, rules = []) {
  const content = cleanMailText(mail.content);
  return {
    ...mail,
    content: content || "无正文内容",
    preview: cleanMailText(mail.preview || content).slice(0, 220),
    category: classifyMail({ ...mail, content }, rules),
  };
}

function includesText(value, query) {
  return String(value || "").toLowerCase().includes(query);
}

function queryMails(mails, query = {}, rules = []) {
  const positiveInt = (value, fallback, max) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
  };
  const page = positiveInt(query.page, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = positiveInt(query.pageSize || query.limit, 50, 100);
  const q = String(query.q || "").trim().toLowerCase();
  const from = String(query.from || "").trim().toLowerCase();
  const to = String(query.to || "").trim().toLowerCase();
  const account = String(query.account || "").trim().toLowerCase();
  const category = String(query.category || "").trim();
  const direction = String(query.direction || "").trim().toLowerCase();
  const dateFrom = query.dateFrom ? new Date(query.dateFrom) : null;
  const dateTo = query.dateTo
    ? new Date(
        /^\d{4}-\d{2}-\d{2}$/.test(String(query.dateTo))
          ? `${query.dateTo}T23:59:59.999`
          : query.dateTo,
      )
    : null;
  const hasCode = ["true", "1"].includes(String(query.hasCode).toLowerCase())
    ? true
    : ["false", "0"].includes(String(query.hasCode).toLowerCase())
      ? false
      : null;
  const prepared = sortMailsNewestFirst(mails.map((mail) => publicMail(mail, rules))).sort(
    (a, b) => Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned)),
  );
  const facets = { 全部: prepared.filter((mail) => mail.direction !== "sent").length };
  for (const mail of prepared) facets[mail.category] = (facets[mail.category] || 0) + 1;
  const normalizedDirection = ["inbox", "inbound"].includes(direction)
    ? "received"
    : direction;
  const filtered = prepared.filter((mail) => {
    const mailDirection = mail.direction === "sent" ? "sent" : "received";
    const receivedAt = new Date(mail.receivedAt || 0);
    const mailHasCode = Boolean(mail.code && mail.code !== "未发现验证码");
    if (q && ![mail.subject, mail.sender, mail.recipient, mail.account, mail.content, mail.preview, mail.code].some((v) => includesText(v, q))) return false;
    if (from && !includesText(mail.sender, from)) return false;
    if (to && !includesText(mail.recipient, to)) return false;
    if (account && !includesText(mail.account, account)) return false;
    if (category && mail.category !== category) return false;
    if (normalizedDirection && normalizedDirection !== "all" && mailDirection !== normalizedDirection) return false;
    if (hasCode !== null && mailHasCode !== hasCode) return false;
    if (dateFrom && !Number.isNaN(dateFrom.valueOf()) && receivedAt < dateFrom) return false;
    if (dateTo && !Number.isNaN(dateTo.valueOf()) && receivedAt > dateTo) return false;
    return true;
  });
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return {
    mails: filtered.slice(start, start + pageSize),
    pagination: { page, pageSize, total, totalPages },
    facets,
  };
}

function decodeGmailPart(part) {
  if (!part?.body?.data || part.filename) return "";
  try {
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function collectGmailParts(payload, mimeType, matches = []) {
  if (!payload) return matches;
  if (String(payload.mimeType || "").toLowerCase() === mimeType) {
    const decoded = decodeGmailPart(payload);
    if (decoded) matches.push(decoded);
  }
  for (const part of payload.parts || [])
    collectGmailParts(part, mimeType, matches);
  return matches;
}

function getGmailBody(payload) {
  const plain = collectGmailParts(payload, "text/plain").sort(
    (a, b) => b.length - a.length,
  )[0];
  if (plain) return plain;
  const html = collectGmailParts(payload, "text/html").sort(
    (a, b) => b.length - a.length,
  )[0];
  if (html) return html;
  return decodeGmailPart(payload);
}

function sortMailsNewestFirst(mails) {
  return [...mails].sort(
    (a, b) =>
      new Date(b.receivedAt || 0) - new Date(a.receivedAt || 0) ||
      String(a.id || "").localeCompare(String(b.id || "")),
  );
}

module.exports = {
  MAIL_CATEGORIES,
  categoryFromRules,
  cleanMailText,
  classifyMail,
  getGmailBody,
  isNakedCssBlock,
  publicMail,
  queryMails,
  sortMailsNewestFirst,
};
