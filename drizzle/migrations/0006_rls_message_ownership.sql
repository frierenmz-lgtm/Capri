-- Keep message ownership aligned with the parent conversation on every write.
-- The previous UPDATE policy only checked messages.user_id, which allowed a
-- user to re-parent their own message into another user's thread.
DROP POLICY IF EXISTS "own messages update" ON public.messages;
CREATE POLICY "own messages update" ON public.messages
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.threads t
      WHERE t.id = messages.thread_id AND t.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.threads t
      WHERE t.id = messages.thread_id AND t.user_id = auth.uid()
    )
  );

-- Also make the parent ownership check explicit for future policy changes.
DROP POLICY IF EXISTS "own messages insert" ON public.messages;
CREATE POLICY "own messages insert" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.threads t
      WHERE t.id = messages.thread_id AND t.user_id = auth.uid()
    )
  );

-- Restrict persisted message shape to the roles and JSON structure used by Capri.
ALTER TABLE public.messages
  ADD CONSTRAINT messages_role_check CHECK (role IN ('user', 'assistant')),
  ADD CONSTRAINT messages_parts_array_check CHECK (jsonb_typeof(parts) = 'array'),
  ADD CONSTRAINT messages_message_id_check CHECK (char_length(message_id) BETWEEN 1 AND 128);

-- Ensure a shared conversation cannot be updated to another owner's row.
DROP POLICY IF EXISTS "own threads update" ON public.threads;
CREATE POLICY "own threads update" ON public.threads
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Hide any pre-existing message rows whose owner does not match the parent thread.
DROP POLICY IF EXISTS "own messages select" ON public.messages;
CREATE POLICY "own messages select" ON public.messages
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.threads t
      WHERE t.id = messages.thread_id AND t.user_id = auth.uid()
    )
  );

-- Public share links must expose only messages owned by the thread owner.
CREATE OR REPLACE FUNCTION public.get_shared_thread(p_share_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'title', t.title,
    'updated_at', t.updated_at,
    'messages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', m.message_id, 'role', m.role, 'parts', m.parts) ORDER BY m.created_at)
      FROM public.messages m
      WHERE m.thread_id = t.id AND m.user_id = t.user_id
    ), '[]'::jsonb)
  )
  FROM public.threads t
  WHERE p_share_id IS NOT NULL AND t.share_id = p_share_id
$$;

REVOKE ALL ON FUNCTION public.get_shared_thread(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_thread(uuid) TO anon, authenticated, service_role;
