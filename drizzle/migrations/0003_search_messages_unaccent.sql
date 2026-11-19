CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.search_messages(q text)
RETURNS TABLE(thread_id uuid, title text, snippet text, updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  WITH term AS (
    SELECT btrim(coalesce(q, '')) AS t
  ),
  pattern AS (
    SELECT t,
      lower(extensions.unaccent(t)) AS folded,
      '%' || replace(replace(replace(extensions.unaccent(t), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS p
    FROM term
  ),
  hits AS (
    SELECT DISTINCT ON (m.thread_id)
      m.thread_id,
      regexp_replace(part->>'text', '\s+', ' ', 'g') AS body,
      pattern.folded,
      m.created_at
    FROM public.messages m
    CROSS JOIN pattern
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(m.parts) = 'array' THEN m.parts ELSE '[]'::jsonb END
    ) AS part
    WHERE m.user_id = auth.uid()
      AND char_length(pattern.t) >= 2
      AND part->>'type' = 'text'
      AND extensions.unaccent(part->>'text') ILIKE pattern.p
    ORDER BY m.thread_id, m.created_at DESC
  ),
  located AS (
    SELECT h.thread_id, h.body, strpos(lower(extensions.unaccent(h.body)), h.folded) AS pos
    FROM hits h
  )
  SELECT
    l.thread_id,
    th.title,
    CASE WHEN greatest(l.pos - 40, 1) > 1 THEN '…' ELSE '' END
      || substring(l.body FROM greatest(l.pos - 40, 1) FOR 140)
      || CASE WHEN char_length(l.body) > greatest(l.pos - 40, 1) + 139 THEN '…' ELSE '' END AS snippet,
    th.updated_at
  FROM located l
  JOIN public.threads th ON th.id = l.thread_id
  WHERE th.user_id = auth.uid()
  ORDER BY th.updated_at DESC
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.search_messages(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_messages(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_messages(text) TO service_role;