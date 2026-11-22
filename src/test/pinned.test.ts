import { describe, expect, it } from "vitest";
import { splitPinned, type Thread } from "@/lib/threads";

function thread(id: string, pinned: boolean, updated_at: string): Thread {
  return { id, title: id, updated_at, pinned };
}

describe("splitPinned", () => {
  it("separates pinned threads first, keeping each group's order", () => {
    const threads = [
      thread("a", false, "2026-11-21T10:00:00Z"),
      thread("b", true, "2026-11-21T09:00:00Z"),
      thread("c", false, "2026-11-21T11:00:00Z"),
      thread("d", true, "2026-11-21T08:00:00Z"),
    ];
    expect(splitPinned(threads)).toEqual({
      pinned: [thread("b", true, "2026-11-21T09:00:00Z"), thread("d", true, "2026-11-21T08:00:00Z")],
      rest: [thread("a", false, "2026-11-21T10:00:00Z"), thread("c", false, "2026-11-21T11:00:00Z")],
    });
  });

  it("handles empty, all-pinned, and none-pinned lists", () => {
    expect(splitPinned([])).toEqual({ pinned: [], rest: [] });
    expect(splitPinned([thread("a", true, "2026-11-21T10:00:00Z")])).toEqual({
      pinned: [thread("a", true, "2026-11-21T10:00:00Z")],
      rest: [],
    });
    expect(splitPinned([thread("a", false, "2026-11-21T10:00:00Z")])).toEqual({
      pinned: [],
      rest: [thread("a", false, "2026-11-21T10:00:00Z")],
    });
  });
});
