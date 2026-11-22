import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { authHeaders } from "./voice";
import { QUIZ_COUNTS } from "./study-quiz";

export { MAX_QUIZ_QUESTIONS, MIN_QUIZ_QUESTIONS, QUIZ_COUNTS } from "./study-quiz";
export { parseQuizJson, scoreQuiz } from "./study-quiz";
export type { GeneratedQuestion } from "./study-quiz";

export type StudyQuiz = {
  id: string;
  project_id: string | null;
  topic: string;
  question_count: number;
  score: number | null;
  completed_at: string | null;
  created_at: string;
};

export type StudyQuestion = {
  id: string;
  quiz_id: string;
  question: string;
  options: string[];
  answer_index: number;
  explanation: string;
  user_answer: number | null;
};

export const quizzesQuery = queryOptions({
  queryKey: ["study-quizzes"],
  queryFn: async (): Promise<StudyQuiz[]> => {
    const { data, error } = await supabase
      .from("study_quizzes")
      .select("id,project_id,topic,question_count,score,completed_at,created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  },
});

export const quizQuery = (quizId: string) =>
  queryOptions({
    queryKey: ["study-quiz", quizId],
    queryFn: async (): Promise<{ quiz: StudyQuiz | null; questions: StudyQuestion[] }> => {
      const [{ data: quiz, error: quizError }, { data: questions, error: questionsError }] = await Promise.all([
        supabase
          .from("study_quizzes")
          .select("id,project_id,topic,question_count,score,completed_at,created_at")
          .eq("id", quizId)
          .maybeSingle(),
        supabase
          .from("study_questions")
          .select("id,quiz_id,question,options,answer_index,explanation,user_answer")
          .eq("quiz_id", quizId)
          .order("created_at", { ascending: true }),
      ]);
      if (quizError) throw quizError;
      if (questionsError) throw questionsError;
      return { quiz, questions: (questions ?? []) as StudyQuestion[] };
    },
  });

async function studyError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === "string" && body.error ? body.error : fallback;
  } catch {
    return fallback;
  }
}

/** Asks the server to generate a quiz and returns its id. */
export async function generateQuiz(args: {
  projectId?: string | null;
  topic?: string;
  count?: number;
}): Promise<string> {
  const count =
    typeof args.count === "number" && QUIZ_COUNTS.includes(args.count as 5 | 10) ? args.count : 5;
  const res = await fetch("/api/study", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ projectId: args.projectId ?? null, topic: args.topic ?? "", count }),
  });
  if (!res.ok) throw new Error(await studyError(res, "No se pudo generar el cuestionario."));
  const body = (await res.json()) as { quizId?: unknown };
  if (typeof body.quizId !== "string") throw new Error("No se pudo generar el cuestionario.");
  return body.quizId;
}

export async function saveAnswer(questionId: string, userAnswer: number) {
  const { error } = await supabase
    .from("study_questions")
    .update({ user_answer: userAnswer })
    .eq("id", questionId);
  if (error) throw error;
}

export async function finishQuiz(quizId: string, score: number) {
  const { error } = await supabase
    .from("study_quizzes")
    .update({ score, completed_at: new Date().toISOString() })
    .eq("id", quizId);
  if (error) throw error;
}

export async function deleteQuiz(quizId: string) {
  const { error } = await supabase.from("study_quizzes").delete().eq("id", quizId);
  if (error) throw error;
}
