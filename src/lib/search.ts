import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Message-content search only runs once the query has at least this many characters. */
export const MIN_SEARCH = 2;

export type MessageHit = { thread_id: string; title: string; snippet: string; updated_at: string };

export const messageSearchQuery = (term: string) =>
  queryOptions({
    queryKey: ["search", term],
    queryFn: async (): Promise<MessageHit[]> => {
      const { data, error } = await supabase.rpc("search_messages", { q: term });
      if (error) throw error;
      return (data ?? []) as MessageHit[];
    },
    enabled: term.trim().length >= MIN_SEARCH,
    staleTime: 30_000,
  });

/** Lowercases and strips accents so "Canción" and "cancion" compare equal. */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** True when `text` contains `term`, ignoring case and accents. */
export function matchesTerm(text: string, term: string): boolean {
  const t = foldText(term.trim());
  return t.length > 0 && foldText(text).includes(t);
}

/** Splits text into chunks, flagging the ones that match the term (ignoring case and accents). */
export function splitHighlight(text: string, term: string): { text: string; match: boolean }[] {
  const needle = foldText(term.trim());
  if (!needle) return [{ text, match: false }];

  // Fold char by char, remembering which original char each folded char came from.
  const chars = Array.from(text);
  let folded = "";
  const origin: number[] = [];
  chars.forEach((c, i) => {
    const f = foldText(c);
    folded += f;
    for (let k = 0; k < f.length; k++) origin.push(i);
  });

  const out: { text: string; match: boolean }[] = [];
  let cursor = 0; // index into chars
  let from = 0; // index into folded
  for (;;) {
    const at = folded.indexOf(needle, from);
    if (at === -1) break;
    const start = origin[at] ?? cursor;
    const end = (origin[at + needle.length - 1] ?? chars.length - 1) + 1;
    if (start > cursor) out.push({ text: chars.slice(cursor, start).join(""), match: false });
    out.push({ text: chars.slice(start, end).join(""), match: true });
    cursor = end;
    from = at + needle.length;
  }
  if (cursor < chars.length) out.push({ text: chars.slice(cursor).join(""), match: false });
  return out;
}

/** Removes Markdown symbols (bold, headings, lists, code, links) so snippets read as plain text. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`{1,3}/g, "")
    .replace(/(\*\*|__|\*|~~)/g, "")
    .replace(/(^|\s)#{1,6}\s+/g, "$1")
    .replace(/(^|\s)>\s+/g, "$1")
    .replace(/(^|\s)[-+]\s+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}
