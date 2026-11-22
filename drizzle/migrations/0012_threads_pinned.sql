ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
