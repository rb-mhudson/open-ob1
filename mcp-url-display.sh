#!/bin/bash

source .env || echo requires a populated .env file

if [ -z "$SUPABASE_URL" ] || [ -z "$MCP_ACCESS_KEY" ]; then
  echo "Error: SUPABASE_URL or MCP_ACCESS_KEY not set in .env"
  exit 1
fi

# Display the MCP URL with auth key param (Note: an x-brain-key header also works...)
echo "${SUPABASE_URL}/functions/v1/open-brain-mcp?key=${MCP_ACCESS_KEY}"
