<div align="center">

# ⚓ InboxHarbor（收件港）
### 本机优先的个人邮箱管理台

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg?style=flat-square&logo=node.js)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-orange.svg?style=flat-square)](https://github.com/nbbk/inbox-harbor)

**为个人邮箱收件、验证码、完整正文通知而设计的本机优先管理台。默认只读，可按账户开启发信权限。**

[功能特性](#-核心功能特性) • [Docker 部署](docs/deployment.md) • [OAuth 配置](docs/oauth.md) • [运维](docs/operations.md) • [安全与隐私](#-安全与隐私声明)

</div>

---

## 🌟 核心功能特性

- 🌐 **多邮局统一集成管理**
  - 原生支持 **Microsoft (Outlook / Hotmail / Office365)** 与 **Google (Gmail)** 双平台。
  - 批量监控账号活跃状态，一键在线健康检测。
- ⚡ **克制的增量取件**
  - 突破传统单线程排队轮询限制，支持所有纳管账号全并发异步取件，新邮件与验证码秒级同步呈现。
- 🔑 **智能验证码与链接剥离**
  - 内置智能解析引擎，自动从邮件正文中精确提取 4~8 位数字/字母验证码以及一次性激活/解封跳转链接。
- 📋 **清晰的账户与权限管理**
  - 按账户查看读取/发信权限，敏感凭据不通过普通列表接口回显。
- 📢 **多渠道完整正文通知**
  - 支持 Telegram、Bark（iOS）、WxPusher、PushPlus、Server酱、企业微信、钉钉及通用 Webhook。
  - 内置指纹级去重机制与本地代理网络支持（HTTP / SOCKS5），在国内网络环境亦可稳定推送。
- 📥 **OAuth-only 账户接入**
  - 只填写邮箱地址，再通过 Microsoft 或 Google 官方 OAuth 授权；不保存邮箱登录密码。
- 🎨 **克制的响应式界面**
  - 白底、深海军蓝与海蓝强调色；适配桌面、平板和手机。

---

## 🚀 快速开始

### 默认方式：Docker Compose

生产与宝塔部署请使用 Docker Compose，而不是直接运行 Node。仓库为公开仓库，无需 GitHub 账号、密码、Token 或 SSH Key，直接执行：

```sh
git clone https://github.com/nbbk/inbox-harbor.git /www/wwwroot/InboxHarbor
cd /www/wwwroot/InboxHarbor
chmod +x scripts/start-linux.sh
./scripts/start-linux.sh
```

Compose 仅发布 `127.0.0.1:5555`，适合再由宝塔/Nginx 反向代理。完整的源码下载、宝塔 Docker、OAuth、更新、备份恢复与卸载说明见 [部署指南](docs/deployment.md)。

### 手动启动（不使用一键脚本）

```sh
cd /www/wwwroot/InboxHarbor
docker compose build --pull
docker compose up -d
docker compose ps
docker compose exec -T inboxharbor npm run credentials
```

### 更新到最新版

第一次更新或遇到 `detected dubious ownership` 时执行下面的完整命令。这里只信任 InboxHarbor 的准确目录，不要使用 `safe.directory '*'`：

```sh
git config --global --add safe.directory /www/wwwroot/InboxHarbor
cd /www/wwwroot/InboxHarbor
git remote set-url origin https://github.com/nbbk/inbox-harbor.git
git pull --ff-only origin main
docker compose up -d --build
docker compose ps
```

完成这次更新后，也可使用项目自带更新脚本：

```sh
cd /www/wwwroot/InboxHarbor
chmod +x scripts/update-linux.sh
./scripts/update-linux.sh
```

### 非 Docker 备用方式

仅用于开发或没有 Docker 的机器：

```sh
node --version
npm --version
npm ci --omit=dev
npm start
```

`node --version` 必须显示 `v24` 或更高版本。`npm start` 为前台运行，关闭终端程序会停止；生产服务器优先使用上面的 Docker Compose 方式。

首次启动会自动生成高强度管理口令，持久保存在项目目录的 `inboxharbor.admin-token`，并在终端显示一次。以后重启继续使用同一个口令；忘记时运行 `npm run credentials` 查询。该文件已被 Git 忽略，请勿上传或公开。

服务在没有 OAuth 配置时也能正常启动。首次登录后进入“连接器设置”，页面会自动生成 Google 回调地址，并提供 Microsoft、Google 的逐步配置教程、格式示例、保存和检测功能。Microsoft/Google Client ID（以及 Google Client Secret）仍需由对应平台签发，无法由本机自动生成；每个平台只需配置一次，此后列表中的每个邮箱都可以分别授权。页面保存的 Secret 会进入 AES-256-GCM 加密数据库且不会回显。环境变量仍可作为高级部署方式使用，并优先于页面配置：`MICROSOFT_CLIENT_ID`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`PUBLIC_BASE_URL`。

### 本地加密存储与备份

状态（包括 OAuth refresh token 与通知凭据）保存在 `inboxharbor.db`，并由 AES-256-GCM 加密。主密钥优先使用 `INBOXHARBOR_MASTER_KEY`（64 位 hex 或 32 字节 base64）；未设置时首次启动会生成同目录的 `inboxharbor.key`。备份或迁移时必须同时保存数据库和对应主密钥：默认模式备份 `inboxharbor.db` 与 `inboxharbor.key`，环境变量模式则备份包含原主密钥的 `.env`。遗失主密钥将无法恢复已保存的凭据。旧版 `data.json` 会在第一次启动时导入，原文件会保留且不会被删除。

### 运行环境
- **Node.js**: >= 24（使用内置 SQLite）
- **操作系统**: Windows / macOS / Linux

Docker 环境无需在宿主机安装 Node.js。直接运行模式才需要 Node.js 24；Windows 可使用 `install.bat` 与 `start.bat`，详细限制见部署指南的“非 Docker 备用方式”。

## 邮箱权限

- 读取邮件默认开启；Microsoft 使用 `Mail.Read`，Google 使用 `gmail.readonly`。
- 发信权限默认关闭。只有在账户页主动开启后，下一次 OAuth 授权才会申请 Microsoft `Mail.Send` 或 Google `gmail.send`。
- 修改发信开关后必须重新授权该账户；服务端也会拒绝未开启发信权限的发送请求。

## 邮件中心与发信

- 邮件中心会把 HTML 邮件转换为安全、可读且保留段落的纯文本，不执行邮件里的脚本、样式或远程图片。
- 邮件会按内容自动归入验证码、通知、账单、社交、推广或其他；可按分类、邮箱账户和关键词筛选。
- 验证码邮件会单独突出验证码并提供复制按钮。
- 点击邮件中心右上角“写邮件”，选择已开启发信权限且重新授权成功的账户，填写收件人、主题和正文即可发送。
- 发送成功的邮件会进入“已发送”分类，显示发件账户、收件人、主题、正文和发送时间。
- 阅读面板提供“删除邮件”；删除仅作用于 InboxHarbor 本地归档，不会删除邮箱服务商服务器上的原邮件，并会避免同一封收件再次被同步回来。
- 当前发送正文为纯文本。Google 通过 Gmail API 发送，Microsoft 通过 Microsoft Graph 发送；上游拒绝时页面会显示失败，不会伪报成功。

## 通知渠道配置

通知页默认发送完整邮件正文。关闭“完整正文”后只发送摘要。所有密钥字段均为只写：保存后界面只显示“已配置”，不会回显原值。

| 渠道 | 必填参数 | 格式示例 |
| --- | --- | --- |
| Telegram | `token`, `chatId` | `123456:AA...`, `-1001234567890` |
| Bark（iOS） | `deviceKey` | `YOUR_BARK_DEVICE_KEY`；服务器默认为 `https://api.day.app` |
| WxPusher | `appToken`, `uids` | `AT_xxx`, `UID_xxx,UID_yyy` |
| PushPlus | `token` | PushPlus 个人 Token |
| Server酱 | `sendKey` | `SCTxxxxxxxxxxxx` |
| SMTP 邮件 | `host`, `port`, `secure`, `username`, `password`, `from`, `to` | `smtp.example.com`, `465`, `true` |
| 企业微信群机器人 | `webhookUrl` | `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...` |
| 钉钉群机器人 | `webhookUrl` | `https://oapi.dingtalk.com/robot/send?access_token=...` |
| 通用 Webhook | `url`, 可选 `headers` | `https://hooks.example.com/inboxharbor`，Headers 为 JSON 对象 |

各渠道的“配置”说明：

1. Telegram：向 `@BotFather` 创建机器人并取得 Bot Token；把机器人加入目标私聊或群组后填写 Chat ID。
2. Bark：在 iPhone 安装 Bark，复制应用显示的 Device Key。自建 Bark 服务时再填写服务器地址。
3. WxPusher：在 WxPusher 后台创建应用，复制 AppToken；在用户管理中复制 UID，多个 UID 用英文逗号分隔。
4. PushPlus：登录 PushPlus 后复制个人 Token。
5. Server酱：在 Server酱 Turbo 后台复制 SendKey。
6. 企业微信：在目标企业微信群中添加群机器人，复制完整 Webhook URL。
7. SMTP：从邮箱服务商获取 SMTP 主机、端口和应用专用密码；465 通常设 `secure=true`，587 通常设 `false`。
8. 钉钉：在目标群中添加自定义机器人；如启用加签，同时填写 Secret。
9. 通用 Webhook：接收端需接受 JSON `POST`。发送体包含 `title`、`content` 和 `source`，可直接接入飞书中转服务、n8n 或自建接口。Headers 示例：`{"Authorization":"Bearer YOUR_TOKEN"}`。

每个渠道都提供独立“测试”按钮。请先填参数并测试，再启用并保存。

## 开发验证

```bash
npm test
npm run test:ui
```

UI 测试覆盖 1440px 桌面和 390px 手机布局，需要先以 `INBOXHARBOR_ADMIN_TOKEN=qa-local-token` 启动服务。

---

## 📖 使用指南

1. 在“邮箱账户”页点击“添加邮箱”；可一次粘贴多个地址，以换行、逗号或分号分隔，系统会自动识别平台并去重。
2. 点击账户的“授权”，在 Microsoft 或 Google 官方页面完成 OAuth。
3. 需要发信时打开“允许发信”，然后重新授权；回到“概览”点击“写邮件”。
4. 在邮件中心可按验证码、通知、账单、社交、推广和其他类别筛选，也可按账户或关键词查找。
5. 使用“手动取件”同步邮件，或启用任一通知渠道进行后台轮询。

---

## 🛡️ 安全与隐私声明

- 🔒 **本地自托管**：InboxHarbor 默认仅监听 `127.0.0.1`，状态加密保存在 `inboxharbor.db`。
- 🚫 **零云端遥测与上传**：本开源仓库不包含任何私有遥测、后门或云端上报逻辑，不会向任何未授权的第三方服务器发送您的凭据。
- ⚠️ **安全警告**：请同时保管 `inboxharbor.db` 和 `inboxharbor.key`，切勿上传到代码托管平台。旧 `data.json` 如存在，仅作迁移备份处理。

---

## 🤝 贡献与反馈

欢迎提交 Issue 与 Pull Request！如果您觉得这个项目对您有所帮助，请为它点亮一个 ⭐️ **Star**！

---

## 📄 开源协议

本项目采用 [MIT License](LICENSE) 开源协议。
