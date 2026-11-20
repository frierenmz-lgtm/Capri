import { authenticate, json } from "./auth-request.server";
import { readBoundedBody } from "./bounded-body";
import { MAX_AUDIO_BYTES, MAX_SPEECH_CHARS } from "./voice-limits";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const SPEECH_MODEL = "gemini-3.8-flash-tts";
const SPEECH_VOICE = "Kore";
const TRANSCRIBE_MODEL = "gemini-3.5-flash-lite";
const MAX_SPEECH_REQUEST_BYTES = 64 * 1024;
const MAX_TRANSCRIBE_REQUEST_BYTES = MAX_AUDIO_BYTES + 64 * 1024;

const isAbort = (e: unknown) => (e as { name?: string })?.name === "AbortError";

function geminiApiKey() {
  return process.env["GOOGLE_GENERATIVE_AI_API_KEY"] ?? process.env["GEMINI_API_KEY"];
}

function sseResponse(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

function sseEvent(payload: unknown) {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function geminiText(data: unknown): string {
  const candidates = (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })?.candidates;
  return candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
}

function geminiAudio(data: unknown): string | undefined {
  const candidates = (data as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }> })?.candidates;
  return candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData?.data;
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
  const apiKey = geminiApiKey();
  if (!apiKey) return json(500, "Falta configurar la IA.");
  let data: unknown;
  try {
    const upstream = await fetch(`${GEMINI_API_BASE}/models/${SPEECH_MODEL}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: SPEECH_VOICE } } },
        },
      }),
      signal: request.signal,
    });
    if (!upstream.ok) {
      console.error("speech", upstream.status, await upstream.text().catch(() => ""));
      return json(502, "No se pudo generar el audio.");
    }
    data = await upstream.json();
  } catch (e) {
    if (isAbort(e)) return new Response(null, { status: 499 });
    console.error("speech", e);
    return json(502, "No se pudo generar el audio.");
  }
  // Gemini TTS answers in one shot (base64 PCM 16-bit, 24 kHz, mono). The
  // client expects OpenAI-style SSE deltas, so re-emit the audio in chunks.
  const audio = geminiAudio(data);
  if (!audio) {
    console.error("speech", "no audio in Gemini response");
    return json(502, "No se pudo generar el audio.");
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Chunks must stay a multiple of 4 chars so each one is valid base64.
      for (let i = 0; i < audio.length; i += 16384) {
        controller.enqueue(sseEvent({ type: "speech.audio.delta", audio: audio.slice(i, i + 16384) }));
      }
      controller.enqueue(sseEvent({ type: "speech.audio.done" }));
      controller.close();
    },
  });
  return sseResponse(stream);
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
  const apiKey = geminiApiKey();
  if (!apiKey) return json(500, "Falta configurar la IA.");
  let text: string;
  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const upstream = await fetch(`${GEMINI_API_BASE}/models/${TRANSCRIBE_MODEL}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: "Transcribe el siguiente audio tal cual, en el idioma que se habla. Devuelve solo la transcripción, sin explicaciones ni comillas." },
              { inlineData: { mimeType: file.type || "audio/wav", data: base64 } },
            ],
          },
        ],
      }),
      signal: request.signal,
    });
    if (!upstream.ok) {
      console.error("transcribe", upstream.status, await upstream.text().catch(() => ""));
      return json(502, "No se pudo transcribir el audio.");
    }
    text = geminiText(await upstream.json());
  } catch (e) {
    if (isAbort(e)) return new Response(null, { status: 499 });
    console.error("transcribe", e);
    return json(502, "No se pudo transcribir el audio.");
  }
  if (!text) return json(502, "No se pudo transcribir el audio.");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(sseEvent({ type: "transcript.text.delta", delta: text }));
      controller.enqueue(sseEvent({ type: "transcript.text.done", text }));
      controller.close();
    },
  });
  return sseResponse(stream);
}
