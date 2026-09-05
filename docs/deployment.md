# 部署指南

Docker Compose 是 InboxHarbor 的默认部署方式。Compose 会把应用数据放入命名卷 `inboxharbor-data`，并且只把服务发布到服务器本机的 `127.0.0.1:5555`。

## 宝塔面板安装 Docker

1. 在宝塔面板的软件商店安装“Docker 管理器”；确认它同时安装 Docker Engine 与 Docker Compose 插件。
2. 使用宝塔终端或 SSH 登录服务器，确认：`docker --version` 与 `docker compose version` 都有输出。
3. 选择一个仅管理员可读的目录，例如 `/www/wwwroot/InboxHarbor`。不要让 Web 服务器直接提供该目录中的文件。

## 下载源码

仓库为公开仓库。服务器无需登录 GitHub，也不需要配置账号密码、Personal Access Token、SSH Key 或自定义 SSH 主机别名。首次安装直接使用 HTTPS 克隆：

```sh
git clone https://github.com/nbbk/inbox-harbor.git /www/wwwroot/InboxHarbor
cd /www/wwwroot/InboxHarbor
```

如果 `/www/wwwroot/InboxHarbor` 已经存在且此前就是该仓库，不要再次执行 `git clone`，请按下方“更新、状态与日志”运行 `git pull --ff-only origin main`。如果目录存在但不是 Git 仓库，请先备份其中的数据并换一个空目录，避免覆盖现有文件。

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

## Docker 手动部署（不使用一键脚本）

如果希望逐条确认每一步，可不用 `scripts/start-linux.sh`，直接执行：

```sh
cd /www/wwwroot/InboxHarbor
docker --version
docker compose version
docker compose build --pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 inboxharbor
docker compose exec -T inboxharbor npm run credentials
```

看到容器状态为 `healthy` 后，通过 `http://127.0.0.1:5555` 或已配置的反向代理域名访问。若状态不是 `healthy`，先查看上面的日志，不要反复删除数据卷。

## 宝塔 / Nginx 反向代理

Compose 已固定 `127.0.0.1:5555:5555`，不要改成 `0.0.0.0:5555:5555`。在宝塔“网站”中新建域名并配置反向代理到 `http://127.0.0.1:5555`，启用 HTTPS 证书及 WebSocket 支持。登录 InboxHarbor 后进入“连接器设置”，把外部访问地址填写为完整 HTTPS 域名，例如 `https://mail.example.com`，再按页面向导配置 Google 与 Microsoft。

也可以使用高级环境变量方式，在 `.env` 中设置：

```dotenv
PUBLIC_BASE_URL=https://mail.example.com
```

使用 `.env` 时执行 `docker compose up -d --force-recreate` 使其生效。Google OAuth 回调地址必须精确登记为 `https://mail.example.com/auth/google/callback`。完整 OAuth 创建步骤见 [OAuth 配置](oauth.md)。

## 更新、状态与日志

### 第一次更新或修复 dubious ownership

如果出现 `fatal: detected dubious ownership in repository`，说明当前执行 Git 的系统用户与目录所有者不同。对这个准确目录添加信任，然后更新；不要设置 `safe.directory '*'`：

```sh
git config --global --add safe.directory /www/wwwroot/InboxHarbor
cd /www/wwwroot/InboxHarbor
git remote set-url origin https://github.com/nbbk/inbox-harbor.git
git pull --ff-only origin main
docker compose up -d --build
docker compose ps
docker compose logs -f --tail=200 inboxharbor
```

`git config` 只需成功执行一次。公开仓库正常执行 `git pull` 不需要凭据；上述 `git remote set-url` 会同时修正旧 SSH 地址和错误远端。

### 后续一键更新

```sh
cd /www/wwwroot/InboxHarbor
chmod +x scripts/update-linux.sh
./scripts/update-linux.sh
```

脚本会核对仓库根目录，并在发现任何已跟踪修改或非忽略的未跟踪文件时停止；工作区干净后才会仅快进拉取 `origin/main`、重建容器并显示状态。请按提示运行 `git status` 检查，不要使用 `git reset --hard`。

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
- `detected dubious ownership`：执行 `git config --global --add safe.directory /www/wwwroot/InboxHarbor`，然后重新运行 `git pull --ff-only origin main`；不要使用通配符信任所有仓库。
- `OAuth 配置缺失`：进入网页“连接器设置”，填写对应平台 Client ID；Google 还需要 Client Secret，然后点击“保存并检测配置”。
- Google redirect mismatch：复制“连接器设置”页面生成的回调地址，并确认它与 Google 控制台登记值完全一致（含 https、域名和路径）。
- 无法访问面板：先执行 `docker compose ps` 和 `docker compose logs --tail=200 inboxharbor`；Nginx 应代理到 `127.0.0.1:5555`。

## 非 Docker 备用方式

仅适合临时调试或没有 Docker 的环境。先从 Node.js 官方渠道安装 Node.js 24 或更高版本，然后在项目目录逐条运行：

```sh
cd /www/wwwroot/InboxHarbor
node --version
npm --version
npm ci --omit=dev
npm start
```

`node --version` 必须是 `v24` 或更高。首次启动会在终端输出管理口令；忘记时另开终端进入项目目录运行 `npm run credentials`。默认数据写入项目目录，可在启动前设置 `DATA_DIR=/安全路径`。`npm start` 是前台进程，SSH 断开后会停止，因此生产环境仍建议使用 Compose，而不是用 `nohup` 临时托管。
