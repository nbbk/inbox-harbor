"use strict";

// Only these stable, non-sensitive categories may cross an API boundary.
const HEALTH_COPY = Object.freeze({
  normal: { label: "正常", hint: "连接与最近同步正常。" },
  network: { label: "网络异常", hint: "请检查网络或代理设置后重试。" },
  authorization: { label: "需要授权", hint: "请重新完成邮箱授权。" },
  permission: { label: "权限不足", hint: "请确认已授予所需邮箱或渠道权限。" },
  paused: { label: "已暂停", hint: "该邮箱的读取或同步已暂停。" },
  unsynced: { label: "尚未同步", hint: "请完成一次手动同步或等待后台同步。" },
  delivery_failed: { label: "投递失败", hint: "渠道暂未接受本次通知，可在稍后自动重试。" },
});

function textOf(value) {
  if (value instanceof Error) return String(value.message || "");
  return typeof value === "string" ? value : "";
}

function safeFailure(value, fallback = "delivery_failed") {
  const text = textOf(value).toLowerCase();
  let code = fallback;
  if (/timeout|timed out|econn|enotfound|eai_again|network|socket|proxy|网络|超时|连接/.test(text)) code = "network";
  else if (/forbidden|permission|scope|mail\.read|mail\.send|access denied|权限|范围/.test(text)) code = "permission";
  else if (/invalid_grant|invalid token|token.*(?:expired|revoked)|oauth|authorize|授权|登录/.test(text)) code = "authorization";
  const copy = HEALTH_COPY[code] || HEALTH_COPY.delivery_failed;
  return { code, label: copy.label, hint: copy.hint };
}

function accountHealth(account = {}) {
  if (account.readEnabled === false || account.syncEnabled === false) {
    return { state: "paused", code: "paused", ...HEALTH_COPY.paused, lastCheckedAt: account.lastChecked || null, lastSyncedAt: account.lastSyncAt || null, nextSyncAt: account.nextSyncAt || null };
  }
  if (account.syncStatus === "syncing") {
    return { state: "unsynced", code: "unsynced", ...HEALTH_COPY.unsynced, lastCheckedAt: account.lastChecked || null, lastSyncedAt: account.lastSyncAt || null, nextSyncAt: account.nextSyncAt || null };
  }
  if (account.syncStatus === "failed") {
    const failure = safeFailure(account.lastSyncError || account.errorDetail, "unsynced");
    return { state: failure.code, ...failure, lastCheckedAt: account.lastChecked || null, lastSyncedAt: account.lastSyncAt || null, nextSyncAt: account.nextSyncAt || null };
  }
  if (account.status !== "active") {
    const failure = safeFailure(account.errorDetail || "authorization", "authorization");
    return { state: failure.code, ...failure, lastCheckedAt: account.lastChecked || null, lastSyncedAt: account.lastSyncAt || null, nextSyncAt: account.nextSyncAt || null };
  }
  if (!account.lastSyncAt) {
    return { state: "unsynced", code: "unsynced", ...HEALTH_COPY.unsynced, lastCheckedAt: account.lastChecked || null, lastSyncedAt: null, nextSyncAt: account.nextSyncAt || null };
  }
  return { state: "normal", code: "normal", ...HEALTH_COPY.normal, lastCheckedAt: account.lastChecked || null, lastSyncedAt: account.lastSyncAt, nextSyncAt: account.nextSyncAt || null };
}

function isoTime(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

module.exports = { accountHealth, safeFailure, isoTime };
