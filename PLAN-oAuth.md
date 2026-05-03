# Design Doc: Migrating OB1 to Supabase OAuth

This document outlines the strategy for transitioning the OB1 MCP server from a static, shared-secret authentication model (`MCP_ACCESS_KEY`) to a secure, identity-based model using Supabase Auth (OAuth).

## 1. Goals
- **Identity-based access:** Link "thoughts" to specific users.
- **Secure Authentication:** Use industry-standard OAuth 2.0 / JWT.
- **Backward Compatibility:** (Optional) Provide a grace period for the static `x-brain-key`.
- **Gemini CLI Integration:** Leverage Gemini CLI's built-in OAuth discovery.

## 2. Phase 1: Database Migration (Multi-tenancy)
The current schema lacks a user context.

### SQL Changes
- **Add `user_id`:** Add a `UUID` column to the `thoughts` table.
- **Relationship:** Reference `auth.users(id)` from the Supabase Auth schema.
- **RLS (Row Level Security):** 
    - Enable RLS on `thoughts`.
    - Create a policy: `(auth.uid() = user_id)`.
    - Grant `authenticated` roles access to the table.
- **Backfill:** Assign existing thoughts to the primary user's ID to prevent data loss.

## 3. Phase 2: Edge Function Refactoring
The Hono app in `supabase/functions/open-brain-mcp/index.ts` must be updated to validate tokens.

### Logic Flow
1. **Extract Token:** Check `Authorization: Bearer <JWT>`.
2. **Validate:** Call `supabase.auth.getUser(jwt)`.
3. **Context Injection:** Extract the `user_id` from the validated user object.
4. **Tool Filtering:** Update all Supabase queries (`select`, `insert`, `rpc`) to include `.eq('user_id', userId)`.

### Middleware Implementation (Pseudocode)
```typescript
app.use('*', async (c, next) => {
  const token = c.req.header('Authorization')?.split(' ')[1];
  const { data: { user } } = await supabase.auth.getUser(token);
  
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  
  c.set('userId', user.id);
  await next();
});
```

## 4. Phase 3: Deployment & Infrastructure
- **Deploy Command:** Update `deploy.sh` to remove (or keep, depending on fallback strategy) `--no-verify-jwt`.
- **Environment Variables:** No new variables are strictly required, as the Supabase client uses existing project secrets to validate JWTs.

## 5. Phase 4: Gemini CLI Configuration
Configure the CLI to handle the browser-based OAuth flow.

### `settings.json` Update
```json
{
  "mcpServers": {
    "open-brain": {
      "httpUrl": "https://YOUR_PROJECT.supabase.co/functions/v1/open-brain-mcp",
      "authProviderType": "dynamic_discovery",
      "trust": true
    }
  }
}
```

## 6. Implementation Steps
1. [ ] Create and apply the SQL migration for `user_id` and RLS.
2. [ ] Identify your Supabase User ID and backfill the `88` existing thoughts.
3. [ ] Update `index.ts` to implement JWT validation.
4. [ ] Test locally using `supabase functions serve`.
5. [ ] Deploy to production.
6. [ ] Update global Gemini CLI settings to use OAuth.
