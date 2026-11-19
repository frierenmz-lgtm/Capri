CREATE POLICY "own messages update" ON public.messages FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.threads ADD COLUMN share_id uuid UNIQUE;

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
      FROM public.messages m WHERE m.thread_id = t.id
    ), '[]'::jsonb)
  )
  FROM public.threads t
  WHERE p_share_id IS NOT NULL AND t.share_id = p_share_id
$$;

REVOKE ALL ON FUNCTION public.get_shared_thread(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_thread(uuid) TO anon, authenticated, service_role;