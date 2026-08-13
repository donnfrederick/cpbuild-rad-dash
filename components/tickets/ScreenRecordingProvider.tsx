"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Camera, Circle, Loader2, Maximize2, Square, X } from "lucide-react";
import { useAppUser } from "@/contexts/AppUserContext";
import { hasTicketTriageAccess } from "@/lib/ticket-triage";
import { CreateTicketDialog } from "@/components/tickets/CreateTicketDialog";
import { ScreenshotOverlay } from "@/components/tickets/ScreenshotOverlay";
import { useSprintRouteCreateTicketContext } from "@/hooks/useSprintRouteCreateTicketContext";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RecordingState = "idle" | "requesting" | "recording" | "processing";
export type ScreenshotPhase = "idle" | "requesting" | "floating" | "selecting";

interface ScreenCaptureContextValue {
  recordingState: RecordingState;
  screenshotPhase: ScreenshotPhase;
  /** Start a global screen recording. Rejects if cancelled or permission denied. */
  startRecording: () => Promise<void>;
  /** Open the browser screen picker then show the persistent screenshot floating bar. */
  startScreenshot: () => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ScreenCaptureContext = createContext<ScreenCaptureContextValue | null>(null);

export function useScreenRecording(): ScreenCaptureContextValue {
  const ctx = useContext(ScreenCaptureContext);
  if (!ctx) throw new Error("useScreenRecording must be used inside ScreenRecordingProvider");
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

async function noopFetchTickets(): Promise<void> {}

export function ScreenRecordingProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const t = useTranslations("tickets");
  const user = useAppUser();
  const canTriage = hasTicketTriageAccess(user.role, user.specialPermissions);
  const { linkSprintId, allowedProjectIds } = useSprintRouteCreateTicketContext(canTriage);

  // ── Shared post-capture dialog ──────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const openPostCaptureDialog = useCallback((file: File) => {
    setPendingFiles([file]);
    setDialogOpen(true);
  }, []);

  // ── Screen recording ────────────────────────────────────────────────────────
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const finishRecording = useCallback(() => {
    const mimeType =
      mediaRecorderRef.current?.mimeType ||
      (MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm");

    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const file = new File([blob], `recording-${ts}.webm`, { type: mimeType });

    setRecordingState("idle");
    openPostCaptureDialog(file);
  }, [openPostCaptureDialog]);

  const startRecording = useCallback(async (): Promise<void> => {
    if (recordingState !== "idle") return;
    setRecordingState("requesting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch {
      setRecordingState("idle");
      throw new Error("Screen recording cancelled or permission denied");
    }

    mediaStreamRef.current = stream;
    chunksRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : "";

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      setRecordingState("processing");
      setTimeout(finishRecording, 0);
    };
    recorder.onerror = () => {
      chunksRef.current = [];
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
      setRecordingState("idle");
    };
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (mediaRecorderRef.current?.state !== "inactive") {
        mediaRecorderRef.current?.stop();
      }
    });

    recorder.start(1000);
    setRecordingState("recording");
  }, [recordingState, finishRecording]);

  const handleStopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state !== "inactive") {
      mediaRecorderRef.current?.stop();
    }
  }, []);

  // ── Screenshot ──────────────────────────────────────────────────────────────
  const [screenshotPhase, setScreenshotPhase] = useState<ScreenshotPhase>("idle");
  /** Stream passed to ScreenshotOverlay — state (not ref) so we never read refs during render. */
  const [selectingStream, setSelectingStream] = useState<MediaStream | null>(null);
  const screenshotStreamRef = useRef<MediaStream | null>(null);

  const cancelScreenshot = useCallback(() => {
    screenshotStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenshotStreamRef.current = null;
    setSelectingStream(null);
    setScreenshotPhase("idle");
  }, []);

  const startScreenshot = useCallback(async (): Promise<void> => {
    if (screenshotPhase !== "idle") return;
    setScreenshotPhase("requesting");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1 },
        audio: false,
      });
      screenshotStreamRef.current = stream;
      // Auto-cancel if the user closes the browser share indicator
      stream.getVideoTracks()[0]?.addEventListener("ended", cancelScreenshot);
      setScreenshotPhase("floating");
    } catch {
      setScreenshotPhase("idle");
      throw new Error("Screenshot cancelled");
    }
  }, [screenshotPhase, cancelScreenshot]);

  const captureFullScreen = useCallback(async () => {
    const stream = screenshotStreamRef.current;
    if (!stream) return;

    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play().catch(() => null);
    await new Promise<void>((res) => {
      if (video.readyState >= 2) { res(); return; }
      video.onloadeddata = () => res();
    });

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    video.pause();

    const blob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"),
    );

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const file = new File([blob], `screenshot-${ts}.png`, { type: "image/png" });

    cancelScreenshot();
    openPostCaptureDialog(file);
  }, [cancelScreenshot, openPostCaptureDialog]);

  const handleScreenshotCaptured = useCallback((file: File) => {
    cancelScreenshot();
    openPostCaptureDialog(file);
  }, [cancelScreenshot, openPostCaptureDialog]);

  // ── Render ──────────────────────────────────────────────────────────────────
  const recordingVisible = recordingState === "recording" || recordingState === "processing";

  return (
    <ScreenCaptureContext.Provider value={{ recordingState, screenshotPhase, startRecording, startScreenshot }}>
      {children}

      {/* ── Recording floating bar ── */}
      {recordingVisible
        ? createPortal(
            <div className="fixed bottom-8 left-1/2 z-[9999] flex -translate-x-1/2 items-center gap-3 rounded-full border border-error-300 bg-white px-5 py-3 shadow-2xl dark:border-error-800 dark:bg-neutral-900">
              <span className="flex items-center gap-2 text-sm font-medium text-error-600 dark:text-error-400">
                <Circle className="size-2.5 animate-pulse fill-current" aria-hidden />
                {recordingState === "processing"
                  ? t("createTicketRecordingProcessing")
                  : t("createTicketRecordingInProgress")}
              </span>
              {recordingState === "recording" ? (
                <button
                  type="button"
                  onClick={handleStopRecording}
                  className="inline-flex items-center gap-1.5 rounded-full bg-error-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-error-700 active:scale-95"
                >
                  <Square className="size-3 fill-current" aria-hidden />
                  {t("createTicketStopRecording")}
                </button>
              ) : (
                <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
              )}
            </div>,
            document.body,
          )
        : null}

      {/* ── Screenshot floating bar ── */}
      {screenshotPhase === "floating"
        ? createPortal(
            <div className="fixed bottom-8 left-1/2 z-[9999] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-white px-4 py-2.5 shadow-2xl dark:bg-neutral-900">
              <span className="mr-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Camera className="size-3.5 text-primary" aria-hidden />
                {t("screenshotFloatingReady")}
              </span>
              <button
                type="button"
                onClick={() => void captureFullScreen()}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:opacity-90 active:scale-95"
              >
                <Maximize2 className="size-3" aria-hidden />
                {t("screenshotFloatingFullScreen")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const s = screenshotStreamRef.current;
                  if (!s) return;
                  setSelectingStream(s);
                  setScreenshotPhase("selecting");
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted active:scale-95"
              >
                <Camera className="size-3" aria-hidden />
                {t("screenshotFloatingSelectArea")}
              </button>
              <button
                type="button"
                onClick={cancelScreenshot}
                className="ml-1 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={t("screenshotFloatingCancel")}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>,
            document.body,
          )
        : null}

      {/* ── Screenshot drag-select overlay ── */}
      {screenshotPhase === "selecting" && selectingStream ? (
        <ScreenshotOverlay
          stream={selectingStream}
          onCapture={handleScreenshotCaptured}
          onCancel={() => {
            setSelectingStream(null);
            setScreenshotPhase("floating");
          }}
        />
      ) : null}

      {/* ── Post-capture ticket dialog (shared by recording + screenshot) ── */}
      <CreateTicketDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        sprintId={linkSprintId}
        allowedProjectIds={allowedProjectIds}
        canTriage={canTriage}
        fetchTickets={noopFetchTickets}
        initialFiles={pendingFiles}
        onCreated={() => setPendingFiles([])}
      />
    </ScreenCaptureContext.Provider>
  );
}
