# 部署指南

Docker Compose 是 InboxHarbor 的默认部署方式。Compose 会把应用数据放入命名卷 `inboxharbor-data`，并且只把服务发布到服务器本机的 `127.0.0.1:5555`。

## 宝塔面板安装 Docker

1. 在宝塔面板的软件商店安装“Docker 管理器”；确认它同时安装 Docker Engine 与 Docker Compose 插件。
2. 使用宝塔终端或 SSH 登录服务器，确认：`docker --version` 与 `docker compose version` 都有输出。
3. 选择一个仅管理员可读的目录，例如 `/www/wwwroot/InboxHarbor`。不要让 Web 服务器直接提供该目录中的文件。

## 获取私有仓库

推荐给这台服务器配置仓库专用的只读 Deploy Key。先创建密钥（如果目标文件已经存在，请换一个文件名，不要覆盖）：

```sh
mkdir -p ~/.ssh
chmod 700 ~/.ssh
ssh-keygen -t ed25519 -C "inbox-harbor-server" -f ~/.ssh/inbox_harbor_deploy
cat ~/.ssh/inbox_harbor_deploy.pub
```

复制公钥，在 GitHub 仓库的 `Settings → Deploy keys → Add deploy key` 中添加，不勾选写权限。然后编辑 `~/.ssh/config`，加入：

```sshconfig
Host github-inbox-harbor
    HostName github.com
    User git
    IdentityFile ~/.ssh/inbox_harbor_deploy
    IdentitiesOnly yes
```

保存后执行：

```sh
chmod 600 ~/.ssh/config
ssh -T git@github-inbox-harbor
git clone git@github-inbox-harbor:nbbk/inbox-harbor.git /www/wwwroot/InboxHarbor
cd /www/wwwroot/InboxHarbor
```

若服务器已经有可访问仓库的默认 SSH key，可直接使用 `git@github.com:nbbk/inbox-harbor.git`。不建议把 PAT 写进克隆 URL，它会进入 shell 历史；确需 HTTPS 时，密码提示处填写 fine-grained PAT，而不是 GitHub 登录密码。

## 首次启动

不配置 OAuth 也能先启动。最省事的方式：

```sh
cd /www/wwwroot/InboxHarbor
chmod +x scripts/start-linux.sh
./scripts/start-linux.sh
```

脚本会构建 Node.js 24 镜像、启动容器，并输出程序自动生成的管理口令。无需安装宿主机 Node.js，也无需手工生成口令。

查询管理口令：

```sh
docker compose exec -T inboxharbor npm run credentials
```

## 宝塔 / Nginx 反向代理

Compose 已固定 `127.0.0.1:5555:5555`，不要改成 `0.0.0.0:5555:5555`。在宝塔“网站”中新建域名并配置反向代理到 `http://127.0.0.1:5555`，启用 HTTPS 证书及 WebSocket 支持。外部地址必须写入 `.env`：

```dotenv
PUBLIC_BASE_URL=https://mail.example.com
```

修改后执行 `docker compose up -d`。Google OAuth 回调地址必须精确登记为 `https://mail.example.com/auth/google/callback`。完整 OAuth 创建步骤见 [OAuth 配置](oauth.md)。

## 更新、状态与日志

```sh
cd /www/wwwroot/InboxHarbor
git pull --ff-only
docker compose up -d --build
docker compose ps
docker compose logs -f --tail=200 inboxharbor
```

若 `git pull` 需要凭据，使用已配置的 SSH deploy key 或 Git 凭据管理器；不要将令牌写入 `compose.yaml`。

## 备份与恢复

数据库位于命名卷；默认自动生成的主密钥和管理口令也在同一卷。若通过 `.env` 自定义了主密钥、管理口令或 OAuth 配置，则 `.env` 也是备份的一部分。为保证 SQLite 一致性，先停止应用；备份写入仓库外、仅 root 可读的目录：

```sh
mkdir -p /root/inboxharbor-backups
chmod 700 /root/inboxharbor-backups
docker compose stop inboxharbor
docker run --rm -v inboxharbor-data:/data -v /root/inboxharbor-backups:/backup alpine tar czf /backup/inboxharbor-data-backup.tgz -C /data .
[ ! -f .env ] || install -m 600 .env /root/inboxharbor-backups/inboxharbor.env
docker compose start inboxharbor
```

`.env` 保存 OAuth 应用配置，不在数据卷中，因此存在时也要一并备份。若自定义了 `INBOXHARBOR_ADMIN_TOKEN` 或 `INBOXHARBOR_MASTER_KEY`，它们同样在此文件中。

恢复会覆盖卷内现有数据。先列出归档以验证文件可读：必须包含 `inboxharbor.db`；默认配置还应包含 `inboxharbor.key` 和 `inboxharbor.admin-token`。若密钥或口令由环境变量提供，相应文件可以不存在，但备份目录中必须有包含原值的 `inboxharbor.env`。验证成功后才停止并清空旧数据：

```sh
docker run --rm -v /root/inboxharbor-backups:/backup alpine tar tzf /backup/inboxharbor-data-backup.tgz
docker compose down
docker run --rm -v inboxharbor-data:/data -v /root/inboxharbor-backups:/backup alpine sh -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar xzf /backup/inboxharbor-data-backup.tgz -C /data'
[ ! -f /root/inboxharbor-backups/inboxharbor.env ] || install -m 600 /root/inboxharbor-backups/inboxharbor.env .env
docker compose up -d
```

不要运行 `docker compose down -v`，它会删除命名卷；也不要只恢复数据库而丢失 `inboxharbor.key`。

## 卸载

保留数据的卸载：`docker compose down`。确认不再需要数据后，先完成备份，再执行 `docker compose down -v`。

## 常见错误

- `permission denied`：容器使用非 root 用户；不要手工把命名卷内文件设成 root 所有。若自行改为 bind mount，确保目录可由容器 node 用户写入。
- `OAuth 配置缺失`：在 `.env` 填入对应平台 Client ID；Google 还需要 Client Secret，然后 `docker compose up -d`。
- Google redirect mismatch：核对 `.env` 的 `PUBLIC_BASE_URL` 与控制台登记的回调地址完全一致（含 https、域名和路径）。
- 无法访问面板：先执行 `docker compose ps` 和 `docker compose logs --tail=200 inboxharbor`；Nginx 应代理到 `127.0.0.1:5555`。

## 非 Docker 备用方式

仅适合开发或没有 Docker 的环境。安装 Node.js 24 后，在项目目录运行：

```sh
npm install
npm start
```

默认数据写入项目目录；可用 `DATA_DIR=/安全路径` 指定目录。生产环境仍建议使用 Compose。
