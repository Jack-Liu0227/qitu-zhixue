#!/usr/bin/env bash
set -euo pipefail

REMOTE="${QITU_REMOTE:-study-remote}"
REMOTE_ROOT="${QITU_REMOTE_ROOT:-/root/team-workspaces/qitu-zhixue}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y%m%d%H%M%S)"
STAGE="/tmp/qitu-config-sync-$STAMP"
BACKUP="/root/team-workspaces/qitu-backups/qitu-config-$STAMP.tar.gz"

remote_status="$(ssh -o BatchMode=yes "$REMOTE" "git -C '$REMOTE_ROOT' status --porcelain")"
if [[ -n "$remote_status" ]]; then
  echo "Refusing to modify remote main workspace because it is dirty:" >&2
  printf '%s\n' "$remote_status" >&2
  exit 1
fi

ssh -o BatchMode=yes "$REMOTE" "mkdir -p '$STAGE' /root/team-workspaces/qitu-backups && tar -C '$REMOTE_ROOT' --ignore-failed-read -czf '$BACKUP' .gitignore tooling .pi docs/DEPLOYMENT_AND_AGENTS.md"

for path in .pi tooling docs/DEPLOYMENT_AND_AGENTS.md; do
  tar -C "$ROOT" -czf - "$path" | ssh -o BatchMode=yes "$REMOTE" "mkdir -p '$STAGE' && tar -C '$STAGE' -xzf -"
done

ssh -o BatchMode=yes "$REMOTE" "mkdir -p '$REMOTE_ROOT/.pi' '$REMOTE_ROOT/tooling' '$REMOTE_ROOT/docs' && cp -a '$STAGE'/.pi/. '$REMOTE_ROOT/.pi/' && cp -a '$STAGE'/tooling/. '$REMOTE_ROOT/tooling/' && cp -a '$STAGE'/docs/DEPLOYMENT_AND_AGENTS.md '$REMOTE_ROOT/docs/' && rm -rf '$STAGE' && echo 'configuration synced to $REMOTE_ROOT' && echo 'backup=$BACKUP'"
