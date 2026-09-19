const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cleanMailText,
  classifyMail,
  getGmailBody,
  isNakedCssBlock,
  publicMail,
  queryMails,
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
  assert.equal(
    classifyMail({ code: "591845", subject: "您的登录验证码" }),
    "验证码",
  );
  assert.equal(classifyMail({ subject: "Invoice receipt" }), "账单");
  assert.equal(
    classifyMail({ code: "397528", subject: "Invoice #397528", content: "Amount due ¥96.51" }),
    "账单",
  );
  assert.equal(
    classifyMail({ code: "2025", subject: "Affiliate Monthly Referrals Report" }),
    "推广",
  );
  assert.equal(classifyMail({ content: "newsletter unsubscribe" }), "推广");
  assert.equal(classifyMail({ subject: "安全通知" }), "通知");
});

test("mail cleaner removes naked CSS copied into a text body", () => {
  const cleaned = cleanMailText(
    "Invoice #397528\nAmount Due: ¥96.51\n.ExternalClass p{font-family:Arial;color:#fff}.body{padding:0;line-height:100%}",
  );
  assert.equal(cleaned, "Invoice #397528\nAmount Due: ¥96.51");
});

test("CSS before content is removed without swallowing the following body", () => {
  assert.equal(
    cleanMailText(
      "@media screen {color:red;font-size:14px}\nHello customer\nAmount due 96.51",
    ),
    "Hello customer\nAmount due 96.51",
  );
  assert.equal(
    cleanMailText("Hello\n@font-face {font-family:test;src:url(test)}\nYour code is 123456"),
    "Hello\nYour code is 123456",
  );
  assert.equal(
    cleanMailText("@media screen {\n.x {\ncolor:red;\n}\n}\nHello customer"),
    "Hello customer",
  );
  assert.equal(
    cleanMailText(".ExternalClass p {\nfont-family:Arial;\n}\nYour code is 123456"),
    "Your code is 123456",
  );
});

test("ordinary brace text is never mistaken for a CSS line", () => {
  const examples = [
    "Step 1: create a {review} item.",
    "A {brace} is part of the payload.",
    "Please edit p {placeholder} before approval.",
    "A {status: pending} item remains.",
    ".NET {version: 8;} migration note",
  ];
  for (const example of examples) {
    assert.equal(isNakedCssBlock(example), false);
    assert.equal(cleanMailText(example), example);
  }
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

test("manual category and sender rules override automatic classification", () => {
  const rules = [
    { type: "domain", value: "example.com", category: "推广", createdAt: "2026-01-01" },
    { type: "sender", value: "billing@example.com", category: "账单", createdAt: "2026-01-02" },
  ];
  assert.equal(classifyMail({ sender: "Billing <billing@example.com>", subject: "Hello" }, rules), "账单");
  assert.equal(classifyMail({ sender: "news@example.com", subject: "Hello" }, rules), "推广");
  assert.equal(classifyMail({ sender: "news@example.com", categoryOverride: "社交" }, rules), "社交");
});

test("mail query supports advanced filters and pagination", () => {
  const mails = [
    { id: "3", account: "a@gmail.com", sender: "Billing <pay@example.com>", recipient: "a@gmail.com", subject: "Invoice", code: "未发现验证码", receivedAt: "2026-09-03T08:00:00Z" },
    { id: "2", account: "a@gmail.com", sender: "login@example.net", recipient: "a@gmail.com", subject: "Login code", content: "verification code", code: "123456", receivedAt: "2026-09-02T08:00:00Z" },
    { id: "1", direction: "sent", account: "a@gmail.com", sender: "a@gmail.com", recipient: "friend@example.org", subject: "Hello", receivedAt: "2026-09-01T08:00:00Z" },
  ];
  const filtered = queryMails(mails, { account: "gmail", hasCode: "true", direction: "received" });
  assert.deepEqual(filtered.mails.map((mail) => mail.id), ["2"]);
  assert.equal(filtered.pagination.total, 1);
  const paged = queryMails(mails, { q: "example", page: "2", pageSize: "1" });
  assert.deepEqual(paged.mails.map((mail) => mail.id), ["2"]);
  assert.deepEqual(paged.pagination, { page: 2, pageSize: 1, total: 3, totalPages: 3 });
  assert.deepEqual(queryMails(mails, { from: "pay@", category: "账单", dateFrom: "2026-09-03" }).mails.map((mail) => mail.id), ["3"]);
  assert.deepEqual(queryMails(mails, { to: "friend", direction: "sent", dateTo: "2026-09-01T23:59:59Z" }).mails.map((mail) => mail.id), ["1"]);
});
