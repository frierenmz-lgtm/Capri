import { describe, expect, it } from "vitest";
import { formatReminderDue, validateReminder } from "@/lib/reminders";

const NOW = new Date("2026-11-21T12:00:00-06:00");

describe("validateReminder", () => {
  it("accepts a future date with the Mexico City offset", () => {
    const result = validateReminder({ text: "Llamar al banco", due_at: "2026-11-22T08:00:00-06:00" }, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("Llamar al banco");
      expect(result.dueAt.toISOString()).toBe("2026-11-22T14:00:00.000Z");
    }
  });

  it("rejects empty or overlong text", () => {
    expect(validateReminder({ text: "   ", due_at: "2026-11-22T08:00:00-06:00" }, NOW)).toEqual({
      ok: false,
      error: "El recordatorio está vacío.",
    });
    expect(validateReminder({ text: "x".repeat(201), due_at: "2026-11-22T08:00:00-06:00" }, NOW).ok).toBe(false);
  });

  it("rejects past dates, unparseable dates, and dates more than a year away", () => {
    expect(validateReminder({ text: "Algo", due_at: "2026-11-21T11:00:00-06:00" }, NOW)).toEqual({
      ok: false,
      error: "La fecha y hora ya pasaron.",
    });
    expect(validateReminder({ text: "Algo", due_at: "mañana a las ocho" }, NOW)).toEqual({
      ok: false,
      error: "La fecha y hora no se entienden.",
    });
    expect(validateReminder({ text: "Algo", due_at: "2027-11-22T08:00:00-06:00" }, NOW)).toEqual({
      ok: false,
      error: "El recordatorio no puede ser a más de un año.",
    });
    expect(validateReminder({ text: "Algo", due_at: "" }, NOW).ok).toBe(false);
  });
});

describe("formatReminderDue", () => {
  it("formats the due date in Spanish and Mexico City time", () => {
    const formatted = formatReminderDue("2026-11-22T08:00:00-06:00");
    expect(formatted).toMatch(/22/);
    expect(formatted).toMatch(/08:00/);
    expect(formatted).toMatch(/nov/i);
  });
});
