"use strict";

// Only these stable, non-sensitive categories may cross an API boundary.
const HEALTH_COPY = Object.freeze({
  normal: { label: "正常", hint: "连接与最近同步正常。" },
  network: { label: "网络异常", hint: "请检查网络或代理设置后重试。" },
  authorization: { label: "需要授权", hint: "请重新完成邮箱授权。" },
  permission: { label: "权限不足", hint: "请确认已授予所需邮箱或渠道权限。" },
  configuration: { label: "连接器配置异常", hint: "请由 Owner 检查连接器配置后重试。" },
  sync_failed: { label: "同步失败", hint: "本次同步未完成，请稍后重试；持续失败时联系管理员。" },
  syncing: { label: "同步中", hint: "正在检查新邮件，请稍候。" },
  unsupported: { label: "历史账户", hint: "当前仅支持 Google 和 Microsoft OAuth，请重新添加受支持的邮箱。" },
  paused: { label: "已暂停", hint: "该邮箱的读取或同步已暂停。" },
  unsynced: { label: "尚未同步", hint: "请完成一次手动同步或等待后台同步。" },
  official_target: { label: "必须使用官方地址", hint: "成员和管理员只能使用该渠道的官方服务地址。" },
  owner_only: { label: "仅 Owner 可配置", hint: "请联系 Owner 配置此类通知渠道。" },
  private_target: { label: "不能使用内网地址", hint: "通知目标不能指向本机或内网，请检查渠道地址。" },
  channel_configuration: { label: "渠道配置不完整或格式无效", hint: "请检查该渠道的必填字段和地址格式后重新测试。" },
  delivery_failed: { label: "投递失败", hint: "渠道暂未接受本次通知，请检查渠道设置与重试状态。" },
});

function textOf(value) {
  if (value instanceof Error) return String(value.message || "");
  return typeof value === "string" ? value : "";
}

function safeFailure(value, fallback = "delivery_failed") {
  const text = textOf(value).toLowerCase();
  let code = Object.hasOwn(HEALTH_COPY, text) ? text : fallback;
  if (/官方地址/.test(text)) code = "official_target";
  else if (/仅 owner/.test(text)) code = "owner_only";
  else if (/内网|链路本地/.test(text)) code = "private_target";
  else if (/smtp.*(?:缺少|端口)|webhook.*缺少|headers json|必须是有效|仅允许 http|不允许包含用户信息/.test(text)) code = "channel_configuration";
  else if (/未配置|配置.*缺失|invalid_client|client.*(?:missing|secret)|客户端.*配置/.test(text)) code = "configuration";
  else if (/timeout|timed out|econn|enotfound|eai_again|network|socket|proxy|网络|超时|连接/.test(text)) code = "network";
  else if (/forbidden|permission|scope|mail\.read|mail\.send|access denied|权限|范围/.test(text)) code = "permission";
  else if (/invalid_grant|invalid token|token.*(?:expired|revoked)|oauth|authorize|授权|登录/.test(text)) code = "authorization";
  const copy = HEALTH_COPY[code] || HEALTH_COPY.delivery_failed;
  return { code, label: copy.label, hint: copy.hint };
}

function accountHealth(account = {}) {
  if (account.provider && !["google", "microsoft"].includes(account.provider)) return { state: "unsupported", code: "unsupported", ...HEALTH_COPY.unsupported, lastCheckedAt: account.lastChecked || null, lastSyncedAt: account.lastSyncAt || null, nextSyncAt: null };
  if (account.readEnabled === false || account.syncEnabled === false) {
    return { state: "paused", code: "paused", ...HEALTH_COPY.paused, lastCheckedAt: account.lastChecked || null, lastSyncedAt: account.lastSyncAt || null, nextSyncAt: account.nextSyncAt || null };
  }
  if (account.syncStatus === "syncing") {
    return { state: "syncing", code: "syncing", ...HEALTH_COPY.syncing, lastCheckedAt: account.lastChecked || null, lastSyncedAt: account.lastSyncAt || null, nextSyncAt: account.nextSyncAt || null };
  }
  if (account.syncStatus === "failed") {
    const failure = safeFailure(account.lastSyncError || account.errorDetail, "sync_failed");
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
