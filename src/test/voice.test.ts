import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chunkText, getVoiceMode, pickSpanishVoice, setVoiceMode, speak, speakableText } from "@/lib/voice";
import { MAX_SPEECH_CHARS } from "@/lib/voice-limits";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

class FakeUtterance {
  text: string;
  voice: { lang: string; name: string } | null = null;
  lang = "";
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function fakeSynth(voices: Array<{ lang: string; name: string }>) {
  const spoken: FakeUtterance[] = [];
  let cancelled = false;
  const synth = {
    getVoices: () => voices,
    addEventListener: () => {},
    removeEventListener: () => {},
    cancel: () => {
      cancelled = true;
    },
    speak: (utterance: FakeUtterance) => {
      spoken.push(utterance);
      queueMicrotask(() => {
        utterance.onstart?.();
        utterance.onend?.();
      });
    },
  };
  return { synth, spoken, isCancelled: () => cancelled };
}

class FakeAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};
  async resume() {}
  async close() {}
  createBuffer(_channels: number, length: number, _rate: number) {
    return { duration: length / 24000, copyToChannel() {} };
  }
  createBufferSource() {
    const source: Record<string, unknown> & { onended: (() => void) | null } = {
      buffer: null,
      onended: null,
      connect() {},
      stop() {},
      start() {
        queueMicrotask(() => source.onended?.());
      },
    };
    return source;
  }
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("read aloud", () => {
  it("splits long replies into pieces no longer than one voice request", () => {
    const text = "Esta es una oración bastante larga para probar. ".repeat(200);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(Array.from(c).length).toBeLessThanOrEqual(MAX_SPEECH_CHARS);
  });

  it("keeps every word when splitting", () => {
    const text = Array.from({ length: 400 }, (_, i) => `Palabra${i}.`).join(" ");
    const joined = chunkText(text).join(" ");
    expect(joined).toContain("Palabra0.");
    expect(joined).toContain("Palabra399.");
  });

  it("announces code blocks instead of reading them", () => {
    const out = speakableText("Usa esto:\n```python\nprint('hola')\n```\nListo.");
    expect(out).not.toContain("print");
    expect(out).toContain("bloque de código");
  });
});

describe("voice mode", () => {
  it("defaults to the phone voice and remembers the choice", () => {
    expect(getVoiceMode()).toBe("system");
    setVoiceMode("server");
    expect(getVoiceMode()).toBe("server");
    setVoiceMode("system");
    expect(getVoiceMode()).toBe("system");
  });

  it("prefers Mexican Spanish, then Spain Spanish, then any Spanish voice", () => {
    const voices = [
      { lang: "en-US", name: "English" },
      { lang: "es-ES", name: "Español" },
      { lang: "es-AR", name: "Argentino" },
    ] as SpeechSynthesisVoice[];
    expect(pickSpanishVoice(voices)?.lang).toBe("es-ES");
    expect(pickSpanishVoice([{ lang: "es-MX", name: "Mexicano" }, ...voices] as SpeechSynthesisVoice[])?.lang).toBe("es-MX");
    expect(pickSpanishVoice([{ lang: "en-US", name: "English" }] as SpeechSynthesisVoice[])).toBeNull();
  });
});

describe("phone voice", () => {
  it("reads with the Spanish voice and never calls the server", async () => {
    const { synth, spoken } = fakeSynth([
      { lang: "en-US", name: "English" },
      { lang: "es-MX", name: "Mexicano" },
    ]);
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    const fetchMock = vi.fn(async () => {
      throw new Error("server should not be called");
    });
    vi.stubGlobal("fetch", fetchMock);
    setVoiceMode("system");
    const onStart = vi.fn();
    await speak("Hola, ¿cómo estás? Hoy es sábado.", new AbortController().signal, onStart);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(spoken.length).toBeGreaterThan(0);
    expect(spoken.every((u) => u.voice?.lang === "es-MX")).toBe(true);
    expect(spoken.map((u) => u.text).join(" ")).toContain("Hola");
    expect(onStart).toHaveBeenCalledTimes(1);
    delete (window as unknown as Record<string, unknown>).speechSynthesis;
  });

  it("stops the phone voice when aborted", async () => {
    const { synth, spoken, isCancelled } = fakeSynth([{ lang: "es-MX", name: "Mexicano" }]);
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    setVoiceMode("system");
    const controller = new AbortController();
    controller.abort();
    await speak("Hola, ¿cómo estás?", controller.signal);
    expect(spoken.length).toBe(0);
    expect(isCancelled()).toBe(true);
    delete (window as unknown as Record<string, unknown>).speechSynthesis;
  });

  it("falls back to the server voice when the device has no Spanish voice", async () => {
    const { synth } = fakeSynth([{ lang: "en-US", name: "English" }]);
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const sse = 'data: {"type":"speech.audio.delta","audio":"AAAA"}\n\ndata: {"type":"speech.audio.done"}\n\n';
    const fetchMock = vi.fn(async () => new Response(sse, { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    setVoiceMode("system");
    await speak("Hola.", new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledWith("/api/speech", expect.objectContaining({ method: "POST" }));
    delete (window as unknown as Record<string, unknown>).speechSynthesis;
  });
});
