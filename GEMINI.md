# GEMINI.md — open-ob1 (Personal Open Brain)

This project is a personal implementation of **Open Brain (OB1)**, a shared vector memory store for AI agents. It runs as a **Supabase Edge Function** and implements the **Model Context Protocol (MCP)**, allowing AI clients (Claude, Gemini, Copilot) to capture, search, and recall "thoughts" using semantic embeddings.

## Project Overview

- **Architecture:** MCP server hosted on Supabase Edge Functions.
- **Runtime:** Deno (via Supabase Edge Runtime).
- **Database:** PostgreSQL with `pgvector` for semantic search.
- **Embeddings/LLM:** OpenRouter (OpenAI models like `text-embedding-3-small` and `gpt-4o-mini`).
- **Core Logic:** `supabase/functions/open-brain-mcp/index.ts`.

## Key Features

- **Semantic Search:** Find thoughts by meaning, not just keywords.
- **Auto-Metadata:** Automatically extracts topics, people, and action items from captured text.
- **Deduplication:** Uses content fingerprints to prevent duplicate thoughts.
- **Recall Tracking:** Tracks how often and when thoughts are recalled.
- **Expiry:** Supports expiring thoughts (ephemeral memory).

## Directory Structure

- `supabase/functions/open-brain-mcp/`: The Deno/Hono source for the MCP server.
    - `index.ts`: Main entry point and tool definitions.
    - `deno.json`: Deno configuration and dependencies.
- `supabase/migrations/`: SQL migrations defining the database schema and vector search functions.
- `scripts/`: Utility scripts for management and data syncing.
    - `sync_open_brain.sh`: Script to sync data from external sources.
    - `call-mcp-service.sh`: CLI utility to interact with the deployed MCP server.
- `standup.sh`: One-click initialization script for setting up the project on Supabase.
- `deploy.sh`: Deployment script for the edge function.

## Building and Running

### Prerequisites
- Supabase CLI installed and logged in (`supabase login`).
- OpenRouter API key.
- `.env` file populated (use `.env.example` as a template).

### Initial Setup
```bash
./standup.sh <YOUR_PROJECT_REF>
```
This script links the project, applies migrations, sets secrets, and deploys the function.

### Local Development
1. Start Supabase locally:
   ```bash
   supabase start
   ```
2. Serve the function locally:
   ```bash
   supabase functions serve open-brain-mcp --no-verify-jwt
   ```

### Deployment
```bash
supabase functions deploy open-brain-mcp --no-verify-jwt
```

## Development Conventions

- **Database First:** All schema changes must be added as migrations in `supabase/migrations/`. Never apply SQL manually in the dashboard.
- **Type Safety:** Use Zod for input validation (in `index.ts`) and ensure TypeScript types match the database schema.
- **MCP Standards:** When adding new tools, follow the MCP SDK patterns for registration and input/output schemas.
- **Edge Runtime:** Remember that the function runs in the Supabase Edge Runtime (Deno), so use standard Deno/Web APIs where possible.

## MCP Tools (Available in `open-brain-mcp`)

- `search_thoughts`: Semantic search across captured thoughts.
- `capture_thought`: Store a new thought with auto-metadata extraction.
- `list_thoughts`: List recent thoughts with optional filtering.
- `update_thought`: Update an existing thought (metadata or content).
- `thought_stats`: Get statistics about the memory store.
