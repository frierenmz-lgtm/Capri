import { createFileRoute } from "@tanstack/react-router";
import { handleDueReminders } from "@/lib/reminders.server";

export const Route = createFileRoute("/api/reminders-due")({
  server: { handlers: { POST: ({ request }) => handleDueReminders(request) } },
});
