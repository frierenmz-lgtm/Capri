import { describe, expect, it } from "vitest";
import { parseQuizJson, scoreQuiz } from "@/lib/study-quiz";

const valid = JSON.stringify({
  questions: [
    {
      question: "¿Cuánto es 2 + 2?",
      options: ["3", "4", "5", "6"],
      answer: 1,
      explanation: "2 + 2 es 4.",
    },
    {
      question: "¿Capital de México?",
      options: ["Guadalajara", "Monterrey", "Ciudad de México", "Puebla"],
      answer: 2,
      explanation: "La capital es Ciudad de México.",
    },
  ],
});

describe("quiz generation JSON", () => {
  it("parses a valid quiz", () => {
    const out = parseQuizJson(valid, 5);
    expect(out).toHaveLength(2);
    expect(out?.[0]?.options).toHaveLength(4);
    expect(out?.[0]?.answer_index).toBe(1);
  });

  it("parses JSON wrapped in a code fence", () => {
    expect(parseQuizJson(`\`\`\`json\n${valid}\n\`\`\``, 5)).toHaveLength(2);
  });

  it("caps the questions at the requested count", () => {
    expect(parseQuizJson(valid, 1)).toHaveLength(1);
  });

  it("rejects malformed JSON", () => {
    expect(parseQuizJson("no es json", 5)).toBeNull();
  });

  it("rejects a quiz without questions", () => {
    expect(parseQuizJson(JSON.stringify({ questions: [] }), 5)).toBeNull();
  });

  it("rejects options that are not exactly 4", () => {
    const bad = JSON.stringify({
      questions: [{ question: "Q", options: ["a", "b"], answer: 0, explanation: "" }],
    });
    expect(parseQuizJson(bad, 5)).toBeNull();
  });

  it("rejects an answer index outside 0-3", () => {
    const bad = JSON.stringify({
      questions: [{ question: "Q", options: ["a", "b", "c", "d"], answer: 4, explanation: "" }],
    });
    expect(parseQuizJson(bad, 5)).toBeNull();
  });

  it("rejects an empty question", () => {
    const bad = JSON.stringify({
      questions: [{ question: "   ", options: ["a", "b", "c", "d"], answer: 0, explanation: "" }],
    });
    expect(parseQuizJson(bad, 5)).toBeNull();
  });
});

describe("quiz score", () => {
  it("counts only the correct answers", () => {
    expect(
      scoreQuiz([
        { answer_index: 1, user_answer: 1 },
        { answer_index: 2, user_answer: 0 },
        { answer_index: 0, user_answer: null },
      ]),
    ).toEqual({ correct: 1, total: 3 });
  });
});
