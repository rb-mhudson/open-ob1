# Setup Guide

Based on [NateBJones-Projects/OB1](https://github.com/NateBJones-Projects/OB1).
Schema migrations live in `supabase/migrations/` and are applied by the CLI — no copy-pasting SQL into the dashboard.

---

## Prerequisites

1. [Supabase](https://supabase.com) project created (free tier fine)
2. [OpenRouter](https://openrouter.ai) API key (~$5 in credits, lasts months)
3. Supabase CLI installed: `brew install supabase/tap/supabase`
4. Logged in: `supabase login`

---

## First-time standup

```bash
git clone https://github.com/rb-mhudson/open-ob1.git
cd open-ob1
cp .env.example .env        # fill in all four values
chmod +x standup.sh
./standup.sh YOUR_PROJECT_REF
```

That's it. The script links, pushes migrations, sets secrets, and deploys the function.

---

## Nuclear reset (wipe and rebuild)

Run this SQL in the Supabase dashboard SQL editor first:

```sql
drop table if exists thoughts cascade;
drop function if exists match_thoughts cascade;
drop function if exists upsert_thought cascade;
drop function if exists update_updated_at cascade;
```

Then re-run:

```bash
./standup.sh YOUR_PROJECT_REF
```

---

## Adding a recipe (e.g. recall-tracking)

Recipes that extend the schema add their own migration file:

```bash
# Apply a recipe's migration manually
supabase db push
```

Or just re-run `standup.sh` — `db push` is idempotent for already-applied migrations.

---

## Local development

```bash
supabase start
supabase functions serve open-brain-mcp
```

---

## Migrations

| File | Purpose |
|------|---------|
| `20260409000001` | `thoughts` table + indexes + `updated_at` trigger |
| `20260409000002` | `match_thoughts` semantic search RPC |
| `20260409000003` | Row Level Security + `service_role` grants |
| `20260409000004` | `content_fingerprint` column + `upsert_thought` dedup RPC |
