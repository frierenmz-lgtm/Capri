import { createFileRoute, redirect } from "@tanstack/react-router";
import { createThread } from "@/lib/threads";

/**
 * Shortcut target ("Nueva conversación" from the home-screen icon): creates a
 * thread and lands on it. The redirect replaces this URL, so reopening the app
 * restores the thread instead of creating another one.
 */
export const Route = createFileRoute("/_authenticated/chat/nuevo")({
  beforeLoad: async ({ context }) => {
    const id = await createThread();
    await context.queryClient.invalidateQueries({ queryKey: ["threads"] });
    throw redirect({ to: "/chat/$threadId", params: { threadId: id }, replace: true });
  },
});
