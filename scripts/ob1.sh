#!/usr/bin/env bash
# ob1.sh — quick curl wrapper for the Open-OB1 MCP server
#
# Usage:
#   ./scripts/ob1.sh list [limit]
#   ./scripts/ob1.sh search <query> [limit]
#   ./scripts/ob1.sh stats
#
# Reads OB1_URL and OB1_KEY from environment, or falls back to
# the values in ~/.copilot/mcp-config.json (jq required for fallback).

set -euo pipefail

OB1_URL="${OB1_URL:-https://tcsyaidvgtwrsujmaklz.supabase.co/functions/v1/open-brain-mcp}"
OB1_KEY="${OB1_KEY:-}"

if [[ -z "$OB1_KEY" ]] && command -v jq &>/dev/null; then
  OB1_KEY=$(jq -r '.mcpServers["Open-OB1"].headers["x-brain-key"] // empty' \
    ~/.copilot/mcp-config.json 2>/dev/null || true)
fi

if [[ -z "$OB1_KEY" ]]; then
  echo "Error: set OB1_KEY env var or ensure ~/.copilot/mcp-config.json has Open-OB1.headers.x-brain-key" >&2
  exit 1
fi

ob1_call() {
  local body="$1"
  curl -s "$OB1_URL" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "x-brain-key: $OB1_KEY" \
    -d "$body" \
  | grep '^data:' | sed 's/^data: //' | jq -r '.result.content[0].text // .error.message // .'
}

CMD="${1:-list}"
shift || true

case "$CMD" in
  list)
    LIMIT="${1:-10}"
    ob1_call "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"list_thoughts\",\"arguments\":{\"limit\":$LIMIT}}}"
    ;;
  search)
    QUERY="${1:?Usage: ob1.sh search <query> [limit]}"
    LIMIT="${2:-10}"
    ob1_call "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"search_thoughts\",\"arguments\":{\"query\":$(printf '%s' "$QUERY" | jq -Rs .),\"limit\":$LIMIT}}}"
    ;;
  stats)
    ob1_call '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"thought_stats","arguments":{}}}'
    ;;
  *)
    echo "Usage: ob1.sh [list [limit] | search <query> [limit] | stats]" >&2
    exit 1
    ;;
esac
