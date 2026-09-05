# 运维速查

```sh
docker compose ps
docker compose logs -f --tail=200 inboxharbor
docker compose exec -T inboxharbor npm run credentials
docker compose restart inboxharbor
```

应用健康检查由 Compose 显示为 `healthy`。管理口令、加密数据库与主密钥位于 `inboxharbor-data` 命名卷；备份和恢复步骤见 [deployment.md](deployment.md)。

修改 `.env` 后执行 `docker compose up -d --force-recreate` 使新环境变量生效。升级前备份命名卷。第一次更新或遇到 Git 所有权报错时：

```sh
git config --global --add safe.directory /www/wwwroot/InboxHarbor
cd /www/wwwroot/InboxHarbor
git remote set-url origin https://github.com/nbbk/inbox-harbor.git
git pull --ff-only origin main
docker compose up -d --build
```

之后可运行 `./scripts/update-linux.sh` 一键更新。不要使用 `safe.directory '*'`，也不要使用 `git reset --hard` 更新生产目录。
