import { createParser } from "eventsource-parser";
import { supabase } from "@/integrations/supabase/client";
import { stripMarkdown } from "./search";
import { MAX_RECORDING_SECONDS, MAX_SPEECH_CHARS } from "./voice-limits";

export async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

async function errorText(res: Response, fallback: string) {
  if (res.status === 402) return "Se agotaron los créditos de IA de este espacio de trabajo.";
  if (res.status === 429) return "Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.";
  try {
    const body = (await res.json()) as { error?: string | { message?: string } };
    if (typeof body.error === "string") return body.error;
  } catch {
    /* not json */
  }
  return fallback;
}

/* ---------- Read aloud ---------- */

/** Plain text for the voice: code blocks are announced, not spelled out. */
export function speakableText(markdown: string): string {
  const withoutCode = markdown.replace(/```[\s\S]*?(```|$)/g, " (bloque de código) ");
  return stripMarkdown(withoutCode.replace(/\|/g, " ")).trim();
}

/** Splits at sentence boundaries so every piece fits one voice request. */
export function chunkText(text: string, max = MAX_SPEECH_CHARS): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const sentence of text.match(/[^.!?¡¿。！？]+[.!?。！？]*\s*|[.!?¡¿。！？]+\s*/gu) ?? []) {
    const points = Array.from(sentence);
    if (Array.from(current).length + points.length <= max) {
      current += sentence;
      continue;
    }
    if (current.trim()) chunks.push(current.trim());
    current = "";
    for (let i = 0; i < points.length; i += max) {
      const part = points.slice(i, i + max).join("");
      if (i + max < points.length) chunks.push(part.trim());
      else current = part;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

function decodePCM(pending: Uint8Array, incoming: Uint8Array) {
  const bytes = new Uint8Array(pending.length + incoming.length);
  bytes.set(pending);
  bytes.set(incoming, pending.length);
  const usable = bytes.length - (bytes.length % 2);
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(usable / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
  return { samples, pending: bytes.slice(usable) };
}

async function playChunk(ctx: AudioContext, text: string, signal: AbortSignal, onStart?: () => void) {
  const sources = new Set<AudioBufferSourceNode>();
  const stopAll = () => sources.forEach((s) => s.stop());
  signal.addEventListener("abort", stopAll, { once: true });
  let playhead = 0;
  let pending = new Uint8Array(0);
  let completed = false;
  let played = 0;
  let playback: Promise<void> = Promise.resolve();
  try {
    const res = await fetch("/api/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ text }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(await errorText(res, "No se pudo generar el audio."));
    const parser = createParser({
      onEvent(event) {
        const payload = JSON.parse(event.data) as { type: string; audio?: string; error?: unknown };
        if (payload.type === "error" || payload.error) throw new Error("No se pudo generar el audio.");
        if (payload.type === "speech.audio.done") {
          completed = true;
          return;
        }
        if (payload.type !== "speech.audio.delta" || !payload.audio) return;
        const decoded = decodePCM(pending, Uint8Array.from(atob(payload.audio), (c) => c.charCodeAt(0)));
        pending = new Uint8Array(decoded.pending);
        if (!decoded.samples.length) return;
        played += decoded.samples.length;
        const buffer = ctx.createBuffer(1, decoded.samples.length, 24000);
        buffer.copyToChannel(decoded.samples, 0);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        sources.add(source);
        playback = new Promise<void>((resolve) => {
          source.onended = () => {
            sources.delete(source);
            resolve();
          };
        });
        playhead = Math.max(playhead, ctx.currentTime + 0.05);
        source.start(playhead);
        playhead += buffer.duration;
        onStart?.();
      },
    });
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        parser.feed(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    if (!completed || !played) throw new Error("El audio llegó incompleto.");
    await playback;
  } finally {
    signal.removeEventListener("abort", stopAll);
  }
}

/** Reads a reply aloud piece by piece. Call from a tap; abort the signal to stop. */
export async function speak(markdown: string, signal: AbortSignal, onStart?: () => void) {
  const chunks = chunkText(speakableText(markdown));
  if (chunks.length === 0) return;
  const ctx = new AudioContext({ sampleRate: 24000 });
  try {
    if (ctx.state === "suspended") await ctx.resume();
    let started = false;
    const first = () => {
      if (!started) onStart?.();
      started = true;
    };
    for (const chunk of chunks) {
      if (signal.aborted) return;
      await playChunk(ctx, chunk, signal, first);
    }
  } finally {
    await ctx.close().catch(() => {});
  }
}

/* ---------- Dictation ---------- */

function encodeWav(chunks: readonly Float32Array[], sampleRate: number): Blob {
  const length = chunks.reduce((sum, c) => sum + c.length, 0);
  const bytes = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bytes);
  const tag = (o: number, v: string) => {
    for (let i = 0; i < v.length; i++) view.setUint8(o + i, v.charCodeAt(i));
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const chunk of chunks)
    for (const value of chunk) {
      const s = Math.max(-1, Math.min(1, value));
      view.setInt16(offset, s * (s < 0 ? 32768 : 32767), true);
      offset += 2;
    }
  return new Blob([bytes], { type: "audio/wav" });
}

export type Recording = { stop: () => Promise<File>; cancel: () => void };

/** Starts the microphone. `onLimit` fires when the maximum length is reached. */
export async function startRecording(onLimit: () => void): Promise<Recording> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Tu navegador no permite usar el micrófono.");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new Error("Permite el acceso al micrófono para dictar.");
  }
  const ctx = new AudioContext();
  try {
    await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    node.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    source.connect(node);
    node.connect(ctx.destination);
    const limit = setTimeout(onLimit, MAX_RECORDING_SECONDS * 1000);
    let done = false;
    const release = () => {
      done = true;
      clearTimeout(limit);
      stream.getTracks().forEach((t) => t.stop());
      node.disconnect();
      source.disconnect();
      node.onaudioprocess = null;
    };
    return {
      async stop() {
        if (done) throw new Error("La grabación ya terminó.");
        release();
        const blob = encodeWav(chunks, ctx.sampleRate);
        await ctx.close();
        if (blob.size < 2048) throw new Error("La grabación quedó vacía. Inténtalo de nuevo.");
        return new File([blob], "grabacion.wav", { type: "audio/wav" });
      },
      cancel() {
        if (done) return;
        release();
        void ctx.close();
      },
    };
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();
    throw e;
  }
}

/** Sends a voice note to be written out; `onText` receives the text as it arrives. */
export async function transcribe(file: File, onText: (text: string) => void): Promise<string> {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch("/api/transcribe", { method: "POST", headers: await authHeaders(), body: form });
  if (!res.ok || !res.body) throw new Error(await errorText(res, "No se pudo transcribir el audio."));
  let text = "";
  let final: string | null = null;
  const parser = createParser({
    onEvent(event) {
      if (event.data === "[DONE]") return;
      const p = JSON.parse(event.data) as { type?: string; delta?: string; text?: string; error?: unknown };
      if (p.type === "error" || p.error) throw new Error("No se pudo transcribir el audio.");
      if (p.type === "transcript.text.delta" && p.delta) {
        text += p.delta;
        onText(text);
      } else if (p.type === "transcript.text.done") {
        final = p.text ?? text;
        onText(final);
      }
    },
  });
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      parser.feed(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (final === null) throw new Error("La transcripción llegó incompleta.");
  return (final as string).trim();
}
