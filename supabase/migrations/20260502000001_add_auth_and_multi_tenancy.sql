-- Migration: add user_id for multi-tenancy and update RLS policies
-- Created: 2026-05-02

SET search_path TO public, extensions;

-- 1. Add user_id column referencing auth.users
ALTER TABLE thoughts ADD COLUMN user_id UUID REFERENCES auth.users(id);

-- 2. Create index for performance
CREATE INDEX IF NOT EXISTS thoughts_user_id_idx ON thoughts (user_id);

-- 3. Update RLS policies
-- We transition from "service_role only" to "authenticated user identity"
ALTER TABLE thoughts ENABLE ROW LEVEL SECURITY;

-- Drop old policy if it exists
DROP POLICY IF EXISTS "Service role full access" ON thoughts;

-- New policy: Users can only see/edit their own thoughts
CREATE POLICY "Users can manage their own thoughts"
  ON thoughts
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role still needs access for background tasks/admin
CREATE POLICY "Service role full access"
  ON thoughts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. Update match_thoughts to explicitly support user_id filtering (optional but recommended)
CREATE OR REPLACE FUNCTION match_thoughts(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 10,
  filter jsonb DEFAULT '{}'::jsonb,
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  similarity float,
  created_at timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.content,
    t.metadata,
    1 - (t.embedding <=> query_embedding) AS similarity,
    t.created_at
  FROM thoughts t
  WHERE 1 - (t.embedding <=> query_embedding) > match_threshold
    AND (filter = '{}'::jsonb OR t.metadata @> filter)
    -- If p_user_id is provided, filter by it. 
    -- If not, RLS will still catch it if called as an authenticated user.
    AND (p_user_id IS NULL OR t.user_id = p_user_id)
  ORDER BY t.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
