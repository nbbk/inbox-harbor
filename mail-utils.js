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

function cleanMailText(value) {
  return decodeHtmlEntities(
    String(value || "")
      .replace(/<(style|script|head|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<img[^>]*>/gi, " [图片] ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function classifyMail(mail = {}) {
  if (mail.code && mail.code !== "未发现验证码") return "验证码";
  const text = `${mail.subject || ""} ${mail.sender || ""} ${mail.content || ""}`.toLowerCase();
  if (/验证码|verification|security code|one[- ]time|\botp\b|\bpin\b/.test(text))
    return "验证码";
  if (/账单|发票|invoice|receipt|payment|付款|支付|扣款|续费/.test(text))
    return "账单";
  if (/linkedin|facebook|instagram|twitter|社交|好友|关注了你|评论了/.test(text))
    return "社交";
  if (/优惠|促销|discount|\bsale\b|推广|newsletter|unsubscribe|退订/.test(text))
    return "推广";
  if (/通知|notification|提醒|alert|安全|登录|订单|物流|变更/.test(text))
    return "通知";
  return "其他";
}

function publicMail(mail) {
  const content = cleanMailText(mail.content);
  return {
    ...mail,
    content: content || "无正文内容",
    preview: cleanMailText(mail.preview || content).slice(0, 220),
    category: classifyMail({ ...mail, content }),
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
  cleanMailText,
  classifyMail,
  getGmailBody,
  publicMail,
  sortMailsNewestFirst,
};
