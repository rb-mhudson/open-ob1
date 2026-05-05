# Copilot Instructions

## What this repo is

A personal [Open Brain (OB1)](https://github.com/NateBJones-Projects/OB1) instance — a Supabase Edge Function that acts as an MCP (Model Context Protocol) server. AI clients capture, search, and list personal "thoughts" using semantic vector embeddings stored in Supabase/pgvector. Embeddings and metadata extraction both go through OpenRouter.

## Architecture

```
supabase/functions/open-brain-mcp/   ← deployed Edge Function (edit here)
  index.ts                           ← Hono HTTP server + MCP tools (Deno runtime)
  deno.json                          ← npm: import map

supabase/migrations/                 ← Postgres migrations applied via supabase CLI
recipes/                             ← local schema add-ons (each adds a migration)
scripts/                             ← Google Drive sync utilities (separate concern)
```

The deployed function is always at `supabase/functions/open-brain-mcp/index.ts`. (`server/` has been removed — it was a redundant copy of NBJ's upstream reference layout.)

## Key conventions

**Runtime is Deno**, not Node.js. Use `npm:` prefix for npm packages (as in `deno.json` import map) and `jsr:` for JSR packages. No `package.json`.

**MCP tools** are registered via `server.registerTool(name, { title, description, inputSchema }, handler)`. Input schemas use Zod. All tools follow the same pattern: validate → call Supabase/OpenRouter → return `{ content: [{ type: "text", text }] }`. Errors set `isError: true`.

**Auth** is handled in the Hono middleware (not JWT): access key checked via `x-brain-key` header or `?key=` query param against `MCP_ACCESS_KEY` env var. `verify_jwt = false` in `supabase/config.toml`.

**Capturing thoughts**: When the user asks to save/remember/capture something to OB1, pass their content **verbatim** as the `content` argument to `capture_thought`. Do not paraphrase, summarize, reword, or restructure. The deduplication fingerprint is content-based — rewording defeats it.

**Deduplication**: `capture_thought` calls the `upsert_thought` Postgres RPC (not a direct insert). The RPC computes a SHA256 fingerprint of normalized content and merges metadata on conflict.

**Two-phase capture**: `capture_thought` runs `getEmbedding` and `extractMetadata` in parallel, then calls `upsert_thought` (which does not store the embedding), then updates the embedding separately with `.update({ embedding })`.

**Migrations** follow the naming pattern `YYYYMMDDHHMMSS_description.sql` and are applied with `supabase db push` (idempotent).

**Metadata schema** extracted per thought: `{ type, topics[], people[], action_items[], dates_mentioned[] }`. `type` is one of: `observation`, `task`, `idea`, `reference`, `person_note`.

## Commands

**Local development:**
```bash
supabase start
supabase functions serve open-brain-mcp
```

**Deploy everything (new machine or after nuclear reset):**
```bash
./standup.sh YOUR_PROJECT_REF
```

**Deploy function only:**
```bash
supabase functions deploy open-brain-mcp --no-verify-jwt
```

**Apply migrations only:**
```bash
supabase db push
```

## Environment variables

All four are required — set in `.env` for local dev, and in Supabase dashboard (Edge Functions → Secrets) for production:

| Variable | Source |
|---|---|
| `SUPABASE_URL` | Supabase project settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings → API |
| `OPENROUTER_API_KEY` | openrouter.ai/keys |
| `MCP_ACCESS_KEY` | Self-generated secret (treat like a password) |

## Adding a recipe

Recipes that extend the schema add a new migration file in `supabase/migrations/`. Re-running `./standup.sh` or `supabase db push` applies it (idempotent).
