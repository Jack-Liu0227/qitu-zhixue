#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${QITU_BACKUP_PASSPHRASE_FILE:?QITU_BACKUP_PASSPHRASE_FILE is required}"

BACKUP_DIR="${QITU_BACKUP_DIR:-/root/qitu-backups}"
RETENTION_DAYS="${QITU_BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
OUTPUT="$BACKUP_DIR/qitu-${STAMP}.dump.enc"
TMP="${OUTPUT}.tmp"
trap 'rm -f "$TMP"' EXIT

umask 077
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$QITU_BACKUP_PASSPHRASE_FILE" -out "$TMP"
mv "$TMP" "$OUTPUT"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'qitu-*.dump.enc' -mtime "+$RETENTION_DAYS" -delete
printf 'backup created: %s\n' "$OUTPUT"
