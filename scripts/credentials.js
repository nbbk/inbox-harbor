const fs = require('fs');
const path = require('path');
const { tokenPath } = require('../instance-config');

const file = tokenPath(path.join(__dirname, '..'));
if (process.env.INBOXHARBOR_ADMIN_TOKEN) {
  console.log(`管理口令（来自环境变量）：${process.env.INBOXHARBOR_ADMIN_TOKEN}`);
} else if (fs.existsSync(file)) {
  console.log(`管理口令：${fs.readFileSync(file, 'utf8').trim()}`);
} else {
  console.log('尚未生成管理口令。请先运行 npm start。');
}
console.log(`Microsoft OAuth：${process.env.MICROSOFT_CLIENT_ID ? '已通过环境变量配置' : '未配置（可启动，授权前再设置）'}`);
console.log(`Google OAuth：${process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? '已通过环境变量配置' : '未配置（可启动，授权前再设置）'}`);
