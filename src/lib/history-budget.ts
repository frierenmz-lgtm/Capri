import type { UIMessage } from "ai";

/**
 * History budget for the model. The whole thread used to go to the model on
 * every turn, so input tokens grew with the conversation: a long thread could
 * send tens of thousands of characters of history per reply. Now only the
 * most recent messages fit in MAX_HISTORY_CHARS (about 3,000 tokens at
 * ~4 chars/token); older turns stay out of the prompt. The automatic memory
 * system (capri_memories) carries the facts that matter, so trimming the tail
 * does not lose what the user taught Capri.
 */
export const MAX_HISTORY_CHARS = 12_000;

/** Rough token-cost estimate of one file part, in characters. Inline image/PDF data is base64, so its raw length says nothing about its cost to the model; a fixed estimate keeps one attachment from eating the whole budget. */
const FILE_PART_CHARS = 1_000;

/** Rough cost of one message part, in characters. Tool calls, reasoning and sources carry no text cost here. */
export function partCost(part: UIMessage["parts"][number]): number {
  if (part.type === "text") return part.text.length;
  if (part.type === "file") return FILE_PART_CHARS;
  return 0;
}

export function messageCost(m: UIMessage): number {
  return m.parts.reduce((n, p) => n + partCost(p), 0);
}

/**
 * Keep the most recent messages that fit in the budget, always keeping the
 * last message (the current turn) even if it alone exceeds the budget.
 */
export function trimHistory(messages: UIMessage[], maxChars = MAX_HISTORY_CHARS): UIMessage[] {
  let total = 0;
  let start = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = messageCost(messages[i]!);
    if (i < messages.length - 1 && total + cost > maxChars) break;
    total += cost;
    start = i;
  }
  return messages.slice(start);
}
