#!/usr/bin/env bash
# Copy live SQLite file to /data/backups (host or container).
# Prefer the in-app email backup; this is an extra on-disk safety net.
set -euo pipefail

DATA_DIR="${DATA_DIR:-/data}"
DB_FILE="${DB_FILE:-$DATA_DIR/suraj.db}"
BACKUP_DIR="${BACKUP_DIR:-$DATA_DIR/backups}"
KEEP_DAYS="${BACKUP_DB_KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB_FILE" ]; then
  echo "No database at $DB_FILE"
  exit 0
fi

stamp="$(TZ=Asia/Kolkata date +%Y-%m-%d_%H%M)"
dest="$BACKUP_DIR/suraj-$stamp.db"
cp -f "$DB_FILE" "$dest"
# Copy WAL/SHM companions if present
[ -f "$DB_FILE-wal" ] && cp -f "$DB_FILE-wal" "$dest-wal" || true
[ -f "$DB_FILE-shm" ] && cp -f "$DB_FILE-shm" "$dest-shm" || true

find "$BACKUP_DIR" -type f -name 'suraj-*.db*' -mtime +"$KEEP_DAYS" -delete || true
echo "Backup written: $dest"
