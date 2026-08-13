import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useScreenCapture } from "@/components/tickets/useScreenCapture";

const mockGetDisplayMedia = vi.fn();

beforeEach(() => {
  mockGetDisplayMedia.mockReset();
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    value: { getDisplayMedia: mockGetDisplayMedia },
    writable: true,
    configurable: true,
  });
});

describe("useScreenCapture — initial state", () => {
  it("starts with screenshotState idle and no pending stream", () => {
    const { result } = renderHook(() => useScreenCapture());
    expect(result.current.screenshotState).toBe("idle");
    expect(result.current.pendingStream).toBeNull();
  });
});

describe("useScreenCapture — startScreenshotCapture", () => {
  it("sets pendingStream when getDisplayMedia resolves", async () => {
    const fakeTrack = { stop: vi.fn() };
    const fakeStream = { getTracks: () => [fakeTrack] } as unknown as MediaStream;
    mockGetDisplayMedia.mockResolvedValue(fakeStream);

    const { result } = renderHook(() => useScreenCapture());
    await act(() => result.current.startScreenshotCapture());

    expect(result.current.pendingStream).toBe(fakeStream);
    expect(result.current.screenshotState).toBe("idle");
  });

  it("returns to idle with null stream when user cancels (getDisplayMedia rejects)", async () => {
    mockGetDisplayMedia.mockRejectedValue(new DOMException("Permission denied", "NotAllowedError"));

    const { result } = renderHook(() => useScreenCapture());
    await act(() => result.current.startScreenshotCapture());

    expect(result.current.screenshotState).toBe("idle");
    expect(result.current.pendingStream).toBeNull();
  });

  it("can be called again after a previous capture completes", async () => {
    const fakeStream = { getTracks: () => [] } as unknown as MediaStream;
    mockGetDisplayMedia.mockResolvedValue(fakeStream);

    const { result } = renderHook(() => useScreenCapture());

    await act(() => result.current.startScreenshotCapture());
    expect(mockGetDisplayMedia).toHaveBeenCalledTimes(1);

    await act(() => result.current.startScreenshotCapture());
    expect(mockGetDisplayMedia).toHaveBeenCalledTimes(2);
  });
});

describe("useScreenCapture — clearPendingStream", () => {
  it("stops all tracks and resets pendingStream to null", async () => {
    const fakeTrack = { stop: vi.fn() };
    const fakeStream = { getTracks: () => [fakeTrack] } as unknown as MediaStream;
    mockGetDisplayMedia.mockResolvedValue(fakeStream);

    const { result } = renderHook(() => useScreenCapture());
    await act(() => result.current.startScreenshotCapture());

    expect(result.current.pendingStream).toBe(fakeStream);

    await act(async () => {
      result.current.clearPendingStream();
    });

    expect(fakeTrack.stop).toHaveBeenCalledOnce();
    expect(result.current.pendingStream).toBeNull();
  });

  it("is safe to call when there is no pending stream", async () => {
    const { result } = renderHook(() => useScreenCapture());

    await act(async () => {
      result.current.clearPendingStream();
    });

    expect(result.current.pendingStream).toBeNull();
  });
});
