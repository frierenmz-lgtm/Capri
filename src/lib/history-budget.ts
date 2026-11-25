import type { UIMessage } from "ai";
import { DOCUMENT_ATTACHMENT_PREFIX } from "./images";

/**
 * History budget for the model. The whole thread used to go to the model on
 * every turn, so input tokens grew with the conversation: a long thread could
 * send tens of thousands of characters of history per reply. Now only the most
 * recent messages fit in MAX_HISTORY_CHARS (about 3,000 tokens at ~4 chars/token).
 */
export const MAX_HISTORY_CHARS = 12_000;

/** Rough token-cost estimate of one file part, in characters. Inline image/PDF data is base64, so its raw length says nothing about its cost to the model; a fixed estimate keeps one attachment from eating the whole budget. */
const FILE_PART_CHARS = 1_000;
const HISTORY_TRUNCATION_NOTE =
  "\n[El contenido se recortó para respetar el límite del historial.]";
const ATTACHMENT_TRUNCATION_NOTE =
  "\n[Uno o más adjuntos se recortaron u omitieron por el límite del historial.]";
export const OLDER_ATTACHMENT_HISTORY_NOTE =
  "\n[Se omitieron adjuntos de mensajes anteriores por el límite del historial.]";

type MessageFit = {
  message: UIMessage;
  changed: boolean;
  attachmentChanged: boolean;
};

/** Rough cost of one message part, in characters. Tool calls, reasoning and sources carry no text cost here. */
export function partCost(part: UIMessage["parts"][number]): number {
  if (part.type === "text") return part.text.length;
  if (part.type === "file") return FILE_PART_CHARS;
  return 0;
}

export function messageCost(message: UIMessage): number {
  return message.parts.reduce((total, part) => total + partCost(part), 0);
}

/** Keep the newest contiguous suffix that fits; shorten the last message if needed. */
export function retainRecentMessagesWithinBudget(
  messages: UIMessage[],
  maxChars: number,
): UIMessage[] {
  const budget = Math.max(0, maxChars);
  let total = 0;
  let start = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    const cost = messageCost(message);
    if (i === messages.length - 1 && cost > budget) {
      return [trimMessageToBudget(message, budget)];
    }
    if (i < messages.length - 1 && total + cost > budget) break;
    total += cost;
    start = i;
  }
  return messages.slice(start);
}

function isAttachmentText(part: UIMessage["parts"][number]): boolean {
  return part.type === "text" && part.text.startsWith(DOCUMENT_ATTACHMENT_PREFIX);
}

function fitMessage(message: UIMessage, maxChars: number): MessageFit {
  let remaining = Math.max(0, maxChars);
  let changed = false;
  let attachmentChanged = false;
  const parts: UIMessage["parts"] = [];

  for (const part of message.parts) {
    if (part.type === "text") {
      if (part.text.length <= remaining) {
        parts.push(part);
        remaining -= part.text.length;
      } else {
        if (remaining > 0) parts.push({ ...part, text: part.text.slice(0, remaining) });
        changed = true;
        attachmentChanged ||= isAttachmentText(part);
        remaining = 0;
      }
      continue;
    }

    const cost = partCost(part);
    if (cost === 0 || cost <= remaining) {
      parts.push(part);
      remaining -= cost;
    } else {
      changed = true;
      attachmentChanged ||= part.type === "file";
    }
  }

  return { message: { ...message, parts }, changed, attachmentChanged };
}

/** Shorten text and drop fixed-cost parts as needed so one message fits the budget. */
export function trimMessageToBudget(
  message: UIMessage,
  maxChars: number,
  extraNotice?: string,
): UIMessage {
  const budget = Math.max(0, maxChars);
  const visibleExtraNotice = extraNotice && extraNotice.length <= budget ? extraNotice : "";
  const contentBudget = budget - visibleExtraNotice.length;
  const initialFit = fitMessage(message, contentBudget);

  if (!initialFit.changed) {
    return visibleExtraNotice
      ? {
          ...initialFit.message,
          parts: [...initialFit.message.parts, { type: "text", text: visibleExtraNotice }],
        }
      : initialFit.message;
  }

  // Reserve space before trimming content so its warning survives even when
  // text, images, PDFs, and document parts share the same message budget.
  const canContainAttachment = message.parts.some(
    (part) => part.type === "file" || isAttachmentText(part),
  );
  const noteReserve = canContainAttachment
    ? ATTACHMENT_TRUNCATION_NOTE.length
    : HISTORY_TRUNCATION_NOTE.length;
  const reservedChars = contentBudget >= noteReserve ? noteReserve : 0;
  const finalFit = fitMessage(message, contentBudget - reservedChars);
  const note = finalFit.attachmentChanged ? ATTACHMENT_TRUNCATION_NOTE : HISTORY_TRUNCATION_NOTE;
  const visibleNote = reservedChars ? note : "";
  const noticeParts: UIMessage["parts"] = [
    ...(visibleNote ? [{ type: "text" as const, text: visibleNote }] : []),
    ...(visibleExtraNotice ? [{ type: "text" as const, text: visibleExtraNotice }] : []),
  ];

  return { ...finalFit.message, parts: [...finalFit.message.parts, ...noticeParts] };
}

/**
 * Keep the most recent messages that fit in the budget, always keeping the
 * last message and warning when an older attachment had to be omitted.
 */
export function trimHistory(messages: UIMessage[], maxChars = MAX_HISTORY_CHARS): UIMessage[] {
  const budget = Math.max(0, maxChars);
  let retained = retainRecentMessagesWithinBudget(messages, budget);
  const start = messages.length - retained.length;
  const olderAttachmentsOmitted = messages
    .slice(0, start)
    .some((message) => message.parts.some((part) => part.type === "file"));
  if (
    olderAttachmentsOmitted &&
    retained.length > 0 &&
    OLDER_ATTACHMENT_HISTORY_NOTE.length <= budget
  ) {
    // Re-select the suffix with the complete warning already reserved, so
    // earlier retained messages cannot consume the space it needs.
    retained = retainRecentMessagesWithinBudget(
      messages,
      budget - OLDER_ATTACHMENT_HISTORY_NOTE.length,
    );
  }
  if (olderAttachmentsOmitted && retained.length > 0) {
    const lastIndex = retained.length - 1;
    const otherCost = retained
      .slice(0, lastIndex)
      .reduce((sum, message) => sum + messageCost(message), 0);
    retained[lastIndex] = trimMessageToBudget(
      retained[lastIndex]!,
      Math.max(0, budget - otherCost),
      OLDER_ATTACHMENT_HISTORY_NOTE,
    );
  }
  return retained;
}
