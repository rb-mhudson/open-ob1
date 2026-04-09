# open-ob1 standup — 2026-04-09

## What's done
- Repo created: https://github.com/rb-mhudson/open-ob1
- Local clone: /Users/markhudson/src/open-ob1
- Upstream server/index.ts + deno.json pulled
- 4 idempotent migrations in supabase/migrations/
- standup.sh written
- SETUP.md written
- New Supabase project: tcsyaidvgtwrsujmaklz (fresh DB, nothing applied yet)

## Next: run these 5 commands

```bash
cd /Users/markhudson/src/open-ob1
supabase link --project-ref tcsyaidvgtwrsujmaklz
supabase db push
supabase secrets set MCP_ACCESS_KEY=... OPENROUTER_API_KEY=...
supabase functions deploy open-brain-mcp --no-verify-jwt
```

## Known confusion: two Supabase projects
- Old project: original ob1-syncer (Copilot MCP may still point here)
- New project: tcsyaidvgtwrsujmaklz (open-ob1 target)
- After deploy, update Copilot MCP config to the new URL + key
- Run `supabase status` to confirm which project is linked

## After deploy: smoke test
Capture a thought, search for it. Verify dedup works (capture same thought twice).

## After smoke test: remaining todos
- nuke-schema (done implicitly — fresh DB)
- live-retrieval recipe — review recipes/live-retrieval in upstream
- skills-review — browse skills/ in upstream
- last-recalled-decision — re-add last_recalled_at as a recipe or drop it
- recall-tracking-recipe — author recipes/recall-tracking/ in open-ob1

## MCP URL (after deploy)
https://tcsyaidvgtwrsujmaklz.supabase.co/functions/v1/open-brain-mcp?key=YOUR_MCP_ACCESS_KEY
