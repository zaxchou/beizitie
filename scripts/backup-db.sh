#!/bin/bash
# zi2anki PostgreSQL 数据库备份脚本
#
# 用法：
#   bash scripts/backup-db.sh [operation] [git_commit]
#
# 示例：
#   bash scripts/backup-db.sh pre-content 6bc2c38
#   bash scripts/backup-db.sh scheduled unknown
#
# 安全特性：
#   - pg_dump 失败即失败
#   - gzip -t 验证备份可读
#   - 备份大小为 0 或异常小则失败
#   - 记录 sha256 checksum
#   - 保留最近 30 天

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/zi2anki/backups}"
DB_NAME="${PG_DATABASE:-zi2anki}"
DB_USER="${PG_USER:-zi2anki}"
DB_HOST="${PG_HOST:-localhost}"
# 口令：环境变量 PG_PASSWORD 或 cwd 下 .db-password 文件（不写入本文件，仓库是公开的）
if [ -z "${PG_PASSWORD:-}" ] && [ -f "$(dirname "$0")/../.db-password" ]; then
  PG_PASSWORD=$(tr -d '[:space:]' < "$(dirname "$0")/../.db-password")
fi
PGPASSWORD="${PG_PASSWORD:?缺少 DB 口令：请设置 PG_PASSWORD 或在项目根放 .db-password}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
OPERATION="${1:-manual}"
GIT_COMMIT="${2:-unknown}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SAFE_OPERATION=$(printf '%s' "$OPERATION" | tr -c 'A-Za-z0-9._-' '_')
SAFE_COMMIT=$(printf '%s' "$GIT_COMMIT" | tr -c 'A-Za-z0-9._-' '_')
FILENAME="${DB_NAME}_${TIMESTAMP}_${SAFE_OPERATION}_${SAFE_COMMIT}.sql.gz"
CHECKSUM_FILE="$BACKUP_DIR/${FILENAME}.sha256"
LATEST_FILE="$BACKUP_DIR/latest.json"
MIN_BYTES="${BACKUP_MIN_BYTES:-1024}"

export PGPASSWORD

mkdir -p "$BACKUP_DIR"

TMP_FILE="$BACKUP_DIR/.${FILENAME}.tmp"
cleanup() {
  rm -f "$TMP_FILE"
}
trap cleanup EXIT

pg_dump -h "$DB_HOST" -U "$DB_USER" --no-owner --no-acl "$DB_NAME" | gzip -c > "$TMP_FILE"

gzip -t "$TMP_FILE"

BYTES=$(wc -c < "$TMP_FILE" | tr -d ' ')
if [ "$BYTES" -lt "$MIN_BYTES" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 备份失败: 文件过小 (${BYTES} bytes < ${MIN_BYTES} bytes)" >&2
  exit 1
fi

mv "$TMP_FILE" "$BACKUP_DIR/$FILENAME"
chmod 600 "$BACKUP_DIR/$FILENAME"

if command -v sha256sum >/dev/null 2>&1; then
  SHA256=$(sha256sum "$BACKUP_DIR/$FILENAME" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  SHA256=$(shasum -a 256 "$BACKUP_DIR/$FILENAME" | awk '{print $1}')
else
  SHA256="unavailable"
fi

if [ "$SHA256" != "unavailable" ]; then
  printf '%s  %s\n' "$SHA256" "$FILENAME" > "$CHECKSUM_FILE"
  chmod 600 "$CHECKSUM_FILE"
fi

cat > "$LATEST_FILE" <<EOF
{
  "created_at": "$(date -Iseconds)",
  "operation": "$OPERATION",
  "git_commit": "$GIT_COMMIT",
  "database": "$DB_NAME",
  "host": "$DB_HOST",
  "file": "$BACKUP_DIR/$FILENAME",
  "bytes": $BYTES,
  "sha256": "$SHA256"
}
EOF
chmod 600 "$LATEST_FILE"

find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz.sha256" -mtime +"$RETENTION_DAYS" -delete

SIZE_HUMAN=$(du -h "$BACKUP_DIR/$FILENAME" | cut -f1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 备份完成: $FILENAME ($SIZE_HUMAN, ${BYTES} bytes, sha256=$SHA256)"
echo "BACKUP_FILE=$BACKUP_DIR/$FILENAME"
echo "BACKUP_BYTES=$BYTES"
echo "BACKUP_SHA256=$SHA256"
