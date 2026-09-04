# OAuth 配置

InboxHarbor 不保存邮箱密码。一个 Microsoft 应用可授权多个 Microsoft 邮箱；一个 Google 应用同样可授权多个 Gmail 邮箱。不要为每个邮箱重复创建 OAuth 应用。

## Microsoft Outlook / Hotmail / Microsoft 365

1. 登录 Microsoft Entra 管理中心，进入“应用注册”，新建注册。
2. 若同时使用个人 Outlook/Hotmail 与组织账号，账户类型选择“任何组织目录中的账户和个人 Microsoft 账户”；只管理自己租户时可选择单租户。
3. 复制“应用程序（客户端）ID”，填入 `MICROSOFT_CLIENT_ID`。
4. 在“身份验证”中启用“允许公共客户端流”。InboxHarbor 使用设备码授权，不需要 Microsoft Client Secret。
5. 在“API 权限”添加 Microsoft Graph 委托权限 `Mail.Read`；需要发信的账户会在开启发信开关并重新授权后请求 `Mail.Send`。

官方参考：[注册 Microsoft 应用](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)、[Microsoft Graph 邮件权限](https://learn.microsoft.com/en-us/graph/permissions-reference)。

## Google Gmail

1. 在 Google Cloud Console 新建或选择项目，启用 Gmail API。
2. 配置 OAuth 同意屏幕；测试状态下把所有实际 Gmail 地址加入“测试用户”。
3. 创建“Web application”类型的 OAuth Client。
4. 添加已获 HTTPS 保护的授权重定向 URI：`https://mail.example.com/auth/google/callback`。
5. 复制 Client ID 与 Client Secret，分别填入 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`。

回调 URI 必须与 `PUBLIC_BASE_URL` 拼接出的地址完全一致，包括协议、域名、端口、大小写和结尾斜杠。InboxHarbor 默认请求 `gmail.readonly`；仅在账户页主动开启发信并重新授权后增加 `gmail.send`。

官方参考：[Gmail 服务端 OAuth](https://developers.google.com/workspace/gmail/api/auth/web-server)、[Google Web Server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)、[Google OAuth scopes](https://developers.google.com/identity/protocols/oauth2/scopes)。

## 写入服务器配置

在项目根目录创建或编辑 `.env`，不要提交该文件。示例中的域名和凭据必须替换：

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

然后进入 InboxHarbor 的“邮箱账户”，可一次粘贴多个地址（换行、逗号或分号分隔）。每个邮箱需要各自完成一次用户授权，但不需要重复创建 OAuth 应用。
