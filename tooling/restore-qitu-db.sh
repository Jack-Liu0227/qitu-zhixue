#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${QITU_BACKUP_PASSPHRASE_FILE:?QITU_BACKUP_PASSPHRASE_FILE is required}"
: "${QITU_BACKUP_FILE:?QITU_BACKUP_FILE is required}"

TMP_DIR="${TMPDIR:-/tmp}/qitu-restore-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$TMP_DIR"
trap 'rm -f "$TMP_DIR/restore.dump"' EXIT

umask 077
openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:$QITU_BACKUP_PASSPHRASE_FILE" -in "$QITU_BACKUP_FILE" -out "$TMP_DIR/restore.dump"
pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$DATABASE_URL" "$TMP_DIR/restore.dump"
printf 'restore completed from: %s\n' "$QITU_BACKUP_FILE"
