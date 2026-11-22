-- Study mode: a quiz generated from a project's text files or a free topic.
-- A quiz is a set of multiple-choice questions; answers are saved per question.
CREATE TABLE IF NOT EXISTS public.study_quizzes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects (id) ON DELETE SET NULL,
  topic text NOT NULL CHECK (char_length(topic) BETWEEN 1 AND 200),
  question_count int NOT NULL DEFAULT 5 CHECK (question_count BETWEEN 1 AND 10),
  score int CHECK (score IS NULL OR score >= 0),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.study_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES public.study_quizzes (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  question text NOT NULL,
  options jsonb NOT NULL,
  answer_index int NOT NULL CHECK (answer_index BETWEEN 0 AND 3),
  explanation text NOT NULL DEFAULT '',
  user_answer int CHECK (user_answer IS NULL OR user_answer BETWEEN 0 AND 3),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS study_questions_quiz_idx
  ON public.study_questions (quiz_id);

ALTER TABLE public.study_quizzes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own study_quizzes select" ON public.study_quizzes;
CREATE POLICY "own study_quizzes select" ON public.study_quizzes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own study_quizzes insert" ON public.study_quizzes;
CREATE POLICY "own study_quizzes insert" ON public.study_quizzes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own study_quizzes update" ON public.study_quizzes;
CREATE POLICY "own study_quizzes update" ON public.study_quizzes
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own study_quizzes delete" ON public.study_quizzes;
CREATE POLICY "own study_quizzes delete" ON public.study_quizzes
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

ALTER TABLE public.study_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own study_questions select" ON public.study_questions;
CREATE POLICY "own study_questions select" ON public.study_questions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own study_questions insert" ON public.study_questions;
CREATE POLICY "own study_questions insert" ON public.study_questions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own study_questions update" ON public.study_questions;
CREATE POLICY "own study_questions update" ON public.study_questions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own study_questions delete" ON public.study_questions;
CREATE POLICY "own study_questions delete" ON public.study_questions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
