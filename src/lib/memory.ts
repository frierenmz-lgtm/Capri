export type CapriMemoryRow = { content: string; category: string; updated_at: string };

/** Select up to ten explicitly saved memories by lexical overlap with the latest user turn. */
export function selectRelevantMemories(rows: CapriMemoryRow[], query: string): string {
  const terms = new Set((query.toLocaleLowerCase("es-MX").match(/[\p{L}\p{N}]{3,}/gu) ?? []).slice(0, 80));
  const ranked = rows.map((row, index) => {
    const text = `${row.category} ${row.content}`.toLocaleLowerCase("es-MX");
    let score = 0;
    for (const term of terms) if (text.includes(term)) score += 1;
    return { row, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const matching = ranked.filter((item) => item.score > 0).slice(0, 10);
  const selected = matching.length ? matching : ranked.slice(0, 5);
  return selected.map(({ row }) => `- [${row.category}] ${row.content}`).join("\n").slice(0, 4500);
}
