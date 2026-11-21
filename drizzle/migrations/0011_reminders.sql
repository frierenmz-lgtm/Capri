-- Reminders: created from chat ("recuérdame...") and delivered as a web push
-- notification at due_at. A per-minute job claims due rows and sends the push;
-- the app also lists them in Ajustes so nothing is lost silently.
CREATE TABLE IF NOT EXISTS public.reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  thread_id uuid REFERENCES public.threads (id) ON DELETE SET NULL,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 200),
  due_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Mexico_City',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS reminders_due_idx
  ON public.reminders (status, due_at);

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own reminders select" ON public.reminders;
CREATE POLICY "own reminders select" ON public.reminders
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own reminders insert" ON public.reminders;
CREATE POLICY "own reminders insert" ON public.reminders
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own reminders update" ON public.reminders;
CREATE POLICY "own reminders update" ON public.reminders
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own reminders delete" ON public.reminders;
CREATE POLICY "own reminders delete" ON public.reminders
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Web push subscriptions, one row per browser/device. The endpoint identifies
-- the subscription; the due job sends to every subscription of the reminder's owner.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own push subscriptions select" ON public.push_subscriptions;
CREATE POLICY "own push subscriptions select" ON public.push_subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own push subscriptions insert" ON public.push_subscriptions;
CREATE POLICY "own push subscriptions insert" ON public.push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own push subscriptions update" ON public.push_subscriptions;
CREATE POLICY "own push subscriptions update" ON public.push_subscriptions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own push subscriptions delete" ON public.push_subscriptions;
CREATE POLICY "own push subscriptions delete" ON public.push_subscriptions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
