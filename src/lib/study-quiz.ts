/** A generated multiple-choice question: exactly 4 options, one correct answer. */
export type GeneratedQuestion = {
  question: string;
  options: [string, string, string, string];
  answer_index: 0 | 1 | 2 | 3;
  explanation: string;
};

export const MIN_QUIZ_QUESTIONS = 1;
export const MAX_QUIZ_QUESTIONS = 10;
export const QUIZ_COUNTS = [5, 10] as const;

/**
 * Parses and validates the model's quiz JSON. Returns null when the shape is
 * wrong so the caller can retry or fail with a clear message instead of
 * saving a broken quiz.
 */
export function parseQuizJson(raw: string, count: number): GeneratedQuestion[] | null {
  let parsed: unknown;
  try {
    const clean = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    parsed = JSON.parse(clean);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { questions?: unknown }).questions)) {
    return null;
  }
  const questions = (parsed as { questions: unknown[] }).questions;
  if (questions.length === 0) return null;
  const out: GeneratedQuestion[] = [];
  for (const item of questions.slice(0, count)) {
    if (!item || typeof item !== "object") return null;
    const { question, options, answer, explanation } = item as {
      question?: unknown;
      options?: unknown;
      answer?: unknown;
      explanation?: unknown;
    };
    if (typeof question !== "string" || !question.trim()) return null;
    if (!Array.isArray(options) || options.length !== 4) return null;
    const texts = options.map((o) => (typeof o === "string" ? o.trim() : ""));
    if (texts.some((t) => !t)) return null;
    if (typeof answer !== "number" || !Number.isInteger(answer) || answer < 0 || answer > 3) return null;
    out.push({
      question: question.trim().slice(0, 500),
      options: texts as [string, string, string, string],
      answer_index: answer as 0 | 1 | 2 | 3,
      explanation: typeof explanation === "string" ? explanation.trim().slice(0, 500) : "",
    });
  }
  return out.length > 0 ? out : null;
}

/** Counts the correct answers in a finished quiz. */
export function scoreQuiz(
  questions: { answer_index: number; user_answer: number | null }[],
): { correct: number; total: number } {
  const total = questions.length;
  const correct = questions.filter((q) => q.user_answer !== null && q.user_answer === q.answer_index).length;
  return { correct, total };
}
