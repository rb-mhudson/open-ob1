-- Migration: row level security and service_role grants
-- Required on new Supabase projects — service_role no longer has full
-- table access by default.

alter table thoughts enable row level security;

drop policy if exists "Service role full access" on thoughts;
create policy "Service role full access"
  on thoughts
  for all
  using (auth.role() = 'service_role');

grant select, insert, update, delete on table public.thoughts to service_role;
