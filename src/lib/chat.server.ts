import { createGroq } from "@ai-sdk/groq";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { authenticate, json, type UserClient } from "./auth-request.server";
import { buildSystemPrompt } from "./instructions";
import { selectRelevantMemories } from "./memory";
import { MAX_CHAT_REQUEST_BYTES, parseChatRequest } from "./chat-request";
import { IMAGE_BUCKET, attachmentKind, documentText, imagePath, ownsImagePath } from "./images";
import { WEB_SEARCH_TOOL_NAME, createWebSearchTool } from "./web-search";
import { DEFAULT_CHAT_MODEL, resolveChatModel } from "./models";
import { createReminderTools } from "./reminders.server";

export async function handleChat(request: Request) {
  const auth = await authenticate(request);
  if ("error" in auth) return auth.error;
  const { supabase, userId } = auth;

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_CHAT_REQUEST_BYTES) return json(413, "La solicitud es demasiado grande.");

  const rawBody = await readBoundedBody(request, MAX_CHAT_REQUEST_BYTES);
  if (rawBody === null) return json(413, "La solicitud es demasiado grande.");
  const body = parseChatRequest(rawBody);
  if (!body) return json(400, "Solicitud inválida o demasiado grande.");
  const { messages, threadId } = body;

  const [{ data: thread }, { data: settings }, { data: memoryRows, error: memoryError }] = await Promise.all([
    supabase.from("threads").select("id,title,custom_instructions,model").eq("id", threadId).maybeSingle(),
    supabase.from("user_settings").select("default_instructions,memory_auto_enabled").eq("user_id", userId).maybeSingle(),
    supabase.from("capri_memories").select("id,content,category,updated_at,importance,expires_at").eq("user_id", userId).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).order("importance", { ascending: false }).order("updated_at", { ascending: false }).limit(50),
  ]);
  if (!thread) return json(404, "Conversación no encontrada.");
  if (memoryError) console.error("load capri memories", memoryError);
  const latestUserText = messages.filter((m) => m.role === "user").slice(-1)[0]?.parts
    .map((part) => part.type === "text" ? part.text : "").join(" ") ?? "";
  const memories = selectRelevantMemories(memoryRows ?? [], latestUserText);
  const system = buildSystemPrompt(thread.custom_instructions, settings?.default_instructions, memories);

  const last = messages[messages.length - 1]!;
  if (last.role === "user") {
    const { error } = await saveUserMessage(supabase, threadId, userId, last);
    if (error) {
      console.error("save user message", error);
      return json(500, "No se pudo guardar tu mensaje.");
    }
    if (thread.title === "Nueva conversación") {
      const text = last.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ").trim();
      if (text) await supabase.from("threads").update({ title: text.slice(0, 60) }).eq("id", threadId);
    }
  }

  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) return json(500, "Falta configurar la IA.");

  const provider = createGroq({ apiKey });

  let modelMessages: UIMessage[];
  try {
    modelMessages = await resolveAttachments(supabase, userId, messages);
  } catch (e) {
    console.error("resolve attachments", e);
    return json(400, (e as Error).message || "No se pudo leer un archivo adjunto.");
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
    model: provider(resolveChatModel(thread.model)),
    instructions: `${system}\n\nHoy es ${today} y son las ${now} (hora de Ciudad de México, UTC-06:00).`,
    messages: await convertToModelMessages(modelMessages),
    // Web search via Tavily; at most two searches per turn (one credit each on the free plan).
    tools: {
      [WEB_SEARCH_TOOL_NAME]: createWebSearchTool(process.env["TAVILY_API_KEY"]),
      ...createReminderTools(supabase, userId, threadId),
    },
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
        if (settings?.memory_auto_enabled !== false && userText.length >= 24) await extractAndSaveMemories(provider, supabase, userId, userText);
      } catch (e) {
        console.error("automatic memory extraction", e);
      }
      await supabase.from("threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
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



type ExtractedMemory = { category: "preferencia" | "proyecto" | "objetivo" | "contexto" | "otro"; content: string; importance: number; expiresInDays: number | null };

async function extractAndSaveMemories(
  provider: ReturnType<typeof createGroq>,
  supabase: UserClient,
  userId: string,
  userText: string,
) {
  const result = await streamText({
    model: provider(DEFAULT_CHAT_MODEL),
    instructions: `Extrae de lo que el usuario acaba de decir entre cero y tres recuerdos útiles para futuras conversaciones. Devuelve exclusivamente un JSON válido con la forma {"memories":[{"category":"preferencia|proyecto|objetivo|contexto|otro","content":"...","importance":1,"expiresInDays":null}]}. Guarda solo información explícita, estable y útil: preferencias de respuesta, proyectos, objetivos y contexto de trabajo. No guardes datos sensibles (salud, religión, política, sexualidad, datos financieros privados), secretos, contraseñas, datos de terceros, información pasajera ni suposiciones. No conviertas preguntas o hipótesis en hechos. Cada recuerdo debe ser una frase breve, en primera persona cuando corresponda, máximo 300 caracteres. importance va de 1 a 5. expiresInDays es null para recuerdos duraderos o un número de 7 a 365 para datos temporales. Si no hay nada claro, devuelve {"memories":[]}.`,
    prompt: `Mensaje del usuario:\n${userText.slice(0, 3000)}`,
    maxOutputTokens: 500,
  });
  const raw = (await result.text).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(raw) as { memories?: ExtractedMemory[] };
  if (!Array.isArray(parsed.memories)) return;
  const allowed = new Set(["preferencia", "proyecto", "objetivo", "contexto", "otro"]);
  const { data: existing } = await supabase.from("capri_memories").select("id,category,content,source").eq("user_id", userId).order("updated_at", { ascending: false }).limit(100);
  for (const item of parsed.memories.slice(0, 3)) {
    if (!allowed.has(item.category) || typeof item.content !== "string") continue;
    const content = item.content.trim().slice(0, 500);
    if (content.length < 12) continue;
    const importance = Math.max(1, Math.min(5, Math.round(Number(item.importance) || 3)));
    const days = item.expiresInDays;
    const expiresAt = typeof days === "number" && days >= 7 && days <= 365
      ? new Date(Date.now() + days * 86400000).toISOString()
      : null;
    const words = (value: string) => new Set(value.toLocaleLowerCase("es-MX").match(/[\p{L}\p{N}]{4,}/gu) ?? []);
    const nextWords = words(content);
    const duplicate = (existing ?? []).find((row) => {
      if (row.category !== item.category) return false;
      const oldWords = words(row.content);
      const intersection = [...nextWords].filter((word) => oldWords.has(word)).length;
      return intersection / Math.max(1, Math.min(nextWords.size, oldWords.size)) >= 0.8;
    });
    if (duplicate?.source === "manual") continue;
    if (duplicate) {
      await supabase.from("capri_memories").update({ content, importance, expires_at: expiresAt, updated_at: new Date().toISOString() }).eq("id", duplicate.id).eq("user_id", userId);
    } else {
      await supabase.from("capri_memories").insert({ user_id: userId, category: item.category, content, importance, expires_at: expiresAt, source: "automatic" });
    }
  }
  // Keep the table bounded; manual memories are preserved before automatic ones.
  const { data: all } = await supabase.from("capri_memories").select("id,source,importance,updated_at").eq("user_id", userId).order("importance", { ascending: true }).order("updated_at", { ascending: true });
  if (all && all.length > 120) {
    const removable = all.filter((row) => row.source === "automatic").slice(0, all.length - 120);
    if (removable.length) await supabase.from("capri_memories").delete().eq("user_id", userId).in("id", removable.map((row) => row.id));
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
 * Saved attachments point at private storage. Images and PDFs become inline data the model can see;
 * text files (TXT, CSV, code…) become a text block with their content.
 */
async function resolveAttachments(
  supabase: UserClient,
  userId: string,
  messages: UIMessage[],
): Promise<UIMessage[]> {
  const cache = new Map<string, UIMessage["parts"][number]>();
  return Promise.all(
    messages.map(async (m) => ({
      ...m,
      parts: await Promise.all(
        m.parts.map(async (p) => {
          if (p.type !== "file") return p;
          const path = imagePath(p.url);
          const kind = attachmentKind(p.mediaType, p.filename);
          if (!path || !kind || !ownsImagePath(path, userId)) throw new Error("Archivo adjunto no válido.");
          const cached = cache.get(path);
          if (cached) return cached;
          const { data, error } = await supabase.storage.from(IMAGE_BUCKET).download(path);
          if (error || !data) throw new Error("No se pudo leer un archivo adjunto.");
          let resolved: UIMessage["parts"][number];
          if (kind === "text") {
            resolved = { type: "text", text: documentText(p.filename ?? "archivo.txt", await data.text()) };
          } else {
            const bytes = new Uint8Array(await data.arrayBuffer());
            let bin = "";
            for (let i = 0; i < bytes.length; i += 0x8000) {
              bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            }
            const mediaType = kind === "pdf" ? "application/pdf" : p.mediaType;
            resolved = { ...p, mediaType, url: `data:${mediaType};base64,${btoa(bin)}` };
          }
          cache.set(path, resolved);
          return resolved;
        }),
      ),
    })),
  );
}

const textOf = (m: UIMessage) =>
  m.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ").trim().slice(0, 1500);

async function generateTitle(
  provider: ReturnType<typeof createGroq>,
  messages: UIMessage[],
  reply: UIMessage,
) {
  const user = messages.filter((m) => m.role === "user").map(textOf).join("\n");
  const result = streamText({
    model: provider(DEFAULT_CHAT_MODEL),
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
async function saveUserMessage(supabase: UserClient, threadId: string, userId: string, msg: UIMessage) {
  const { data: existing, error: findError } = await supabase
    .from("messages")
    .select("created_at")
    .eq("thread_id", threadId)
    .eq("message_id", msg.id)
    .maybeSingle();
  if (findError) return { error: findError };
  if (!existing) {
    return supabase
      .from("messages")
      .insert({ thread_id: threadId, user_id: userId, message_id: msg.id, role: "user", parts: msg.parts as never });
  }
  const [updated, removed] = await Promise.all([
    supabase.from("messages").update({ parts: msg.parts as never }).eq("thread_id", threadId).eq("message_id", msg.id),
    supabase.from("messages").delete().eq("thread_id", threadId).gt("created_at", existing.created_at),
  ]);
  return { error: updated.error ?? removed.error };
}
