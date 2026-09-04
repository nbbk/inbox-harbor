# 运维速查

```sh
docker compose ps
docker compose logs -f --tail=200 inboxharbor
docker compose exec -T inboxharbor npm run credentials
docker compose restart inboxharbor
```

应用健康检查由 Compose 显示为 `healthy`。管理口令、加密数据库与主密钥位于 `inboxharbor-data` 命名卷；备份和恢复步骤见 [deployment.md](deployment.md)。

修改 `.env` 后执行 `docker compose up -d` 使新环境变量生效。升级前备份命名卷；升级使用 `git pull --ff-only && docker compose up -d --build`。
