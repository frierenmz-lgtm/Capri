import { createGroq } from "@ai-sdk/groq";
import { streamText } from "ai";
import { authenticate, json } from "./auth-request.server";
import {
  ChatAttachmentLimitError,
  type ChatAttachmentMetadataCache,
  validateChatAttachment,
} from "./chat-attachment-limits.server";
import { IMAGE_BUCKET, IMAGE_SCHEME, attachmentKind, ownsImagePath } from "./images";
import { DEFAULT_CHAT_MODEL } from "./models";
import { budgetProjectTexts, projectFileText, selectProjectFiles } from "./project-context";
import { MAX_QUIZ_QUESTIONS, MIN_QUIZ_QUESTIONS, parseQuizJson } from "./study-quiz";

/**
 * POST /api/study — generates a multiple-choice quiz from a project's text
 * files or from a free topic, saves it, and returns its id. Text files only:
 * images and PDFs are skipped (the chat already reads them, but the quiz
 * generator works on plain text).
 */
export async function handleStudyGenerate(request: Request) {
  const auth = await authenticate(request);
  if ("error" in auth) return auth.error;
  const { supabase, userId } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, "Solicitud inválida.");
  }
  const { projectId, topic, count } = (body ?? {}) as {
    projectId?: unknown;
    topic?: unknown;
    count?: unknown;
  };
  const questionCount =
    typeof count === "number" && Number.isInteger(count)
      ? Math.max(MIN_QUIZ_QUESTIONS, Math.min(MAX_QUIZ_QUESTIONS, count))
      : 5;
  const cleanTopic = typeof topic === "string" ? topic.trim().slice(0, 200) : "";

  let project: { id: string; name: string } | null = null;
  let sourceText = "";
  if (typeof projectId === "string" && projectId) {
    const { data } = await supabase
      .from("projects")
      .select("id,name")
      .eq("id", projectId)
      .maybeSingle();
    if (!data) return json(404, "Proyecto no encontrado.");
    project = data;
    const { data: fileRows } = await supabase
      .from("project_files")
      .select("name,storage_path,media_type,created_at")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false });
    const selectedTexts = selectProjectFiles(fileRows ?? []).filter(
      (file) =>
        ownsImagePath(file.storage_path, userId) &&
        attachmentKind(file.media_type, file.name) === "text",
    );
    const metadataCache: ChatAttachmentMetadataCache = new Map();
    let validatedTexts: { file: (typeof selectedTexts)[number]; path: string }[];
    try {
      validatedTexts = await Promise.all(
        selectedTexts.map(async (file) => ({
          file,
          path: await validateChatAttachment(
            supabase,
            userId,
            {
              type: "file",
              mediaType: file.media_type,
              filename: file.name,
              url: `${IMAGE_SCHEME}${file.storage_path}`,
            },
            metadataCache,
          ),
        })),
      );
    } catch (error) {
      if (error instanceof ChatAttachmentLimitError) return json(error.status, error.message);
      throw error;
    }
    const texts: { name: string; text: string }[] = [];
    for (const { file, path } of validatedTexts) {
      const { data: blob, error } = await supabase.storage.from(IMAGE_BUCKET).download(path);
      if (error || !blob) continue;
      texts.push({ name: file.name, text: await blob.text() });
    }
    const budgeted = budgetProjectTexts(texts);
    sourceText = budgeted
      .filter((t) => t.text)
      .map((t) => projectFileText(t.name, t.text))
      .join("\n\n");
  }
  if (!sourceText && !cleanTopic) {
    return json(
      400,
      "Elige un proyecto con archivos de texto o escribe un tema para el cuestionario.",
    );
  }
  if (project && !sourceText && !cleanTopic) {
    return json(
      400,
      "Este proyecto no tiene archivos de texto para estudiar. Sube apuntes en .txt o .md, o genera el cuestionario por tema.",
    );
  }

  const title = cleanTopic || project?.name || "Cuestionario";
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) return json(500, "Falta configurar la IA.");

  const material = sourceText
    ? `Material de estudio:\n${sourceText}`
    : `Tema: ${cleanTopic}\nGenera las preguntas sobre este tema.`;
  let raw: string;
  try {
    const result = await streamText({
      // The Groq provider returns LanguageModelV4 while streamText expects
      // LanguageModel (duplicate @ai-sdk/provider in the tree); same cast
      // would be needed anywhere a model is passed.
      model: createGroq({ apiKey })(DEFAULT_CHAT_MODEL) as Parameters<
        typeof streamText
      >[0]["model"],
      instructions:
        `Genera un cuestionario de opción múltiple en español. Devuelve EXCLUSIVAMENTE un JSON válido con la forma ` +
        `{"questions":[{"question":"...","options":["...","...","...","..."],"answer":0,"explanation":"..."}]}. ` +
        `Reglas: exactamente ${questionCount} preguntas; cada pregunta tiene 4 opciones y solo una correcta; ` +
        `las opciones incorrectas deben ser plausibles, no absurdas; la respuesta correcta no siempre en la misma posición; ` +
        `la explicación es breve (1 o 2 frases) y dice por qué es correcta; pregunta sobre el contenido, no sobre el formato; ` +
        `si el material es corto, no inventes datos fuera de él.`,
      prompt: material,
      maxOutputTokens: 3000,
    });
    raw = (await result.text).trim();
  } catch (e) {
    console.error("study generation", e);
    return json(500, "No se pudo generar el cuestionario. Inténtalo de nuevo.");
  }

  const questions = parseQuizJson(raw, questionCount);
  if (!questions) {
    console.error("study generation: invalid quiz JSON");
    return json(500, "No se pudo generar el cuestionario. Inténtalo de nuevo.");
  }

  const { data: quiz, error: quizError } = await supabase
    .from("study_quizzes")
    .insert({
      user_id: userId,
      project_id: project?.id ?? null,
      topic: title,
      question_count: questions.length,
    })
    .select("id")
    .single();
  if (quizError || !quiz) {
    console.error("study save quiz", quizError);
    return json(500, "No se pudo guardar el cuestionario.");
  }
  const { error: questionsError } = await supabase.from("study_questions").insert(
    questions.map((q) => ({
      quiz_id: quiz.id,
      user_id: userId,
      question: q.question,
      options: q.options,
      answer_index: q.answer_index,
      explanation: q.explanation,
    })),
  );
  if (questionsError) {
    console.error("study save questions", questionsError);
    await supabase.from("study_quizzes").delete().eq("id", quiz.id);
    return json(500, "No se pudo guardar el cuestionario.");
  }
  return Response.json({ quizId: quiz.id });
}
