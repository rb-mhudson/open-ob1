#!/usr/bin/env bash
# deploy.sh — deploy open-brain-mcp and log the result locally
#
# Usage:
#   ./deploy.sh           deploy and log
#   ./deploy.sh --log     show deployment history

set -euo pipefail

LOG_FILE=".deploy-log"

if [[ "${1:-}" == "--log" ]]; then
  if [[ ! -f "$LOG_FILE" ]]; then
    echo "No deployments logged yet."
  else
    echo "Deployment history (newest first):"
    echo ""
    tac "$LOG_FILE"
  fi
  exit 0
fi

echo "==> Deploying open-brain-mcp..."
supabase functions deploy open-brain-mcp --no-verify-jwt

GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "no-git")
GIT_MSG=$(git log -1 --pretty=format:"%s" 2>/dev/null || echo "")
TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
VERSION=$(supabase functions list 2>/dev/null | awk '/open-brain-mcp/ {print $8}')

ENTRY="[$TIMESTAMP] sha=$GIT_SHA ver=$VERSION  $GIT_MSG"
echo "$ENTRY" >> "$LOG_FILE"

echo ""
echo "✓ Deployed: $ENTRY"
