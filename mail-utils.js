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

function classifyMail(mail = {}) {
  if (mail.direction === "sent") return "已发送";
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
  isNakedCssBlock,
  publicMail,
  sortMailsNewestFirst,
};
