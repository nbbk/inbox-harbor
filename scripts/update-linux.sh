#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

if ! command -v git >/dev/null 2>&1; then
  printf '%s\n' '未检测到 Git，请先安装 Git。' >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  printf '%s\n' '未检测到 Docker Compose，请先安装 Docker 与 Compose 插件。' >&2
  exit 1
fi

# Git 2.35.2+ refuses repositories owned by another system user. Trust only
# this exact checkout, never use the unsafe wildcard safe.directory='*'.
git config --global --add safe.directory "$ROOT"

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ "$REPO_ROOT" != "$ROOT" ]; then
  printf '%s\n' "当前目录不是预期的 InboxHarbor 仓库根目录：$ROOT" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  printf '%s\n' '检测到本地修改或未跟踪文件，已停止更新。请先运行 git status 并妥善处理这些文件。' >&2
  exit 1
fi

git pull --ff-only origin main
docker compose up -d --build
docker compose ps

printf '%s\n' 'InboxHarbor 更新完成。'
