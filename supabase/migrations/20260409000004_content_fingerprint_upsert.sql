-- Migration: content fingerprint column + upsert_thought function
-- Enables deduplication: capturing the same thought twice merges metadata
-- instead of creating a duplicate row.

alter table thoughts add column if not exists content_fingerprint text;

-- Partial unique index: only enforces uniqueness on non-null fingerprints
create unique index if not exists idx_thoughts_fingerprint
  on thoughts (content_fingerprint)
  where content_fingerprint is not null;

-- Upsert function: insert new thought or merge metadata on duplicate
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
