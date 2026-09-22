# 运维速查

## 旧 KV 数据迁移

初始化 Owner 后，先执行 `npm run migrate:legacy -- --dry-run` 查看账户、邮件、通知、规则、清理记录和孤立邮件统计；确认后执行 `npm run migrate:legacy`。迁移保留旧加密 KV 和 `data.json`，并会在 `DATA_DIR` 创建带 `manifest.json` 的时间戳备份目录与 `migration-report.json`。迁移为单笔事务：任何计数校验或解密错误都会回滚，旧数据不会被删除。

如需恢复某次迁移，先停止容器/服务，从 `migration-report.json` 或 `migration_runs` 取得 `runId`，再执行：

```sh
npm run migrate:legacy -- --rollback RUN_ID
```

回滚只接受当前 `DATA_DIR` 内、且 `manifest.json` 指向同一数据目录、SHA-256 与文件大小均匹配的备份；它恢复数据库、密钥、管理口令和旧 `data.json`（如果该备份含有这些文件）。迁移、备份和恢复都会争抢同一个 `instance.lock`：只要服务仍在运行，命令会被技术锁拒绝，而不是仅依赖人工确认。恢复后再启动服务。不要手工复制部分数据库文件，也不要删除旧 KV 或 `data.json`，直到验证完成。

Windows 文件系统若无法确认目录元数据已持久化，迁移恢复会安全失败并保留 journal/暂存目录；请在 Linux/Docker 中执行迁移恢复，或在停服后进行人工完整备份，不要把失败当作已恢复成功。

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
