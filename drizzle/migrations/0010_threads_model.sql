ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT 'openai/gpt-oss-120b';
