import { createFileRoute } from "@tanstack/react-router";
import { handleStudyGenerate } from "@/lib/study.server";

export const Route = createFileRoute("/api/study")({
  server: { handlers: { POST: ({ request }) => handleStudyGenerate(request) } },
});
