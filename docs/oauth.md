# OAuth 配置（新手向导）

InboxHarbor 不保存邮箱密码。先在网页左侧进入“连接器设置”：一个 Microsoft 应用可授权多个 Microsoft 邮箱，一个 Google 应用同样可授权多个 Gmail/Google Workspace 邮箱，不要为每个邮箱重复创建 OAuth 应用。保存连接器后，再到“邮箱账户”为每一行分别授权；登录地址必须与该行邮箱完全一致。

页面配置会加密保存到数据卷，Google Client Secret 保存后不会回显。若服务器 `.env` 同时配置了同名环境变量，环境变量优先，网页会把对应输入框标记为只读。

如果以后更换某个平台的 Client ID 或 Client Secret，请为该平台已经添加的全部邮箱重新授权；旧 OAuth Token 通常不能直接迁移到新的应用配置。

## Microsoft Outlook / Hotmail / Microsoft 365

1. 直接打开 [Microsoft Entra 应用注册](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)并登录。如果链接只打开首页，菜单路径是“Microsoft Entra ID → 管理 → 应用注册”。
2. 点击“新注册”，名称填写 `InboxHarbor`（也可自定义）。若同时使用个人 Outlook/Hotmail 与组织账号，账户类型选择“任何组织目录中的账户和个人 Microsoft 账户”；只管理自己租户时可选择单租户。重定向 URI 暂时留空，点击“注册”。
3. 创建完成后会进入“概述”。复制“应用程序（客户端）ID”并粘贴到 InboxHarbor 的 Microsoft Client ID。格式示例：`00001111-aaaa-2222-bbbb-3333cccc4444`；不要复制“对象 ID”或“目录（租户）ID”。
4. 在应用左侧进入“管理 → 身份验证 → 高级设置”，启用“允许公共客户端流”。InboxHarbor 使用设备码授权，不需要 Microsoft Client Secret。
5. 进入“管理 → API 权限 → 添加权限 → Microsoft Graph → 委托的权限”，添加 `Mail.Read`；需要发信的账户还要添加 `Mail.Send`，并在 InboxHarbor 开启发信开关后重新授权。

官方参考：[注册 Microsoft 应用](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)、[Microsoft Graph 邮件权限](https://learn.microsoft.com/en-us/graph/permissions-reference)。

## Google Gmail

1. 打开 [Google Cloud 新建项目](https://console.cloud.google.com/projectcreate)并登录。项目名称填写 `InboxHarbor`（也可自定义）；个人账号的“组织/位置”保持“无组织”，企业 Workspace 账号按管理员要求选择。点击“创建”，等待右上角通知显示项目创建完成。
2. 点击 Google Cloud 顶部导航栏中的项目名称，在项目选择器里搜索并选中刚创建的 `InboxHarbor`。后续每打开一个配置链接，都先核对顶部项目名称，防止把 API 或 OAuth 配置添加到其他项目。
3. 打开 [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com)，确认顶部项目正确后点击“启用”；如果显示“管理”，说明已经启用。
4. 打开 [Branding](https://console.cloud.google.com/auth/branding)。若页面显示“Get started”，点击后填写：App name 为 `InboxHarbor`，User support email 选择你的常用邮箱，Developer contact information 填写你的联系邮箱，然后保存并继续。
5. 打开 [Audience](https://console.cloud.google.com/auth/audience)。个人 Gmail 选择 External；企业 Workspace 且仅供本组织账号使用时可选择 Internal。首次配置可先保持 Publishing status 为 Testing，但这是临时测试模式：使用 Gmail 等非基础 scope 时，授权和 refresh token 通常在 7 天后失效，需要重新授权。长期运行前应在该页面点击“Publish app”切换为 Production，并按 Google 页面要求完成必要的应用验证；仅供自己使用的小规模应用也应认真阅读发布页面的提示。
6. 在 Audience 页面找到“Test users”，点击“Add users”，逐个添加每一个准备授权的 Gmail 地址并保存。Testing 状态下，未加入这里的邮箱通常会看到“Access blocked”。
7. 打开 [Data Access](https://console.cloud.google.com/auth/scopes)，点击“Add or remove scopes”，添加 `https://www.googleapis.com/auth/userinfo.email` 和 `https://www.googleapis.com/auth/gmail.readonly`；需要发信时再添加 `https://www.googleapis.com/auth/gmail.send`，然后保存。`userinfo.email` 用于确认授权登录的身份与 InboxHarbor 中填写的邮箱一致。
8. 回到 InboxHarbor“连接器设置”，先填写外部访问地址，例如 `https://mail.example.com`，保存后复制页面生成的 Google 回调地址。这个地址不是网页入口，不要直接在浏览器打开；它只用于粘贴到 Google 控制台。直接打开时出现“这里是 Google OAuth 回调地址，不是登录页面”属于正常现象。
9. 打开 [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients)，点击“Create client”。Application type 必须选择“Web application”，Name 可填 `InboxHarbor Web`。
10. 在 Authorized redirect URIs 点击“Add URI”，粘贴回调地址，例如 `https://mail.example.com/auth/google/callback`。不要填首页地址，也不要多写斜杠，然后点击“Create”。
11. 弹窗中复制 Client ID 与 Client Secret 到 InboxHarbor。Client ID 格式示例：`123456789012-abcdef.apps.googleusercontent.com`；Secret 请完整复制，不能包含空格。
12. 点击“保存并检测配置”。Google 状态显示可用后，再回到邮箱账户逐个授权。若出现 Access blocked，依次检查：当前控制台项目是否正确、该 Gmail 是否在 Test users 中、Gmail API 是否已启用、回调 URI 是否逐字一致。

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
