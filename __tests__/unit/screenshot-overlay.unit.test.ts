import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { normalise } from "@/components/tickets/ScreenshotOverlay";
import { useScreenRecording } from "@/components/tickets/ScreenRecordingProvider";

// ─── normalise() ─────────────────────────────────────────────────────────────

describe("normalise()", () => {
  it("returns correct rect for a top-left → bottom-right drag", () => {
    expect(normalise({ startX: 10, startY: 20, endX: 110, endY: 120 })).toEqual({
      x: 10,
      y: 20,
      w: 100,
      h: 100,
    });
  });

  it("handles a reversed drag (bottom-right → top-left)", () => {
    expect(normalise({ startX: 110, startY: 120, endX: 10, endY: 20 })).toEqual({
      x: 10,
      y: 20,
      w: 100,
      h: 100,
    });
  });

  it("handles a mixed-axis drag (right then up)", () => {
    expect(normalise({ startX: 10, startY: 100, endX: 100, endY: 10 })).toEqual({
      x: 10,
      y: 10,
      w: 90,
      h: 90,
    });
  });

  it("returns zero dimensions when start and end are the same point", () => {
    expect(normalise({ startX: 50, startY: 50, endX: 50, endY: 50 })).toEqual({
      x: 50,
      y: 50,
      w: 0,
      h: 0,
    });
  });

  it("always produces non-negative w and h", () => {
    const rect = normalise({ startX: 200, startY: 300, endX: 50, endY: 80 });
    expect(rect.w).toBeGreaterThanOrEqual(0);
    expect(rect.h).toBeGreaterThanOrEqual(0);
  });
});

// ─── useScreenRecording context guard ────────────────────────────────────────

describe("useScreenRecording()", () => {
  it("throws when called outside ScreenRecordingProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useScreenRecording())).toThrow(
      "useScreenRecording must be used inside ScreenRecordingProvider",
    );
    spy.mockRestore();
  });
});
