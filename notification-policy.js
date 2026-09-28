"use strict";

const DEFAULT_POLICY = Object.freeze({ rules: [], quietHours: { enabled: false, start: "22:00", end: "08:00", timeZone: "UTC" }, dedupeMinutes: 0 });
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function validZone(zone) { try { new Intl.DateTimeFormat("en-GB", { timeZone: zone }).format(); return true; } catch { return false; } }
function normalizePolicy(value = {}, { accountIds = new Set(), channelIds = new Set() } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("通知策略格式无效");
  const quiet = { ...DEFAULT_POLICY.quietHours, ...(value.quietHours || {}) };
  if (typeof quiet.enabled !== "boolean" || !TIME.test(String(quiet.start)) || !TIME.test(String(quiet.end)) || typeof quiet.timeZone !== "string" || !validZone(quiet.timeZone)) throw new Error("免打扰时间或时区无效");
  const dedupeMinutes = Number(value.dedupeMinutes ?? 0);
  if (!Number.isInteger(dedupeMinutes) || dedupeMinutes < 0 || dedupeMinutes > 60) throw new Error("重复通知抑制时间必须为 0–60 分钟");
  if (!Array.isArray(value.rules) || value.rules.length > 100) throw new Error("通知规则最多 100 条");
  const ids = new Set();
  const rules = value.rules.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("通知规则格式无效");
    const id = String(raw.id || `rule_${index + 1}`).trim();
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ids.has(id)) throw new Error("通知规则 ID 无效或重复");
    ids.add(id);
    const accountId = raw.accountId ? String(raw.accountId) : "";
    if (accountId && !accountIds.has(accountId)) throw new Error("通知规则引用了当前用户不存在的邮箱");
    const sender = String(raw.sender || "").trim().toLowerCase();
    const keyword = String(raw.keyword || "").trim().toLowerCase();
    if (sender.length > 254 || keyword.length > 200) throw new Error("通知规则匹配条件过长");
    const selected = [...new Set((raw.channelIds || []).map(String))];
    if (!selected.length || selected.some((channelId) => !channelIds.has(channelId))) throw new Error("通知规则必须选择当前用户的通知渠道");
    return { id, enabled: raw.enabled !== false, accountId: accountId || null, sender, keyword, channelIds: selected };
  });
  return { rules, quietHours: { enabled: quiet.enabled, start: quiet.start, end: quiet.end, timeZone: quiet.timeZone }, dedupeMinutes };
}
function partsAt(now, zone) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return get("hour") * 60 + get("minute");
}
function toMinutes(time) { const [hour, minute] = time.split(":").map(Number); return hour * 60 + minute; }
function isQuiet(policy, now = Date.now()) {
  const quiet = policy.quietHours;
  if (!quiet?.enabled || quiet.start === quiet.end) return false;
  const minute = partsAt(now, quiet.timeZone), start = toMinutes(quiet.start), end = toMinutes(quiet.end);
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}
function quietEndsAt(policy, now = Date.now()) {
  if (!isQuiet(policy, now)) return now;
  for (let step = 1; step <= 24 * 60 + 1; step++) { const candidate = now + step * 60000; if (!isQuiet(policy, candidate)) return candidate; }
  return now + 24 * 60 * 60000;
}
function matchingChannelIds(policy, mail, channels) {
  const enabled = (channels || []).filter((channel) => channel.enabled);
  const activeRules = (policy.rules || []).filter((rule) => rule.enabled);
  if (!activeRules.length) return enabled.map((channel) => channel.id);
  const sender = String(mail.sender || "").trim().toLowerCase();
  const text = [mail.subject, mail.content, mail.preview].map((value) => String(value || "").toLowerCase()).join("\n");
  const ids = new Set();
  for (const rule of activeRules) {
    if (rule.accountId && rule.accountId !== mail.accountId) continue;
    if (rule.sender && !sender.includes(rule.sender)) continue;
    if (rule.keyword && !text.includes(rule.keyword)) continue;
    for (const id of rule.channelIds) if (enabled.some((channel) => channel.id === id)) ids.add(id);
  }
  return [...ids];
}
function dedupeKey(mail) {
  return [mail.accountId || mail.account || "", mail.sender || "", mail.subject || "", mail.code && mail.code !== "未发现验证码" ? mail.code : ""].map((value) => String(value).trim().toLowerCase()).join("\u001f");
}
module.exports = { DEFAULT_POLICY, normalizePolicy, isQuiet, quietEndsAt, matchingChannelIds, dedupeKey };
