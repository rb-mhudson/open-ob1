-- Migration: recall tracking + expiry
-- Adds expiry (soft-delete/TTL), last_recalled_at, and recall_counter to thoughts.
-- Recall is stamped on high-confidence semantic search hits (>= 0.8 similarity).

alter table thoughts
  add column if not exists expiry timestamptz,
  add column if not exists last_recalled_at timestamptz,
  add column if not exists recall_counter int not null default 0;

create index if not exists thoughts_expiry_idx on thoughts (expiry)
  where expiry is not null;

-- Batch-stamp recall on a set of thought IDs
create or replace function record_recall(p_ids uuid[])
returns void as $$
begin
  update thoughts
  set last_recalled_at = now(),
      recall_counter   = recall_counter + 1
  where id = any(p_ids);
end;
$$ language plpgsql;
