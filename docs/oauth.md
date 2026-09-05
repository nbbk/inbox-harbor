# OAuth 配置（新手向导）

InboxHarbor 不保存邮箱密码。先在网页左侧进入“连接器设置”：一个 Microsoft 应用可授权多个 Microsoft 邮箱，一个 Google 应用同样可授权多个 Gmail/Google Workspace 邮箱，不要为每个邮箱重复创建 OAuth 应用。保存连接器后，再到“邮箱账户”为每一行分别授权；登录地址必须与该行邮箱完全一致。

页面配置会加密保存到数据卷，Google Client Secret 保存后不会回显。若服务器 `.env` 同时配置了同名环境变量，环境变量优先，网页会把对应输入框标记为只读。

如果以后更换某个平台的 Client ID 或 Client Secret，请为该平台已经添加的全部邮箱重新授权；旧 OAuth Token 通常不能直接迁移到新的应用配置。

## Microsoft Outlook / Hotmail / Microsoft 365

1. 登录 [Microsoft Entra 管理中心](https://entra.microsoft.com/)，进入“应用注册”，选择“新注册”。
2. 若同时使用个人 Outlook/Hotmail 与组织账号，账户类型选择“任何组织目录中的账户和个人 Microsoft 账户”；只管理自己租户时可选择单租户。
3. 创建后在“概述”复制“应用程序（客户端）ID”，粘贴到网页的 Microsoft Client ID。格式示例：`00001111-aaaa-2222-bbbb-3333cccc4444`。
4. 在“身份验证”中启用“允许公共客户端流”。InboxHarbor 使用设备码授权，不需要 Microsoft Client Secret。
5. 在“API 权限”添加 Microsoft Graph 委托权限 `Mail.Read`；需要发信的账户会在开启发信开关并重新授权后请求 `Mail.Send`。

官方参考：[注册 Microsoft 应用](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)、[Microsoft Graph 邮件权限](https://learn.microsoft.com/en-us/graph/permissions-reference)。

## Google Gmail

1. 在 [Google Cloud Console](https://console.cloud.google.com/) 新建或选择项目，搜索 Gmail API 并点击“启用”。
2. 进入“Google Auth Platform”。依次完成 Branding（应用名称与支持邮箱）、Audience（个人部署通常选 External）和 Data Access。
3. 应用处于 Testing 时，在 Audience → Test users 中添加每一个需要授权的 Gmail；否则这些邮箱会看到“Access blocked”。
4. 回到 InboxHarbor“连接器设置”，先填写外部访问地址，例如 `https://mail.example.com`，保存后复制页面生成的 Google 回调地址。
5. 在 Google Auth Platform → Clients 创建客户端，Application type 必须选择“Web application”。
6. 在 Authorized redirect URIs 中粘贴回调地址，例如 `https://mail.example.com/auth/google/callback`。不要填首页地址，也不要多写斜杠。
7. 创建后复制 Client ID 与 Client Secret 到 InboxHarbor。Client ID 格式示例：`123456789012-abcdef.apps.googleusercontent.com`；Secret 请完整复制，不能包含空格。
8. 点击“保存并检测配置”。Google 状态显示可用后，再回到邮箱账户逐个授权。

回调 URI 必须与 `PUBLIC_BASE_URL` 拼接出的地址完全一致，包括协议、域名、端口、大小写和结尾斜杠。InboxHarbor 默认请求 `gmail.readonly`；仅在账户页主动开启发信并重新授权后增加 `gmail.send`。

官方参考：[Gmail 服务端 OAuth](https://developers.google.com/workspace/gmail/api/auth/web-server)、[Google Web Server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)、[Google OAuth scopes](https://developers.google.com/identity/protocols/oauth2/scopes)。

## 推荐：在网页中保存

进入“连接器设置”填写并点击“保存并检测配置”。外部访问地址必须是完整的 HTTPS 站点根地址，不得包含 `/admin` 等路径、查询参数或账号密码；只有本机调试允许 `http://localhost:5555`。

如果点击邮箱“授权”时尚未配置，页面会自动切换到连接器设置。Google 回调地址必须与 Google 控制台登记值逐字一致，包括协议、域名、端口和路径。

## 高级方式：环境变量

也可以在项目根目录创建或编辑 `.env`。环境变量会覆盖网页保存值，适合集中运维；不要提交该文件。可先复制安全模板：`cp .env.example .env`。

```dotenv
MICROSOFT_CLIENT_ID=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
PUBLIC_BASE_URL=https://mail.example.com
```

保存后重建容器以应用配置：

```sh
docker compose up -d
docker compose logs --tail=100 inboxharbor
```

然后进入 InboxHarbor 的“邮箱账户”，可一次粘贴多个地址（换行、逗号或分号分隔）。每个邮箱需要各自完成一次用户授权，但不需要重复创建 OAuth 应用。如果某个邮箱开启发信权限，需要为该邮箱重新授权以取得 `Mail.Send` 或 `gmail.send`。
