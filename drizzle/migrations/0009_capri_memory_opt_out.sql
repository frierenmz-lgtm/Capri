ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS memory_auto_enabled boolean NOT NULL DEFAULT true;
