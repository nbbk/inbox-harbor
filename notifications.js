const crypto = require('crypto');
const CHANNELS = {
  telegram: { name: 'Telegram Bot', icon: '✈', fields: [{ key: 'token', label: 'Bot Token', placeholder: '123456:AA...'}, { key: 'chatId', label: 'Chat ID', placeholder: '-1001234567890'}], guide: '在 @BotFather 创建机器人，将 Token 粘贴至此；把机器人加入目标聊天后填写 Chat ID。' },
  bark: { name: 'Bark (iOS)', icon: '●', fields: [{ key: 'deviceKey', label: 'Device Key', placeholder: 'YOUR_BARK_DEVICE_KEY' }, { key: 'serverUrl', label: '自定义服务器（可选）', placeholder: 'https://api.day.app' }], guide: '打开 Bark iOS 应用，复制 Device Key。官方服务默认使用 https://api.day.app。' },
  wxpusher: { name: 'WxPusher', icon: '◌', fields: [{ key: 'appToken', label: 'AppToken', placeholder: 'AT_xxxxxxxxxxxx' }, { key: 'uids', label: 'UID（多个以逗号分隔）', placeholder: 'UID_xxx,UID_yyy' }], guide: '在 WxPusher 后台创建应用并复制 AppToken；在用户管理中复制 UID。' },
  pushplus: { name: 'PushPlus', icon: '+', fields: [{ key: 'token', label: 'Token', placeholder: '你的 PushPlus Token' }], guide: '登录 pushplus.plus，在 Token 页面复制个人 Token。' },
  serverchan: { name: 'Server酱', icon: 'S', fields: [{ key: 'sendKey', label: 'SendKey', placeholder: 'SCTxxxxxxxxxxxx' }], guide: '在 Server酱 Turbo 后台复制 SendKey。' },
  wecom: { name: '企业微信群机器人', icon: 'W', fields: [{ key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...' }], guide: '在企业微信群添加群机器人，复制 Webhook 地址。' },
  dingtalk: { name: '钉钉群机器人', icon: 'D', fields: [{ key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=...' }, { key: 'secret', label: '加签 Secret（可选）', placeholder: 'SECxxxxxxxxxxxx' }], guide: '在钉钉群机器人设置中复制 Webhook；如启用加签，同时填写 Secret。' },
  email: { name: '电子邮件（SMTP）', icon: '✉', fields: [{ key: 'host', label: 'SMTP Host', placeholder: 'smtp.example.com' }, { key: 'port', label: '端口', placeholder: '465' }, { key: 'secure', label: 'TLS（true / false）', placeholder: 'true' }, { key: 'username', label: '用户名', placeholder: 'notify@example.com' }, { key: 'password', label: 'SMTP 密码或应用专用密码', placeholder: '••••••••' }, { key: 'from', label: '发件人', placeholder: 'InboxHarbor <notify@example.com>' }, { key: 'to', label: '收件人', placeholder: 'you@example.com' }], guide: '填写 SMTP 服务商提供的主机、端口、TLS 及凭据。465 通常使用 true；587 通常使用 false。建议使用专用 SMTP 凭据。' },
  webhook: { name: '通用 Webhook', icon: '↗', fields: [{ key: 'url', label: 'Webhook URL', placeholder: 'https://hooks.example.com/inboxharbor' }, { key: 'headers', label: 'Headers JSON（可选）', placeholder: '{"Authorization":"Bearer ..."}' }], guide: '适用于飞书、n8n 或自建服务。将接收端配置为接受 JSON POST。' }
};

function publicConfig(config = {}) {
  const channels = Array.isArray(config.channels) ? config.channels : [];
  return { includeFullBody: config.includeFullBody !== false, channels: channels.map(channel => ({
    id: channel.id, type: channel.type, enabled: channel.enabled,
    // Credentials are write-only: the browser only learns that a value is present.
    configured: Object.fromEntries(Object.entries(channel.config || {}).map(([key, value]) => [key, Boolean(value)]))
  })) };
}
function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function messageFor(mail = {}) {
  const title = mail.subject || 'InboxHarbor 测试通知';
  const account = mail.account || 'demo@inboxharbor.local';
  const sender = mail.sender || 'InboxHarbor';
  const summary = mail.preview || mail.content || '这是一条来自 InboxHarbor 的测试通知。';
  const receivedAt = mail.receivedAt ? new Date(mail.receivedAt).toLocaleString('zh-CN') : '刚刚';
  const appUrl = mail.appUrl || process.env.PUBLIC_BASE_URL || '';
  const openLink = appUrl ? `<a href="${escapeHtml(appUrl)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#147ea8;color:#fff;text-decoration:none">打开邮件中心</a>` : '<span style="color:#6b7b87">请打开 InboxHarbor 查看完整邮件</span>';
  const content = `【新邮件】\n发件人：${sender}\n账户：${account}\n时间：${receivedAt}\n主题：${title}\n摘要：${summary}\n\n${appUrl ? `查看完整邮件：${appUrl}` : '请打开 InboxHarbor 查看完整邮件'}`;
  const html = `<div style="margin:0;background:#f4f8fa;padding:28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#17324d"><div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #dbe7ec;border-radius:14px;overflow:hidden"><div style="padding:22px 24px;border-bottom:1px solid #e7eef1"><div style="font-size:13px;color:#147ea8;font-weight:700">InboxHarbor · 新邮件提醒</div><h1 style="margin:10px 0 0;font-size:22px;line-height:1.35">${escapeHtml(title)}</h1></div><div style="padding:20px 24px"><div style="font-size:14px;line-height:1.8;color:#526879"><b style="color:#17324d">${escapeHtml(sender)}</b><br>发送至 ${escapeHtml(account)}<br>${escapeHtml(receivedAt)}</div><div style="margin-top:18px;padding:16px;background:#f5fafb;border-radius:10px;white-space:pre-wrap;line-height:1.7">${escapeHtml(summary)}</div><div style="margin-top:22px">${openLink}</div></div></div></div>`;
  return { title, content, html };
}
async function postJson(url, payload, headers = {}) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}
function dingtalkSignedUrl(webhookUrl, secret, timestamp = Date.now().toString()) {
  const sign = crypto.createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64');
  const parsed = new URL(webhookUrl); parsed.searchParams.set('timestamp', timestamp); parsed.searchParams.set('sign', sign); return parsed.toString();
}
function validateEmailConfig(config = {}) {
  for (const key of ['host', 'port', 'username', 'password', 'from', 'to']) if (!String(config[key] || '').trim()) throw new Error(`SMTP 缺少 ${key} 配置`);
  const port = Number(config.port); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP 端口无效');
  return { host: config.host, port, secure: String(config.secure).toLowerCase() === 'true', auth: { user: config.username, pass: config.password }, from: config.from, to: config.to };
}
async function send(channel, message) {
  const c = channel.config || {};
  switch (channel.type) {
    case 'telegram': return postJson(`https://api.telegram.org/bot${c.token}/sendMessage`, { chat_id: c.chatId, text: `${message.title}\n\n${message.content}` });
    case 'bark': return postJson(`${(c.serverUrl || 'https://api.day.app').replace(/\/$/, '')}/push`, { device_key: c.deviceKey, title: message.title, body: message.content });
    case 'wxpusher': return postJson('https://wxpusher.zjiecode.com/api/send/message', { appToken: c.appToken, content: `${message.title}\n\n${message.content}`, summary: message.title, contentType: 1, uids: String(c.uids || '').split(',').map(x => x.trim()).filter(Boolean) });
    case 'pushplus': return postJson('https://www.pushplus.plus/send', { token: c.token, title: message.title, content: message.content, template: 'txt' });
    case 'serverchan': return postJson(`https://sctapi.ftqq.com/${c.sendKey}.send`, { title: message.title, desp: message.content });
    case 'wecom': return postJson(c.webhookUrl, { msgtype: 'text', text: { content: `${message.title}\n\n${message.content}` } });
    case 'dingtalk': {
      let url = c.webhookUrl;
      if (c.secret) {
        url = dingtalkSignedUrl(url, c.secret);
      }
      return postJson(url, { msgtype: 'text', text: { content: `${message.title}\n\n${message.content}` } });
    }
    case 'email': {
      const smtp = validateEmailConfig(c); let nodemailer;
      try { nodemailer = require('nodemailer'); } catch { throw new Error('未安装 nodemailer；请执行 npm install。'); }
      const transporter = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, auth: smtp.auth });
      return transporter.sendMail({ from: smtp.from, to: smtp.to, subject: message.title, text: message.content, html: message.html });
    }
    case 'webhook': { let extra = {}; try { extra = c.headers ? JSON.parse(c.headers) : {}; } catch { throw new Error('Headers JSON 格式不正确'); } return postJson(c.url, { title: message.title, content: message.content, source: 'InboxHarbor' }, extra); }
    default: throw new Error('未知通知渠道');
  }
}
async function sendAll(config, mail) {
  const message = messageFor(mail);
  return Promise.allSettled((config.channels || []).filter(c => c.enabled).map(c => send(c, message)));
}
module.exports = { CHANNELS, publicConfig, send, sendAll, messageFor, dingtalkSignedUrl, validateEmailConfig };
