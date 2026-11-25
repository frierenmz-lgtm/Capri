import { authenticate, json } from "./auth-request.server";
import { readBoundedBody } from "./bounded-body";
import { MAX_AUDIO_BYTES, MAX_SPEECH_CHARS } from "./voice-limits";

const GROQ_API_BASE = "https://api.groq.com/openai/v1";
const SPEECH_MODEL = "canopylabs/orpheus-v1-english";
const SPEECH_VOICE = "troy";
const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";
const MAX_SPEECH_REQUEST_BYTES = 64 * 1024;
const MAX_TRANSCRIBE_REQUEST_BYTES = MAX_AUDIO_BYTES + 64 * 1024;

const isAbort = (e: unknown) => (e as { name?: string })?.name === "AbortError";

function groqApiKey() {
  return process.env["GROQ_API_KEY"];
}

function sseResponse(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

function sseEvent(payload: unknown) {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Groq TTS answers with a WAV file. The client plays raw PCM16 mono at
 * 24 kHz, so parse the WAV header, keep the PCM data and resample to
 * 24 kHz when the file uses another rate. Returns null for anything that
 * is not PCM16 mono audio.
 */
function wavToPcm24k(bytes: Uint8Array): Int16Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const textAt = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (bytes.length < 44 || textAt(0, 4) !== "RIFF" || textAt(8, 4) !== "WAVE") return null;
  let offset = 12;
  let format: number | null = null;
  let channels: number | null = null;
  let sampleRate: number | null = null;
  let bitsPerSample: number | null = null;
  let dataStart = -1;
  let dataLength = -1;
  while (offset + 8 <= bytes.length) {
    const id = textAt(offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + size > bytes.length) return null;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === "data") {
      dataStart = body;
      dataLength = size;
      break;
    }
    offset = body + size + (size % 2);
  }
  if (format !== 1 || channels !== 1 || !sampleRate || bitsPerSample !== 16 || dataStart < 0)
    return null;
  const frames = Math.floor(dataLength / 2);
  const pcm = new Int16Array(frames);
  for (let i = 0; i < frames; i++) pcm[i] = view.getInt16(dataStart + i * 2, true);
  if (sampleRate === 24000) return pcm;
  const outLength = Math.max(1, Math.round((frames * 24000) / sampleRate));
  const resampled = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const position = (i * sampleRate) / 24000;
    const index = Math.floor(position);
    const frac = position - index;
    const a = pcm[Math.min(index, frames - 1)] ?? 0;
    const b = pcm[Math.min(index + 1, frames - 1)] ?? 0;
    resampled[i] = Math.round(a + (b - a) * frac);
  }
  return resampled;
}

function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
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
  const apiKey = groqApiKey();
  if (!apiKey) return json(500, "Falta configurar la IA.");
  let audio: string;
  try {
    const upstream = await fetch(`${GROQ_API_BASE}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: SPEECH_MODEL,
        input: text,
        voice: SPEECH_VOICE,
        response_format: "wav",
      }),
      signal: request.signal,
    });
    if (!upstream.ok) {
      console.error("speech", upstream.status, await upstream.text().catch(() => ""));
      return json(502, "No se pudo generar el audio.");
    }
    const pcm = wavToPcm24k(new Uint8Array(await upstream.arrayBuffer()));
    if (!pcm) {
      console.error("speech", "unexpected audio format from Groq");
      return json(502, "No se pudo generar el audio.");
    }
    audio = pcmToBase64(pcm);
  } catch (e) {
    if (isAbort(e)) return new Response(null, { status: 499 });
    console.error("speech", e);
    return json(502, "No se pudo generar el audio.");
  }
  // Groq TTS answers with a WAV file; the client expects OpenAI-style SSE
  // deltas with base64 PCM, so re-emit the audio in chunks.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Chunks must stay a multiple of 4 chars so each one is valid base64.
      for (let i = 0; i < audio.length; i += 16384) {
        controller.enqueue(
          sseEvent({ type: "speech.audio.delta", audio: audio.slice(i, i + 16384) }),
        );
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
  if (
    !contentType.toLowerCase().startsWith("multipart/form-data;") ||
    !/boundary=/i.test(contentType)
  ) {
    return json(415, "Formato de audio no válido.");
  }
  const bytes = await readBoundedBody(request, MAX_TRANSCRIBE_REQUEST_BYTES);
  if (!bytes) return json(413, "La grabación es demasiado larga.");
  let file: FormDataEntryValue | null;
  try {
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    const form = await new Response(body, { headers: { "content-type": contentType } }).formData();
    file = form.get("file");
  } catch {
    return json(400, "Solicitud inválida.");
  }
  if (!(file instanceof File) || !file.type.startsWith("audio/"))
    return json(400, "Audio no válido.");
  if (file.size < 2048) return json(400, "La grabación quedó vacía. Inténtalo de nuevo.");
  if (file.size > MAX_AUDIO_BYTES) return json(413, "La grabación es demasiado larga.");
  const apiKey = groqApiKey();
  if (!apiKey) return json(500, "Falta configurar la IA.");
  let text: string;
  try {
    const form = new FormData();
    form.append("file", file, file.name || "audio.webm");
    form.append("model", TRANSCRIBE_MODEL);
    const upstream = await fetch(`${GROQ_API_BASE}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: request.signal,
    });
    if (!upstream.ok) {
      console.error("transcribe", upstream.status, await upstream.text().catch(() => ""));
      return json(502, "No se pudo transcribir el audio.");
    }
    text = ((await upstream.json()) as { text?: unknown }).text as string;
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
