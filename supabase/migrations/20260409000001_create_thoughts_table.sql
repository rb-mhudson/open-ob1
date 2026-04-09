
create extension if not exists vector with schema extensions;

-- Migration: create thoughts table with indexes and updated_at trigger

create table if not exists thoughts (
  id uuid default gen_random_uuid() primary key,
  content text not null,
  embedding vector(1536),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Fast vector similarity search
create index if not exists thoughts_embedding_idx
  -- on thoughts using hnsw (embedding vector_cosine_ops);
  on thoughts using hnsw (embedding extensions.vector_cosine_ops);

-- Metadata JSONB filtering
create index if not exists thoughts_metadata_idx
  on thoughts using gin (metadata);

-- Date range queries
create index if not exists thoughts_created_at_idx
  on thoughts (created_at desc);

-- Auto-update updated_at on row change
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists thoughts_updated_at on thoughts;
create trigger thoughts_updated_at
  before update on thoughts
  for each row
  execute function update_updated_at();
