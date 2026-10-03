#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/services/graphiti/docker-compose.yml")

case "${1:-status}" in
  up)
    command -v docker >/dev/null || { echo 'docker is required' >&2; exit 1; }
    if [[ -z "${GRAPHITI_NEO4J_PASSWORD:-}" || -z "${QITU_GRAPHITI_TOKEN:-}" ]]; then
      echo 'Graphiti secrets must be supplied by the shell or secret manager.' >&2
      exit 1
    fi
    "${COMPOSE[@]}" up -d neo4j bridge
    ;;
  init)
    "${COMPOSE[@]}" run --rm bridge python bridge.py --init-schema
    ;;
  down)
    "${COMPOSE[@]}" down
    ;;
  status)
    "${COMPOSE[@]}" ps
    ;;
  *)
    echo "usage: $0 {up|init|down|status}" >&2
    exit 2
    ;;
esac
