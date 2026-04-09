#!/usr/bin/env bash
# standup.sh — bring up open-ob1 on a new machine or after a nuclear reset
#
# Prerequisites:
#   - supabase CLI installed (brew install supabase/tap/supabase)
#   - .env file present and filled in (cp .env.example .env)
#   - supabase login already run
#
# Usage:
#   ./standup.sh YOUR_PROJECT_REF

set -euo pipefail

PROJECT_REF="${1:-}"

if [[ -z "$PROJECT_REF" ]]; then
  echo "Usage: $0 YOUR_PROJECT_REF"
  echo "Find your project ref in: https://supabase.com/dashboard/project/<HERE>/settings/api"
  exit 1
fi

if [[ ! -f ".env" ]]; then
  echo "Error: .env file not found. Copy .env.example and fill in your values first."
  exit 1
fi

source .env

echo "==> Linking to Supabase project: $PROJECT_REF"
supabase link --project-ref "$PROJECT_REF"

echo "==> Applying database migrations"
supabase db push

echo "==> Setting Supabase secrets"
supabase secrets set \
  MCP_ACCESS_KEY="$MCP_ACCESS_KEY" \
  OPENROUTER_API_KEY="$OPENROUTER_API_KEY"

echo "==> Deploying edge function"
supabase functions deploy open-brain-mcp --no-verify-jwt

echo ""
echo "✓ Done. Your MCP server is live at:"
echo "  https://${PROJECT_REF}.supabase.co/functions/v1/open-brain-mcp"
echo ""
echo "MCP connection URL:"
echo "  https://${PROJECT_REF}.supabase.co/functions/v1/open-brain-mcp?key=${MCP_ACCESS_KEY}"
