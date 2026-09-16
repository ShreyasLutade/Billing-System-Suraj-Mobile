#!/bin/sh
set -eu

mkdir -p /data /data/backups
chown -R node:node /data 2>/dev/null || true

echo "[boot] Ensuring Prisma client + SQLite schema…"
npx prisma generate
npx prisma db push

echo "[boot] Starting Suraj Billing API on :${PORT:-4000}"

# Prefer non-root runtime when setpriv is available.
if [ "$(id -u)" = "0" ] && command -v setpriv >/dev/null 2>&1; then
  exec setpriv --reuid=node --regid=node --clear-groups -- "$@"
fi

exec "$@"
