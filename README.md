# open-ob1

Personal [Open Brain (OB1)](https://github.com/NateBJones-Projects/OB1) instance — a shared vector memory store for AI agents, running as a Supabase Edge Function MCP server.

## What this is

A Supabase Edge Function that acts as an MCP (Model Context Protocol) server. AI clients (Claude, GitHub Copilot, Gemini, etc.) connect to it and can capture, search, and list personal "thoughts" using semantic embeddings.

Based on the upstream [NateBJones-Projects/OB1](https://github.com/NateBJones-Projects/OB1) reference implementation. This repo tracks local customizations (recipes, scripts) on top of the upstream server.

## Setup

Follow the upstream [getting-started guide](https://github.com/NateBJones-Projects/OB1/blob/main/docs/01-getting-started.md) for Supabase schema setup, then:

```bash
cp .env.example .env
# Fill in your values

supabase functions deploy open-brain-mcp
```

## Environment variables

See `.env.example` for required variables. Set them in Supabase dashboard under **Edge Functions → Secrets**.

## Repo structure

```
server/          # Upstream MCP server (index.ts + deno.json)
recipes/         # Local add-on recipes (e.g. recall-tracking)
scripts/         # Utility scripts (Google Drive sync, etc.)
supabase/        # Supabase project config
```

## Connecting to MCP clients

The deployed function URL accepts:
- `x-brain-key: <MCP_ACCESS_KEY>` header, or
- `?key=<MCP_ACCESS_KEY>` query param
