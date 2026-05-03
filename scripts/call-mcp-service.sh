#!/usr/bin/env bash
# call-mcp-service.sh — quick curl wrapper for the Open-OB1 MCP server
#
# Usage:
#   ./scripts/call-mcp-service.sh [stats]
#   ./scripts/call-mcp-service.sh list [limit]
#   ./scripts/call-mcp-service.sh dump
#   ./scripts/call-mcp-service.sh search <query> [limit]
#
# Reads OB1_URL and OB1_KEY from environment, or falls back to
# the values in ~/.copilot/mcp-config.json (jq required for fallback).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

# Load .env if present
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -o allexport; source "$ENV_FILE"; set +o allexport
fi

OB1_URL="${OB1_URL:-${SUPABASE_URL:+${SUPABASE_URL}/functions/v1/open-brain-mcp}}"
OB1_KEY="${OB1_KEY:-${MCP_ACCESS_KEY:-}}"

if [[ -z "$OB1_URL" || "$OB1_URL" == *"your-project-ref"* ]]; then
  echo "Error: OB1_URL is not set or contains the 'your-project-ref' placeholder." >&2
  echo "Please set SUPABASE_URL in your .env file or export OB1_URL." >&2
  exit 1
fi

if [[ -z "$OB1_KEY" ]]; then
  echo "Error: MCP_ACCESS_KEY not found in .env and OB1_KEY not set" >&2
  exit 1
fi

ob1_call() {
  local body="$1"
  local response
  response=$(curl -s -w "\n%{http_code}" "$OB1_URL" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "x-brain-key: $OB1_KEY" \
    -d "$body")

  local http_code
  http_code=$(echo "$response" | tail -n1)
  local content
  content=$(echo "$response" | sed '$d')

  if [[ "$http_code" -ne 200 ]]; then
    echo "Error: Request failed with HTTP $http_code" >&2
    echo "$content" >&2
    exit 1
  fi

  if echo "$content" | grep -q '^data:'; then
    echo "$content" | grep '^data:' | sed 's/^data: //' | jq -r '.result.content[0].text // .error.message // .'
  else
    echo "Error: Unexpected response format" >&2
    echo "$content" | jq -r '.result.content[0].text // .error.message // .' 2>/dev/null || echo "$content" >&2
    exit 1
  fi
}

CMD="${1:-stats}"
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
  dump)
    ob1_call '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_thoughts","arguments":{"limit":1000,"include_expired":true}}}'
    ;;
  stats)
    ob1_call '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"thought_stats","arguments":{}}}'
    ;;
  *)
    echo "Usage: call-mcp-service.sh [stats | list [limit] | dump | search <query> [limit]]" >&2
    exit 1
    ;;
esac
