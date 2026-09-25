#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT/.pi/agents"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
DEST="$AGENT_DIR/agents"

if [[ ! -d "$SOURCE" ]]; then
  echo "Role source directory not found: $SOURCE" >&2
  exit 1
fi
mkdir -p "$DEST"
shopt -s nullglob
files=("$SOURCE"/*.md)
if ((${#files[@]} == 0)); then
  echo "No project agent definitions found in $SOURCE" >&2
  exit 1
fi

for source in "${files[@]}"; do
  name="$(basename "$source")"
  target="$DEST/$name"
  if [[ -e "$target" ]] && ! cmp -s "$source" "$target"; then
    backup="$target.backup-$(date +%Y%m%d%H%M%S)"
    cp -a "$target" "$backup"
    echo "Backed up previous global role: $backup"
  fi
  install -m 0644 "$source" "$target"
  echo "Installed shared role: $target"
done
