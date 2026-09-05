const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cleanMailText,
  classifyMail,
  getGmailBody,
  publicMail,
  sortMailsNewestFirst,
} = require("../mail-utils");

test("mail cleaner removes executable markup and keeps readable paragraphs", () => {
  assert.equal(
    cleanMailText(
      "<style>.x{color:red}</style><script>alert(1)</script><p>Hello&nbsp;<b>friend</b></p><p>Code: &#54;&#49;&#50;&#51;</p><img src=x>",
    ),
    "Hello friend\nCode: 6123\n[图片]",
  );
});

test("mail classifier prioritizes codes and recognizes categories", () => {
  assert.equal(classifyMail({ code: "591845", subject: "账户变更" }), "验证码");
  assert.equal(classifyMail({ subject: "Invoice receipt" }), "账单");
  assert.equal(classifyMail({ content: "newsletter unsubscribe" }), "推广");
  assert.equal(classifyMail({ subject: "安全通知" }), "通知");
});

test("Gmail multipart alternative chooses plain text without duplicating HTML", () => {
  const encode = (value) => Buffer.from(value).toString("base64url");
  const payload = {
    mimeType: "multipart/alternative",
    parts: [
      { mimeType: "text/plain", body: { data: encode("Line one\nLine two") } },
      { mimeType: "text/html", body: { data: encode("<p>Line one</p><p>Line two</p>") } },
    ],
  };
  assert.equal(getGmailBody(payload), "Line one\nLine two");
  assert.equal(cleanMailText(getGmailBody(payload)), "Line one\nLine two");
});

test("public mail preserves paragraphs and assigns a category", () => {
  const mail = publicMail({
    id: "mail-1",
    subject: "安全通知",
    content: "<p>Line one</p><p>Line two</p>",
  });
  assert.equal(mail.content, "Line one\nLine two");
  assert.equal(mail.category, "通知");
});

test("mail ordering is newest first with a stable id tie-breaker", () => {
  const sorted = sortMailsNewestFirst([
    { id: "b", receivedAt: "2026-09-04T08:00:00Z" },
    { id: "c", receivedAt: "2026-09-05T08:00:00Z" },
    { id: "a", receivedAt: "2026-09-05T08:00:00Z" },
  ]);
  assert.deepEqual(
    sorted.map((mail) => mail.id),
    ["a", "c", "b"],
  );
});
