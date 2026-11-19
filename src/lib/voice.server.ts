import { authenticate, json } from "./auth-request.server";
import { readBoundedBody } from "./bounded-body";
import { MAX_AUDIO_BYTES, MAX_SPEECH_CHARS } from "./voice-limits";

const GATEWAY = "https://ai.gateway.lovable.dev";
const SPEECH_MODEL = "google/gemini-3.1-flash-tts-preview";
const SPEECH_VOICE = "Kore";
const TRANSCRIBE_MODEL = "openai/gpt-transcribe";
const MAX_SPEECH_REQUEST_BYTES = 64 * 1024;
const MAX_TRANSCRIBE_REQUEST_BYTES = MAX_AUDIO_BYTES + 64 * 1024;

const isAbort = (e: unknown) => (e as { name?: string })?.name === "AbortError";

function passthrough(upstream: Response) {
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache",
    },
  });
}

/** Reads one chunk of a Capri reply aloud: streams 24 kHz PCM over SSE. */
export async function handleSpeech(request: Request) {
  const auth = await authenticate(request);
  if ("error" in auth) return auth.error;
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return json(415, "Formato de solicitud no válido.");
  }
  const bytes = await readBoundedBody(request, MAX_SPEECH_REQUEST_BYTES);
  if (!bytes) return json(413, "La solicitud es demasiado grande.");
  let text: unknown;
  try {
    text = (JSON.parse(new TextDecoder().decode(bytes)) as { text?: unknown }).text;
  } catch {
    return json(400, "Solicitud inválida.");
  }
  if (typeof text !== "string" || !text.trim() || Array.from(text).length > MAX_SPEECH_CHARS) {
    return json(400, "Texto inválido para leer.");
  }
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return json(500, "Falta configurar la IA.");
  try {
    const upstream = await fetch(`${GATEWAY}/v1/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: SPEECH_MODEL,
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: SPEECH_VOICE } } },
        },
        stream_format: "sse",
      }),
      signal: request.signal,
    });
    return passthrough(upstream);
  } catch (e) {
    if (isAbort(e)) return new Response(null, { status: 499 });
    console.error("speech", e);
    return json(502, "No se pudo generar el audio.");
  }
}

/** Turns a recorded voice note into text (streamed as SSE). */
export async function handleTranscribe(request: Request) {
  const auth = await authenticate(request);
  if ("error" in auth) return auth.error;
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;") || !/boundary=/i.test(contentType)) {
    return json(415, "Formato de audio no válido.");
  }
  const bytes = await readBoundedBody(request, MAX_TRANSCRIBE_REQUEST_BYTES);
  if (!bytes) return json(413, "La grabación es demasiado larga.");
  let file: FormDataEntryValue | null;
  try {
    const form = await new Response(bytes, { headers: { "content-type": contentType } }).formData();
    file = form.get("file");
  } catch {
    return json(400, "Solicitud inválida.");
  }
  if (!(file instanceof File) || !file.type.startsWith("audio/")) return json(400, "Audio no válido.");
  if (file.size < 2048) return json(400, "La grabación quedó vacía. Inténtalo de nuevo.");
  if (file.size > MAX_AUDIO_BYTES) return json(413, "La grabación es demasiado larga.");
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return json(500, "Falta configurar la IA.");
  const form = new FormData();
  form.append("model", TRANSCRIBE_MODEL);
  form.append("file", file, file.name || "grabacion.wav");
  form.append("response_format", "json");
  form.append("stream", "true");
  try {
    const upstream = await fetch(`${GATEWAY}/v1/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: request.signal,
    });
    return passthrough(upstream);
  } catch (e) {
    if (isAbort(e)) return new Response(null, { status: 499 });
    console.error("transcribe", e);
    return json(502, "No se pudo transcribir el audio.");
  }
}
