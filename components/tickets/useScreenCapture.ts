"use client";

import { useCallback, useState } from "react";

export type ScreenshotState = "idle" | "requesting";

export interface UseScreenCaptureReturn {
  screenshotState: ScreenshotState;
  /** Set once getDisplayMedia resolves — triggers the overlay to appear. */
  pendingStream: MediaStream | null;
  /** Call to open the browser's screen picker. Sets pendingStream on success. */
  startScreenshotCapture: () => Promise<void>;
  /** Stop all tracks and clear pendingStream (called after capture or cancel). */
  clearPendingStream: () => void;
}

export function useScreenCapture(): UseScreenCaptureReturn {
  const [screenshotState, setScreenshotState] = useState<ScreenshotState>("idle");
  const [pendingStream, setPendingStream] = useState<MediaStream | null>(null);

  const startScreenshotCapture = useCallback(async (): Promise<void> => {
    if (screenshotState !== "idle") return;
    setScreenshotState("requesting");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1 },
        audio: false,
      });
      setPendingStream(stream);
    } catch {
      // User cancelled or permission denied — stay silent
    } finally {
      setScreenshotState("idle");
    }
  }, [screenshotState]);

  const clearPendingStream = useCallback((): void => {
    setPendingStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, []);

  return { screenshotState, pendingStream, startScreenshotCapture, clearPendingStream };
}
