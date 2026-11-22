import { documentText } from "./images";

/** Most project files Capri reads as context in a single turn. */
export const MAX_PROJECT_FILES = 4;
/** Total text characters from project files in a single turn. */
export const MAX_PROJECT_CONTEXT_CHARS = 24_000;
export const MAX_PROJECT_NAME = 80;

/** Most recent files first, capped so a project never floods the model's context. */
export function selectProjectFiles<T extends { created_at: string }>(files: T[], maxFiles = MAX_PROJECT_FILES): T[] {
  return [...files].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, maxFiles);
}

/**
 * Shares the text budget across the downloaded files, in order. Files past the
 * budget are cut (or dropped when nothing is left); callers keep the note.
 */
export function budgetProjectTexts(
  files: { name: string; text: string }[],
  maxChars = MAX_PROJECT_CONTEXT_CHARS,
): { name: string; text: string; cut: boolean }[] {
  let remaining = maxChars;
  return files.map(({ name, text }) => {
    if (remaining <= 0) return { name, text: "", cut: text.length > 0 };
    const body = text.slice(0, remaining);
    remaining -= body.length;
    return { name, text: body, cut: text.length > body.length };
  });
}

/** Project instructions replace the account default; an empty project falls back to it. */
export function pickFallbackInstructions(
  project?: string | null,
  defaults?: string | null,
): string | null | undefined {
  return project?.trim() ? project : defaults;
}

/** The text block Capri receives for one project text file. */
export function projectFileText(name: string, content: string): string {
  return documentText(name, content);
}
