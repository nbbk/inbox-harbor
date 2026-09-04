<div align="center">

# ⚡ MailPulse
### 现代化多邮局极速管理控制台 (Microsoft & Google Dual Engine)

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen.svg?style=flat-square&logo=node.js)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-orange.svg?style=flat-square)](https://github.com/)

**专为批量多邮箱运维、验证码流监控、Telegram 实时推送设计的轻量极速管理面板**

[功能特性](#-核心功能特性) • [快速开始](#-快速开始) • [使用指南](#-使用指南) • [安全与隐私](#-安全与隐私声明) • [开源协议](#-开源协议)

</div>

---

## 🌟 核心功能特性

- 🌐 **多邮局统一集成管理**
  - 原生支持 **Microsoft (Outlook / Hotmail / Office365)** 与 **Google (Gmail)** 双平台。
  - 批量监控账号活跃状态，一键在线健康检测。
- ⚡ **全并发秒级实时取件**
  - 突破传统单线程排队轮询限制，支持所有纳管账号全并发异步取件，新邮件与验证码秒级同步呈现。
- 🔑 **智能验证码与链接剥离**
  - 内置智能解析引擎，自动从邮件正文中精确提取 4~8 位数字/字母验证码以及一次性激活/解封跳转链接。
- 📋 **极速一键复制交互**
  - 邮箱列表配备显眼的大号高亮 **【复制邮箱】**、**【复制密码】** 按钮，支持单击文本直接写入系统剪贴板。
- 📢 **Telegram 实时推送与智能去重**
  - 支持将最新邮件、验证码实时推送到指定的 Telegram 群组或个人私聊。
  - 内置指纹级去重机制与本地代理网络支持（HTTP / SOCKS5），在国内网络环境亦可稳定推送。
- 📥 **灵活批量导入与导出**
  - 支持 `邮箱账号----密码----Token/备注` 格式的文本或 CSV 批量导入与更新。
  - 支持一键导出脱敏/明文的微软邮箱账号密码 TXT 与 CSV 表格。
- 🎨 **沉浸式暗黑科技风看板**
  - 高对比度视觉层次设计，实时展示收件流大厅与验证码大屏，界面轻盈流畅。

---

## 🚀 快速开始

### 运行环境
- **Node.js**: >= 16.0.0
- **操作系统**: Windows / macOS / Linux

### 方式一：Windows 用户（一键双击）
1. [下载代码压缩包](https://github.com/) 或 `git clone` 到本地；
2. 双击运行 **`install.bat`** 自动安装依赖；
3. 双击运行 **`start.bat`** 启动控制台；
4. 浏览器访问 **`http://localhost:5555`** 即可开始使用。

---

### 方式二：命令行启动 (Linux / macOS / Windows)

```bash
# 1. 克隆仓库
git clone https://github.com/your-username/MailPulse.git
cd MailPulse

# 2. 安装依赖
npm install

# 3. 启动服务
npm start
```

启动成功后，控制台输出：
```text
====================================================
 ⚡ MailPulse - 现代化多邮局极速管理控制台
 🚀 访问地址: http://localhost:5555
====================================================
```
打开浏览器访问 `http://localhost:5555` 即可。

---

## 📖 使用指南

### 1. 批量导入账号
点击左侧菜单 **【批量导入账号】**，粘贴您的账号数据，每行一条：
```text
user1@outlook.com----your_password----oauth_refresh_token_or_remark
user2@gmail.com----your_app_password
```
点击 **【确认批量导入】**，系统将自动识别服务商并存入本地数据库。

### 2. 配置 Telegram Bot 实时通知
1. 点击右上角 **【⚙️ TG 推送设置】** 按钮；
2. 填入您的 `Telegram Bot Token` 与 `Chat ID`；
3. 勾选 **【开启 Telegram 推送】**；
4. 点击 **【发送测试消息】**，确认 Telegram 收到测试推送后保存即可。

### 3. 一键导出
在主列表面板顶栏，点击 **【导出微软账号密码TXT】** 或 **【导出 CSV】**，浏览器将直接下载整洁的账号清单。

---

## 🛡️ 安全与隐私声明

- 🔒 **100% 本地自托管**：MailPulse 是完全独立的单机自托管系统，所有账号数据、密码及收件记录仅保存在本地的 `data.json` 中。
- 🚫 **零云端遥测与上传**：本开源仓库不包含任何私有遥测、后门或云端上报逻辑，不会向任何未授权的第三方服务器发送您的凭据。
- ⚠️ **安全警告**：请妥善保管好您本地运行目录下的 `data.json`，切勿将其公开上传至任何代码托管平台。

---

## 🤝 贡献与反馈

欢迎提交 Issue 与 Pull Request！如果您觉得这个项目对您有所帮助，请为它点亮一个 ⭐️ **Star**！

---

## 📄 开源协议

本项目采用 [MIT License](LICENSE) 开源协议。
