-- User-controlled long-term memory. Entries are explicit and editable by the account owner.
CREATE TABLE public.capri_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  category text NOT NULL DEFAULT 'contexto' CHECK (category IN ('preferencia', 'proyecto', 'objetivo', 'contexto', 'otro')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX capri_memories_user_updated_idx
  ON public.capri_memories(user_id, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.capri_memories TO authenticated;
GRANT ALL ON public.capri_memories TO service_role;
ALTER TABLE public.capri_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own capri memories select" ON public.capri_memories
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own capri memories insert" ON public.capri_memories
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own capri memories update" ON public.capri_memories
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own capri memories delete" ON public.capri_memories
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
