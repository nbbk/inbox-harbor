# 运维速查

## 日常一致性备份与恢复

先停止服务；脚本会取得 `instance.lock`，运行中的实例会被拒绝。`npm run backup` 创建的是**数据卷内的回滚快照**：它使用 SQLite `VACUUM INTO`，保存匹配的密钥/管理口令（若它们位于卷内），并生成 SHA-256 `manifest.json`。它不是卷外灾备副本，仍需按下面命令导出到受控目录：

```sh
docker compose down
docker compose run --rm inboxharbor npm run backup
# 输出 DATA_DIR 内 migration-backup-时间戳 目录
```

在宿主机将该目录导出（把 `<snapshot>` 替换为上一步输出的目录名），并保留 manifest 与校验结果。备份目录仅 root 可读；建议每天备份、保留 30 天并定期演练恢复：

```sh
sudo install -d -m 700 /root/inboxharbor-backups
docker run --rm -v inboxharbor-data:/data -v /root/inboxharbor-backups:/export alpine sh -c 'cp -a /data/<snapshot> /export/<snapshot> && chmod -R go-rwx /export/<snapshot>'
sudo sha256sum /root/inboxharbor-backups/<snapshot>/manifest.json | sudo tee /root/inboxharbor-backups/<snapshot>/manifest.json.sha256
# 仅清理明确命名且超过 30 天的已导出快照；先确认 find 输出
sudo find /root/inboxharbor-backups -mindepth 1 -maxdepth 1 -type d -name 'migration-backup-*' -mtime +30 -print
```

恢复路径必须是当前 `DATA_DIR` 内的该备份目录。恢复前先创建一个新的卷内快照；应用会校验 manifest、在 staging 中打开 SQLite 并解密 `kv.state`，再原子切换 generation。校验失败不会覆盖 live 文件：

```sh
docker compose run --rm inboxharbor npm run backup -- --restore migration-backup-2026-01-01T00-00-00-000Z
docker compose up -d
```

从卷外备份恢复时，先核对导出的 SHA-256，再只把**快照目录**复制回卷中；不要解压或清空 live 卷：

```sh
sudo sha256sum -c /root/inboxharbor-backups/<snapshot>/manifest.json.sha256
docker compose stop inboxharbor
docker compose run --rm inboxharbor npm run backup
docker run --rm -v inboxharbor-data:/data -v /root/inboxharbor-backups:/export alpine sh -c 'test -f /export/<snapshot>/manifest.json && cp -a /export/<snapshot> /data/<snapshot>'
docker compose run --rm inboxharbor npm run backup -- --restore <snapshot>
docker compose up -d
```

不要只复制 `.db` 而不复制 `.key`，也不要编辑 manifest。`.env` 与通过环境变量提供的主密钥/管理口令不会写入应用备份；若使用它们，单独以权限 `600` 保存到受控位置。环境密钥模式的 manifest 仅含固定上下文 HMAC verifier、不含密钥；恢复会在任何 live 文件变更前要求当前 `INBOXHARBOR_MASTER_KEY` 与 verifier 匹配。恢复完成后启动前应执行一次解密/健康验证（`docker compose up -d && docker compose ps`），确认应用能读取加密状态。Windows 无法确认目录持久化时会安全拒绝恢复；请改在 Linux/Docker 完成。

## 多用户与恢复码

首次 Owner 初始化、公开注册和接受邀请都会**仅显示一次**恢复码。立即复制到离线密码管理器；服务不会保存明文恢复码。登录后可在“个人中心”输入当前密码重新生成，旧码立即失效。忘记密码时在登录页选择“忘记密码”，提交邮箱、一个恢复码和新密码；该码单次消费且所有会话会退出。

Owner 可邀请成员或管理员；管理员可管理普通成员，不能修改 Owner。公开注册默认关闭，只有 Owner 可在管理后台开启。普通成员可删除自己的账户；Owner 删除成员必须输入自己的密码。两种删除都会清除该用户邮件、账户、通知、共享链接、恢复码和会话。

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
