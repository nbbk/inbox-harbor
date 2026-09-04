#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
if ! command -v docker >/dev/null 2>&1; then
  printf '%s\n' '未检测到 Docker，请先在宝塔 Docker 管理器中安装 Docker 与 Compose。' >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  printf '%s\n' '未检测到 Docker Compose 插件，请先安装后重试。' >&2
  exit 1
fi
docker compose up -d --build
printf '%s\n' 'InboxHarbor 已启动：http://localhost:5555'
printf '%s\n' '管理口令如下（以后可运行 docker compose exec inboxharbor npm run credentials 查询）：'
docker compose exec -T inboxharbor npm run credentials
