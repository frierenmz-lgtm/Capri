import { createFileRoute } from "@tanstack/react-router";
import { handleSpeech } from "@/lib/voice.server";

export const Route = createFileRoute("/api/speech")({
  server: { handlers: { POST: ({ request }) => handleSpeech(request) } },
});
