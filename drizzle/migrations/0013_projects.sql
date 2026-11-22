-- Projects: a project groups threads and files, with its own instructions.
-- Chats inside a project use the project's instructions and files as context.
CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  instructions text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL,
  storage_path text NOT NULL,
  media_type text NOT NULL DEFAULT 'text/plain',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_files_project_idx
  ON public.project_files (project_id, created_at);

ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS threads_project_idx
  ON public.threads (project_id);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own projects select" ON public.projects;
CREATE POLICY "own projects select" ON public.projects
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own projects insert" ON public.projects;
CREATE POLICY "own projects insert" ON public.projects
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own projects update" ON public.projects;
CREATE POLICY "own projects update" ON public.projects
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own projects delete" ON public.projects;
CREATE POLICY "own projects delete" ON public.projects
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

ALTER TABLE public.project_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own project_files select" ON public.project_files;
CREATE POLICY "own project_files select" ON public.project_files
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own project_files insert" ON public.project_files;
CREATE POLICY "own project_files insert" ON public.project_files
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own project_files update" ON public.project_files;
CREATE POLICY "own project_files update" ON public.project_files
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own project_files delete" ON public.project_files;
CREATE POLICY "own project_files delete" ON public.project_files
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
