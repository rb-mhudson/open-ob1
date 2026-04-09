# Setup Guide

This repo tracks personal customizations on top of [NateBJones-Projects/OB1](https://github.com/NateBJones-Projects/OB1).
The schema SQL below is extracted from the upstream [getting-started guide](https://github.com/NateBJones-Projects/OB1/blob/main/docs/01-getting-started.md)
for convenience — upstream is the canonical reference.

---

## Part 1 — Supabase Schema

Run these SQL blocks **one at a time** in the Supabase dashboard: **SQL Editor → New query**.

### Step 2.1 — Enable pgvector

**Database → Extensions** → search "vector" → flip **pgvector ON**.
(No SQL needed — done via the dashboard UI.)

### Step 2.2 — Create the thoughts table

```sql
create table thoughts (
  id uuid default gen_random_uuid() primary key,
  content text not null,
  embedding vector(1536),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index on thoughts
  using hnsw (embedding vector_cosine_ops);

create index on thoughts using gin (metadata);

create index on thoughts (created_at desc);

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger thoughts_updated_at
  before update on thoughts
  for each row
  execute function update_updated_at();
```

### Step 2.3 — Create the semantic search function

```sql
create or replace function match_thoughts(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10,
  filter jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float,
  created_at timestamptz
)
language plpgsql
as $$
begin
  return query
  select
    t.id,
    t.content,
    t.metadata,
    1 - (t.embedding <=> query_embedding) as similarity,
    t.created_at
  from thoughts t
  where 1 - (t.embedding <=> query_embedding) > match_threshold
    and (filter = '{}'::jsonb or t.metadata @> filter)
  order by t.embedding <=> query_embedding
  limit match_count;
end;
$$;
```

### Step 2.4 — Row Level Security

```sql
alter table thoughts enable row level security;

create policy "Service role full access"
  on thoughts
  for all
  using (auth.role() = 'service_role');
```

### Step 2.5 — Grant table permissions

```sql
grant select, insert, update, delete on table public.thoughts to service_role;
```

### Step 2.6 — Content fingerprint + upsert (deduplication)

```sql
alter table thoughts add column content_fingerprint text;

create unique index idx_thoughts_fingerprint
  on thoughts (content_fingerprint)
  where content_fingerprint is not null;

create or replace function upsert_thought(p_content text, p_payload jsonb default '{}')
returns jsonb as $$
declare
  v_fingerprint text;
  v_result jsonb;
  v_id uuid;
begin
  v_fingerprint := encode(sha256(convert_to(
    lower(trim(regexp_replace(p_content, '\s+', ' ', 'g'))),
    'UTF8'
  )), 'hex');

  insert into thoughts (content, content_fingerprint, metadata)
  values (p_content, v_fingerprint, coalesce(p_payload->'metadata', '{}'::jsonb))
  on conflict (content_fingerprint) where content_fingerprint is not null do update
  set updated_at = now(),
      metadata = thoughts.metadata || coalesce(excluded.metadata, '{}'::jsonb)
  returning id into v_id;

  v_result := jsonb_build_object('id', v_id, 'fingerprint', v_fingerprint);
  return v_result;
end;
$$ language plpgsql;
```

### Step 2.7 — Verify

In **Table Editor**: `thoughts` table should have columns: `id`, `content`, `embedding`, `metadata`, `content_fingerprint`, `created_at`, `updated_at`.

In **Database → Functions**: `match_thoughts` and `upsert_thought` should both appear.

---

## Part 2 — Deploy the Edge Function

### Prerequisites

```bash
brew install supabase/tap/supabase   # if not already installed
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

### Set secrets

```bash
supabase secrets set MCP_ACCESS_KEY=your-access-key
supabase secrets set OPENROUTER_API_KEY=your-openrouter-key
```

> `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — do not set them.

### Deploy

```bash
supabase functions deploy open-brain-mcp --no-verify-jwt
```

Your MCP server will be live at:

```
https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp
```

MCP connection URL (for clients that support query-param auth):

```
https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=YOUR_ACCESS_KEY
```

---

## Fresh install / nuclear reset

If rebuilding from scratch:

```sql
-- Run in Supabase SQL Editor before re-running Part 1 above
drop table if exists thoughts cascade;
drop function if exists match_thoughts cascade;
drop function if exists upsert_thought cascade;
drop function if exists update_updated_at cascade;
```

Then run all of Part 1 above, then Part 2.

---

## Local development

```bash
supabase start                           # start local Supabase stack
supabase functions serve open-brain-mcp  # run function locally
```

Requires a local `.env` file — copy `.env.example` and fill in values.
