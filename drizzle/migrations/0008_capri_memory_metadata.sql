ALTER TABLE public.capri_memories
  ADD COLUMN IF NOT EXISTS importance smallint NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'automatic')),
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS capri_memories_expiry_idx
  ON public.capri_memories(user_id, expires_at)
  WHERE expires_at IS NOT NULL;
