import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type LanguageModel,
  type UIMessage,
} from "ai";
import { authenticate, json, type UserClient } from "./auth-request.server";
import { buildSystemPrompt } from "./instructions";
import { selectRelevantMemories } from "./memory";
import { MAX_CHAT_REQUEST_BYTES, parseChatRequest } from "./chat-request";
import {
  ChatAttachmentLimitError,
  type ChatAttachmentMetadataCache,
  downloadChatAttachmentBytes,
  readChatAttachmentMetadata,
  validateChatAttachment,
  validateChatMessageAttachments,
} from "./chat-attachment-limits.server";
import { parseCustomChatModelConfig } from "./chat-model-config";
import {
  IMAGE_SCHEME,
  MAX_DOCUMENT_CHARS,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  attachmentKind,
  documentText,
  imagePath,
  ownsImagePath,
} from "./images";
import { WEB_SEARCH_TOOL_NAME, createWebSearchTool } from "./web-search";
import {
  CUSTOM_CHAT_MODEL_ID,
  CUSTOM_CHAT_MODEL_NAME,
  DEFAULT_CHAT_MODEL,
  resolveChatModel,
} from "./models";
import {
  budgetProjectTexts,
  pickFallbackInstructions,
  projectFileText,
  selectProjectFiles,
} from "./project-context";
import {
  MAX_HISTORY_CHARS,
  messageCost,
  OLDER_ATTACHMENT_HISTORY_NOTE,
  partCost,
  retainRecentMessagesWithinBudget,
  trimMessageToBudget,
} from "./history-budget";

// The Groq/OpenAI adapters and `ai` currently resolve compatible V4 model
// interfaces from different @ai-sdk/provider patch versions.
const asLanguageModel = (model: unknown): LanguageModel => model as LanguageModel;

export async function handleChat(request: Request) {
  const auth = await authenticate(request);
  if ("error" in auth) return auth.error;
  const { supabase, userId } = auth;

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_CHAT_REQUEST_BYTES)
    return json(413, "La solicitud es demasiado grande.");

  const rawBody = await readBoundedBody(request, MAX_CHAT_REQUEST_BYTES);
  if (rawBody === null) return json(413, "La solicitud es demasiado grande.");
  const body = parseChatRequest(rawBody);
  if (!body) return json(400, "Solicitud inválida o demasiado grande.");
  const { messages, threadId } = body;

  const [{ data: thread }, { data: settings }, { data: memoryRows, error: memoryError }] =
    await Promise.all([
      supabase
        .from("threads")
        .select("id,title,custom_instructions,model,project_id")
        .eq("id", threadId)
        .maybeSingle(),
      supabase
        .from("user_settings")
        .select("default_instructions,memory_auto_enabled")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("capri_memories")
        .select("id,content,category,updated_at,importance,expires_at")
        .eq("user_id", userId)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order("importance", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(50),
    ]);
  if (!thread) return json(404, "Conversación no encontrada.");
  if (memoryError) console.error("load capri memories", memoryError);
  // A thread in a project uses the project's instructions (unless the thread has
  // its own) and reads the project's files as context on every turn.
  const project = thread.project_id
    ? (
        await supabase
          .from("projects")
          .select("id,name,instructions")
          .eq("id", thread.project_id)
          .maybeSingle()
      ).data
    : null;
  const projectFileRows = project
    ? ((
        await supabase
          .from("project_files")
          .select("id,name,storage_path,media_type,created_at")
          .eq("project_id", project.id)
          .order("created_at", { ascending: false })
      ).data ?? [])
    : [];
  const fallbackInstructions = pickFallbackInstructions(
    project?.instructions,
    settings?.default_instructions,
  );
  const latestUserText =
    messages
      .filter((m) => m.role === "user")
      .slice(-1)[0]
      ?.parts.map((part) => (part.type === "text" ? part.text : ""))
      .join(" ") ?? "";
  const memories = selectRelevantMemories(memoryRows ?? [], latestUserText);
  const chatModelId = resolveChatModel(thread.model);
  const isCustomModel = chatModelId === CUSTOM_CHAT_MODEL_ID;
  const system = buildSystemPrompt(
    thread.custom_instructions,
    fallbackInstructions,
    memories,
    !isCustomModel,
  );

  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) return json(500, "Falta configurar la IA.");
  const provider = createGroq({ apiKey });

  // Validate custom model configuration before persisting the user's message.
  let chatModel: LanguageModel;
  if (isCustomModel) {
    const customConfig = parseCustomChatModelConfig(
      process.env["CAPRI_CUSTOM_MODEL_URL"],
      process.env["CAPRI_CUSTOM_MODEL_KEY"],
    );
    if (!customConfig) return json(500, "El modelo de Capri no está configurado todavía.");
    chatModel = asLanguageModel(
      createOpenAI({ baseURL: customConfig.baseURL, apiKey: customConfig.apiKey })(
        CUSTOM_CHAT_MODEL_NAME,
      ),
    );
  } else {
    chatModel = asLanguageModel(provider(chatModelId));
  }

  const preflightMetadataCache: ChatAttachmentMetadataCache = new Map();

  // Trim first so attachments in discarded messages are never downloaded.
  let modelMessages: UIMessage[];
  try {
    modelMessages = await resolveTrimmedAttachments(
      supabase,
      userId,
      messages,
      preflightMetadataCache,
      request.signal,
    );
  } catch (e) {
    console.error("resolve attachments", e);
    const error = e instanceof Error ? e : new Error("No se pudo leer un archivo adjunto.");
    const status = e instanceof ChatAttachmentLimitError ? e.status : 400;
    return json(status, error.message || "No se pudo leer un archivo adjunto.");
  }

  // Project files ride along as a leading message (never saved): the model sees
  // them on every turn of a thread that belongs to a project.
  let contextMessages: UIMessage[] = modelMessages;
  if (project) {
    let projectParts: Awaited<ReturnType<typeof projectContextParts>>;
    try {
      projectParts = await projectContextParts(supabase, userId, projectFileRows, request.signal);
    } catch (e) {
      console.error("project context files", e);
      const error = e instanceof Error ? e : new Error("No se pudo leer un archivo del proyecto.");
      const status = e instanceof ChatAttachmentLimitError ? e.status : 400;
      return json(status, error.message || "No se pudo leer un archivo del proyecto.");
    }
    const { parts, omitted, cut } = projectParts;
    if (parts.length > 0) {
      const note = [
        `Archivos del proyecto «${project.name}». Úsalos como contexto para responder.`,
        omitted > 0
          ? `Se incluyen los ${parts.length} más recientes; el proyecto tiene ${omitted} más.`
          : "",
        cut ? "Algunos archivos se recortaron por longitud." : "",
      ]
        .filter(Boolean)
        .join(" ");
      contextMessages = [
        { id: "project-files", role: "user", parts: [{ type: "text", text: note }, ...parts] },
        ...modelMessages,
      ];
    }
  }

  // Persist only after every retained chat and project-file stream has passed
  // its real byte limit; metadata alone cannot rule out an oversized object.
  const last = messages[messages.length - 1]!;
  if (last.role === "user") {
    try {
      await validateChatMessageAttachments(supabase, userId, last, preflightMetadataCache);
    } catch (e) {
      const error = e instanceof Error ? e : new Error("No se pudo validar un archivo adjunto.");
      const status = e instanceof ChatAttachmentLimitError ? e.status : 400;
      return json(status, error.message);
    }
    const { error } = await saveUserMessage(supabase, threadId, userId, last);
    if (error) {
      console.error("save user message", error);
      return json(500, "No se pudo guardar tu mensaje.");
    }
    if (thread.title === "Nueva conversación") {
      const text = last.parts
        .map((p) => (p.type === "text" ? p.text : ""))
        .join(" ")
        .trim();
      if (text)
        await supabase
          .from("threads")
          .update({ title: text.slice(0, 60) })
          .eq("id", threadId);
    }
  }

  const today = new Date().toLocaleDateString("es-MX", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Mexico_City",
  });
  const now = new Date().toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Mexico_City",
  });

  const result = streamText({
    model: chatModel,
    instructions: `${system}\n\nHoy es ${today} y son las ${now} (hora de Ciudad de México, UTC-06:00).${project ? `\nEstás en el proyecto «${project.name}».` : ""}`,
    messages: await convertToModelMessages(contextMessages),
    // Web search via Tavily; at most two searches per turn (one credit each on the free plan).
    // The fine-tuned model has no search tool, so it gets none.
    ...(isCustomModel
      ? {}
      : { tools: { [WEB_SEARCH_TOOL_NAME]: createWebSearchTool(process.env["TAVILY_API_KEY"]) } }),
    stopWhen: stepCountIs(3),
    abortSignal: request.signal,
  });

  const response = result.toUIMessageStreamResponse({
    originalMessages: messages,
    // Do not send or persist reasoning summaries: the UI does not render them.
    sendSources: true,
    sendReasoning: false,
    // Every reply needs its own id; without it each reply is saved under the same empty id and overwrites the last one.
    generateMessageId: () => crypto.randomUUID(),
    onError: (error) => {
      console.error("chat stream error", error);
      const status = (error as { statusCode?: number })?.statusCode;
      if (status === 429) return "Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.";
      if (status === 402) return "Se agotaron los créditos de IA.";
      return "Capri no pudo responder. Inténtalo de nuevo.";
    },
    onFinish: async ({ responseMessage }) => {
      if (!responseMessage.parts.length) return;
      const { error } = await supabase.from("messages").upsert(
        {
          thread_id: threadId,
          user_id: userId,
          message_id: responseMessage.id,
          role: "assistant",
          parts: responseMessage.parts.filter((part) => part.type !== "reasoning") as never,
        },
        { onConflict: "thread_id,message_id" },
      );
      if (error) console.error("save assistant message", error);
      // Automatic memory extraction uses only facts explicitly stated by the user.
      try {
        const latestUser = messages.filter((message) => message.role === "user").slice(-1)[0];
        const userText = latestUser ? textOf(latestUser) : "";
        if (settings?.memory_auto_enabled !== false && userText.length >= 24)
          await extractAndSaveMemories(provider, supabase, userId, userText);
      } catch (e) {
        console.error("automatic memory extraction", e);
      }
      await supabase
        .from("threads")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", threadId);
      const userTurns = messages.filter((m) => m.role === "user").length;
      if (userTurns === 1) {
        try {
          const title = await generateTitle(provider, messages, responseMessage);
          if (title) await supabase.from("threads").update({ title }).eq("id", threadId);
        } catch (e) {
          console.error("title generation", e);
        }
      }
    },
  });

  return response;
}

type ExtractedMemory = {
  category: "preferencia" | "proyecto" | "objetivo" | "contexto" | "otro";
  content: string;
  importance: number;
  expiresInDays: number | null;
};

async function extractAndSaveMemories(
  provider: ReturnType<typeof createGroq>,
  supabase: UserClient,
  userId: string,
  userText: string,
) {
  const result = await streamText({
    model: asLanguageModel(provider(DEFAULT_CHAT_MODEL)),
    instructions: `Extrae de lo que el usuario acaba de decir entre cero y tres recuerdos útiles para futuras conversaciones. Devuelve exclusivamente un JSON válido con la forma {"memories":[{"category":"preferencia|proyecto|objetivo|contexto|otro","content":"...","importance":1,"expiresInDays":null}]}. Guarda solo información explícita, estable y útil: preferencias de respuesta, proyectos, objetivos y contexto de trabajo. No guardes datos sensibles (salud, religión, política, sexualidad, datos financieros privados), secretos, contraseñas, datos de terceros, información pasajera ni suposiciones. No conviertas preguntas o hipótesis en hechos. Cada recuerdo debe ser una frase breve, en primera persona cuando corresponda, máximo 300 caracteres. importance va de 1 a 5. expiresInDays es null para recuerdos duraderos o un número de 7 a 365 para datos temporales. Si no hay nada claro, devuelve {"memories":[]}.`,
    prompt: `Mensaje del usuario:\n${userText.slice(0, 3000)}`,
    maxOutputTokens: 500,
  });
  const raw = (await result.text)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = JSON.parse(raw) as { memories?: ExtractedMemory[] };
  if (!Array.isArray(parsed.memories)) return;
  const allowed = new Set(["preferencia", "proyecto", "objetivo", "contexto", "otro"]);
  const { data: existing } = await supabase
    .from("capri_memories")
    .select("id,category,content,source")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(100);
  for (const item of parsed.memories.slice(0, 3)) {
    if (!allowed.has(item.category) || typeof item.content !== "string") continue;
    const content = item.content.trim().slice(0, 500);
    if (content.length < 12) continue;
    const importance = Math.max(1, Math.min(5, Math.round(Number(item.importance) || 3)));
    const days = item.expiresInDays;
    const expiresAt =
      typeof days === "number" && days >= 7 && days <= 365
        ? new Date(Date.now() + days * 86400000).toISOString()
        : null;
    const words = (value: string) =>
      new Set(value.toLocaleLowerCase("es-MX").match(/[\p{L}\p{N}]{4,}/gu) ?? []);
    const nextWords = words(content);
    const duplicate = (existing ?? []).find((row) => {
      if (row.category !== item.category) return false;
      const oldWords = words(row.content);
      const intersection = [...nextWords].filter((word) => oldWords.has(word)).length;
      return intersection / Math.max(1, Math.min(nextWords.size, oldWords.size)) >= 0.8;
    });
    if (duplicate?.source === "manual") continue;
    if (duplicate) {
      await supabase
        .from("capri_memories")
        .update({
          content,
          importance,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", duplicate.id)
        .eq("user_id", userId);
    } else {
      await supabase.from("capri_memories").insert({
        user_id: userId,
        category: item.category,
        content,
        importance,
        expires_at: expiresAt,
        source: "automatic",
      });
    }
  }
  // Keep the table bounded; manual memories are preserved before automatic ones.
  const { data: all } = await supabase
    .from("capri_memories")
    .select("id,source,importance,updated_at")
    .eq("user_id", userId)
    .order("importance", { ascending: true })
    .order("updated_at", { ascending: true });
  if (all && all.length > 120) {
    const removable = all.filter((row) => row.source === "automatic").slice(0, all.length - 120);
    if (removable.length)
      await supabase
        .from("capri_memories")
        .delete()
        .eq("user_id", userId)
        .in(
          "id",
          removable.map((row) => row.id),
        );
  }
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Downloads a project's files and turns them into model parts: text files become
 * text blocks (sharing one character budget), images and PDFs become inline data.
 * Files that can't be read are skipped; the caller notes what was left out.
 */
export async function projectContextParts(
  supabase: UserClient,
  userId: string,
  files: { name: string; storage_path: string; media_type: string; created_at: string }[],
  abortSignal?: AbortSignal,
): Promise<{ parts: UIMessage["parts"]; omitted: number; cut: boolean }> {
  const selected = selectProjectFiles(files);
  const texts: { name: string; text: string }[] = [];
  const media: UIMessage["parts"][number][] = [];
  const metadataCache: ChatAttachmentMetadataCache = new Map();
  const validated = await Promise.all(
    selected
      .filter((file) => ownsImagePath(file.storage_path, userId))
      .flatMap((file) => {
        const kind = attachmentKind(file.media_type, file.name);
        if (!kind) return [];
        return [
          validateChatAttachment(
            supabase,
            userId,
            {
              type: "file",
              mediaType: file.media_type,
              filename: file.name,
              url: `${IMAGE_SCHEME}${file.storage_path}`,
            },
            metadataCache,
          ).then((path) => ({ file, kind, path })),
        ];
      }),
  );
  for (const { file, kind, path } of validated) {
    let bytes: Uint8Array;
    try {
      bytes = await downloadChatAttachmentBytes(supabase, path, abortSignal);
    } catch (error) {
      if (abortSignal?.aborted || error instanceof ChatAttachmentLimitError) throw error;
      continue;
    }
    if (kind === "text") {
      texts.push({ name: file.name, text: new TextDecoder().decode(bytes) });
    } else {
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const mediaType = kind === "pdf" ? "application/pdf" : file.media_type;
      media.push({
        type: "file",
        mediaType,
        filename: file.name,
        url: `data:${mediaType};base64,${btoa(bin)}`,
      });
    }
  }
  const budgeted = budgetProjectTexts(texts);
  const parts: UIMessage["parts"] = [
    ...budgeted
      .filter((t) => t.text)
      .map((t) => ({ type: "text" as const, text: projectFileText(t.name, t.text) })),
    ...media,
  ];
  return { parts, omitted: files.length - selected.length, cut: budgeted.some((t) => t.cut) };
}

/**
 * Saved attachments point at private storage. Images and PDFs become inline data the model can see;
 * text files (TXT, CSV, code…) become a text block with their content.
 */
async function resolveAttachments(
  supabase: UserClient,
  userId: string,
  messages: UIMessage[],
  cache: Map<string, UIMessage["parts"][number]> = new Map(),
  metadataCache: ChatAttachmentMetadataCache = new Map(),
  abortSignal?: AbortSignal,
  shouldResolveAttachment?: (partIndex: number, resolvedParts: UIMessage["parts"]) => boolean,
): Promise<UIMessage[]> {
  return Promise.all(
    messages.map(async (m) => {
      const parts: UIMessage["parts"] = [];
      for (let partIndex = 0; partIndex < m.parts.length; partIndex++) {
        const p = m.parts[partIndex]!;
        if (p.type !== "file") {
          parts.push(p);
          continue;
        }
        if (shouldResolveAttachment && !shouldResolveAttachment(partIndex, parts)) continue;
        const path = await validateChatAttachment(supabase, userId, p, metadataCache);
        const kind = attachmentKind(p.mediaType, p.filename)!;
        const cached = cache.get(path);
        if (cached) {
          parts.push(cached);
          continue;
        }
        const bytes = await downloadChatAttachmentBytes(supabase, path, abortSignal);
        let resolved: UIMessage["parts"][number];
        if (kind === "text") {
          resolved = {
            type: "text",
            text: documentText(p.filename ?? "archivo.txt", new TextDecoder().decode(bytes)),
          };
        } else {
          let bin = "";
          for (let i = 0; i < bytes.length; i += 0x8000) {
            bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          }
          const mediaType = kind === "pdf" ? "application/pdf" : p.mediaType;
          resolved = { ...p, mediaType, url: `data:${mediaType};base64,${btoa(bin)}` };
        }
        cache.set(path, resolved);
        parts.push(resolved);
      }
      return {
        ...m,
        parts,
      };
    }),
  );
}

/**
 * Estimates safe minimum costs from metadata. For text, a UTF-8 byte size proves
 * that an older attachment cannot fit only when even its minimum decoded length is too large.
 */
async function minimumAttachmentPartCosts(
  supabase: UserClient,
  userId: string,
  message: UIMessage,
  metadataCache: ChatAttachmentMetadataCache,
): Promise<number[] | null> {
  const minimumCosts: number[] = [];
  for (const part of message.parts) {
    if (part.type !== "file" || attachmentKind(part.mediaType, part.filename) !== "text") {
      minimumCosts.push(partCost(part));
      continue;
    }
    const filename = part.filename ?? "archivo.txt";
    const path = imagePath(part.url);
    if (!path || !ownsImagePath(path, userId)) return null;
    const metadata = await readChatAttachmentMetadata(supabase, path, metadataCache);
    const encoding = metadata?.contentEncoding?.trim().toLowerCase();
    if (!metadata || (encoding && encoding !== "identity")) return null;

    // At least one decoded UTF-16 code unit per four UTF-8 bytes is a safe lower
    // bound (subtract a possible stripped BOM). Cap before repeat() for huge files.
    const minimumBodyChars = Math.min(
      MAX_DOCUMENT_CHARS + 1,
      Math.ceil(Math.max(0, metadata.size - 3) / 4),
    );
    minimumCosts.push(documentText(filename, "x".repeat(minimumBodyChars)).length);
  }
  return minimumCosts;
}

export async function resolveTrimmedAttachments(
  supabase: UserClient,
  userId: string,
  messages: UIMessage[],
  metadataCache: ChatAttachmentMetadataCache = new Map(),
  abortSignal?: AbortSignal,
): Promise<UIMessage[]> {
  const retained: UIMessage[] = [];
  const cache = new Map<string, UIMessage["parts"][number]>();
  const minimumCostsByIndex = new Map<number, number[]>();
  let total = 0;
  let omittedOlderAttachments = false;
  const minimumCostByIndex = new Map<number, number>();
  const hasAttachment = (candidate: UIMessage) =>
    candidate.parts.some((part) => part.type === "file");
  const candidates: { message: UIMessage; index: number }[] = [];

  // Plan the retained suffix with safe lower-bound text costs before metadata validation
  // or body downloads, so an old attachment that cannot fit cannot reject this turn.
  for (let i = messages.length - 1; i >= 0; i--) {
    const originalMessage = messages[i]!;
    let message = originalMessage;
    if (i < messages.length - 1) {
      const parts: UIMessage["parts"] = [];
      for (const part of originalMessage.parts) {
        if (part.type === "file") {
          const path = imagePath(part.url);
          const kind = attachmentKind(part.mediaType, part.filename);
          if (path && kind && ownsImagePath(path, userId)) {
            const metadata = await readChatAttachmentMetadata(supabase, path, metadataCache);
            if (metadata && metadata.size > MAX_IMAGE_BYTES) {
              omittedOlderAttachments = true;
              continue;
            }
          }
        }
        parts.push(part);
      }
      message = { ...originalMessage, parts };
      if (message.parts.length === 0) continue;
    }
    const estimatedPartCosts = await minimumAttachmentPartCosts(
      supabase,
      userId,
      message,
      metadataCache,
    );
    const minimumPartCosts =
      estimatedPartCosts ??
      message.parts.map((part) =>
        part.type === "file" && attachmentKind(part.mediaType, part.filename) === "text"
          ? 0
          : partCost(part),
      );
    minimumCostsByIndex.set(i, minimumPartCosts);
    const fileCount = message.parts.filter((part) => part.type === "file").length;
    if (i < messages.length - 1 && fileCount > MAX_IMAGES) {
      omittedOlderAttachments ||= messages.slice(0, i + 1).some(hasAttachment);
      break;
    }
    // Unknown text metadata contributes no pruning estimate; it remains a candidate
    // and fail-closed preflight below rejects it before any body download.
    const minimumCost = minimumPartCosts.reduce((sum, cost) => sum + cost, 0);
    minimumCostByIndex.set(i, minimumCost);
    if (i < messages.length - 1 && total + minimumCost > MAX_HISTORY_CHARS) {
      omittedOlderAttachments ||= messages.slice(0, i + 1).some(hasAttachment);
      break;
    }
    candidates.push({ message, index: i });
    total += minimumCost;
  }

  // Validate every attachment in the planned retained suffix before any body download.
  for (const { message } of candidates) {
    await validateChatMessageAttachments(supabase, userId, message, metadataCache);
  }

  total = 0;
  for (const { message, index: i } of candidates) {
    if (i < messages.length - 1 && total + (minimumCostByIndex.get(i) ?? 0) > MAX_HISTORY_CHARS) {
      omittedOlderAttachments ||= messages.slice(0, i + 1).some(hasAttachment);
      break;
    }
    const minimumPartCosts = minimumCostsByIndex.get(i) ?? [];
    const shouldResolveAttachment =
      i < messages.length - 1
        ? (partIndex: number, resolvedParts: UIMessage["parts"]) => {
            const resolvedCost = resolvedParts.reduce((sum, part) => sum + partCost(part), 0);
            const minimumPartCost = minimumPartCosts[partIndex] ?? 0;
            if (total + resolvedCost + minimumPartCost > MAX_HISTORY_CHARS) {
              omittedOlderAttachments = true;
              return false;
            }
            return true;
          }
        : undefined;
    const [resolved] = await resolveAttachments(
      supabase,
      userId,
      [message],
      cache,
      metadataCache,
      abortSignal,
      shouldResolveAttachment,
    );
    const cost = messageCost(resolved!);
    if (i === messages.length - 1 && cost > MAX_HISTORY_CHARS) {
      retained.unshift(resolved!);
      omittedOlderAttachments ||= messages.slice(0, i).some(hasAttachment);
      break;
    }
    if (i < messages.length - 1 && total + cost > MAX_HISTORY_CHARS) {
      omittedOlderAttachments ||= messages.slice(0, i + 1).some(hasAttachment);
      const olderAttachmentNoticeCost = omittedOlderAttachments
        ? OLDER_ATTACHMENT_HISTORY_NOTE.length
        : 0;
      const shortened = trimMessageToBudget(
        resolved!,
        Math.max(0, MAX_HISTORY_CHARS - total - olderAttachmentNoticeCost),
      );
      if (messageCost(shortened) > 0) retained.unshift(shortened);
      break;
    }

    retained.unshift(resolved!);
    total += cost;
  }

  if (retained.length === 0) return retained;
  if (omittedOlderAttachments && OLDER_ATTACHMENT_HISTORY_NOTE.length <= MAX_HISTORY_CHARS) {
    // Reserve the complete warning before keeping prior messages in the prompt.
    const reservedHistory = retainRecentMessagesWithinBudget(
      retained,
      MAX_HISTORY_CHARS - OLDER_ATTACHMENT_HISTORY_NOTE.length,
    );
    retained.splice(0, retained.length, ...reservedHistory);
  }
  const lastIndex = retained.length - 1;
  const otherCost = retained
    .slice(0, lastIndex)
    .reduce((sum, message) => sum + messageCost(message), 0);
  retained[lastIndex] = trimMessageToBudget(
    retained[lastIndex]!,
    Math.max(0, MAX_HISTORY_CHARS - otherCost),
    omittedOlderAttachments ? OLDER_ATTACHMENT_HISTORY_NOTE : undefined,
  );
  return retained;
}

const textOf = (m: UIMessage) =>
  m.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join(" ")
    .trim()
    .slice(0, 1500);

async function generateTitle(
  provider: ReturnType<typeof createGroq>,
  messages: UIMessage[],
  reply: UIMessage,
) {
  const user = messages
    .filter((m) => m.role === "user")
    .map(textOf)
    .join("\n");
  const result = streamText({
    model: asLanguageModel(provider(DEFAULT_CHAT_MODEL)),
    instructions:
      "Genera un título corto (3 a 6 palabras) en el idioma de la conversación que resuma el tema. Responde solo con el título, sin comillas ni punto final.",
    prompt: `Usuario: ${user}\n\nAsistente: ${textOf(reply)}`,
    maxOutputTokens: 32,
  });
  const text = (await result.text).trim().replace(/^["'«]+|["'».]+$/g, "");
  return text.slice(0, 80);
}

/**
 * A new message is inserted. A message that is already saved means the user edited it
 * or asked for a new reply: its text is updated and everything after it is dropped.
 */
async function saveUserMessage(
  supabase: UserClient,
  threadId: string,
  userId: string,
  msg: UIMessage,
) {
  const { data: existing, error: findError } = await supabase
    .from("messages")
    .select("created_at")
    .eq("thread_id", threadId)
    .eq("message_id", msg.id)
    .maybeSingle();
  if (findError) return { error: findError };
  if (!existing) {
    return supabase.from("messages").insert({
      thread_id: threadId,
      user_id: userId,
      message_id: msg.id,
      role: "user",
      parts: msg.parts as never,
    });
  }
  const [updated, removed] = await Promise.all([
    supabase
      .from("messages")
      .update({ parts: msg.parts as never })
      .eq("thread_id", threadId)
      .eq("message_id", msg.id),
    supabase
      .from("messages")
      .delete()
      .eq("thread_id", threadId)
      .gt("created_at", existing.created_at),
  ]);
  return { error: updated.error ?? removed.error };
}
