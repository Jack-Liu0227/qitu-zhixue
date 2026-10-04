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
  while IFS= read -r entry; do
    path="${entry:3}"
    case "$path" in
      .gitignore|.pi/*|tooling/*|docs/shared/DEPLOYMENT_AND_AGENTS.md|apps/auth-portal/package.json|apps/student-center/package.json|apps/parent-companion/package.json|apps/teacher-workspace/package.json|apps/admin-console/package.json|services/api/src/main.ts) ;;
      *)
        echo "Refusing to sync: unexpected remote change at $path" >&2
        exit 1
        ;;
    esac
  done <<< "$remote_status"
fi

paths=(
  .gitignore
  .pi
  tooling
  docs/shared/DEPLOYMENT_AND_AGENTS.md
  apps/auth-portal/package.json
  apps/student-center/package.json
  apps/parent-companion/package.json
  apps/teacher-workspace/package.json
  apps/admin-console/package.json
  services/api/src/main.ts
)

ssh -o BatchMode=yes "$REMOTE" "mkdir -p '$STAGE' /root/team-workspaces/qitu-backups && tar -C '$REMOTE_ROOT' --ignore-failed-read -czf '$BACKUP' ${paths[*]}"

for path in "${paths[@]}"; do
  tar -C "$ROOT" -czf - "$path" | ssh -o BatchMode=yes "$REMOTE" "mkdir -p '$STAGE' && tar -C '$STAGE' -xzf -"
done

ssh -o BatchMode=yes "$REMOTE" "set -e; cp '$STAGE'/.gitignore '$REMOTE_ROOT/.gitignore'; mkdir -p '$REMOTE_ROOT/.pi' '$REMOTE_ROOT/tooling' '$REMOTE_ROOT/docs'; cp -a '$STAGE'/.pi/. '$REMOTE_ROOT/.pi/'; cp -a '$STAGE'/tooling/. '$REMOTE_ROOT/tooling/'; cp '$STAGE'/docs/shared/DEPLOYMENT_AND_AGENTS.md '$REMOTE_ROOT/docs/'; cp '$STAGE'/apps/auth-portal/package.json '$REMOTE_ROOT/apps/auth-portal/'; cp '$STAGE'/apps/student-center/package.json '$REMOTE_ROOT/apps/student-center/'; cp '$STAGE'/apps/parent-companion/package.json '$REMOTE_ROOT/apps/parent-companion/'; cp '$STAGE'/apps/teacher-workspace/package.json '$REMOTE_ROOT/apps/teacher-workspace/'; cp '$STAGE'/apps/admin-console/package.json '$REMOTE_ROOT/apps/admin-console/'; cp '$STAGE'/services/api/src/main.ts '$REMOTE_ROOT/services/api/src/main.ts'; rm -rf '$STAGE'; echo 'deployment files synced to $REMOTE_ROOT'; echo 'backup=$BACKUP'"
