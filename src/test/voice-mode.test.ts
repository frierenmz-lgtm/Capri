import { describe, expect, it, vi } from "vitest";
import { createSilenceTracker } from "@/lib/voice";

function loud(n: number) {
  return new Float32Array(n).fill(0.1);
}
function quiet(n: number) {
  return new Float32Array(n).fill(0.001);
}

describe("createSilenceTracker", () => {
  it("fires after speech followed by enough quiet", () => {
    const onSilence = vi.fn();
    const tracker = createSilenceTracker({ silenceMs: 1000, onSilence });
    tracker.feed(loud(100), 0);
    tracker.feed(quiet(100), 500);
    expect(onSilence).not.toHaveBeenCalled();
    tracker.feed(quiet(100), 1500);
    expect(onSilence).toHaveBeenCalledTimes(1);
  });

  it("never fires on silence before any speech", () => {
    const onSilence = vi.fn();
    const tracker = createSilenceTracker({ silenceMs: 1000, onSilence });
    tracker.feed(quiet(100), 0);
    tracker.feed(quiet(100), 5000);
    expect(onSilence).not.toHaveBeenCalled();
  });

  it("does not fire while the user keeps talking, and resets the quiet clock on speech", () => {
    const onSilence = vi.fn();
    const tracker = createSilenceTracker({ silenceMs: 1000, onSilence });
    tracker.feed(loud(100), 0);
    tracker.feed(quiet(100), 800);
    tracker.feed(loud(100), 900);
    tracker.feed(quiet(100), 1500);
    expect(onSilence).not.toHaveBeenCalled();
    tracker.feed(quiet(100), 2500);
    expect(onSilence).toHaveBeenCalledTimes(1);
  });

  it("fires only once and can fire again after reset", () => {
    const onSilence = vi.fn();
    const tracker = createSilenceTracker({ silenceMs: 1000, onSilence });
    tracker.feed(loud(100), 0);
    tracker.feed(quiet(100), 0);
    tracker.feed(quiet(100), 2000);
    tracker.feed(quiet(100), 3000);
    expect(onSilence).toHaveBeenCalledTimes(1);
    tracker.reset();
    tracker.feed(loud(100), 4000);
    tracker.feed(quiet(100), 4000);
    tracker.feed(quiet(100), 5000);
    expect(onSilence).toHaveBeenCalledTimes(2);
  });
});
