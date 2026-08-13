"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

export interface SelectionRect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface NormalisedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function normalise(sel: SelectionRect): NormalisedRect {
  return {
    x: Math.min(sel.startX, sel.endX),
    y: Math.min(sel.startY, sel.endY),
    w: Math.abs(sel.endX - sel.startX),
    h: Math.abs(sel.endY - sel.startY),
  };
}

export interface ScreenshotOverlayProps {
  stream: MediaStream;
  onCapture: (file: File) => void;
  onCancel: () => void;
}

export function ScreenshotOverlay({
  stream,
  onCapture,
  onCancel,
}: ScreenshotOverlayProps): React.ReactElement {
  const t = useTranslations("tickets");

  // Hidden video — only used at capture time, never rendered visibly
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  // Hot-path refs — updated on every pointer move, no re-render needed for drawing
  const selectionRef = useRef<SelectionRect | null>(null);
  const isDraggingRef = useRef(false);

  // Slow-path state — only for showing/hiding action buttons
  const [committedSelection, setCommittedSelection] = useState<SelectionRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  // ── Attach stream to hidden video ──────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    // Don't call play() here — we play() just before capturing to get a fresh frame
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  // ── Esc key ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  // ── Canvas setup + RAF draw loop ────────────────────────────────────────────
  // Inner `function frame()` avoids referencing a const before initialization (react-hooks/immutability).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const size = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
    };
    size();
    window.addEventListener("resize", size);

    function frame(): void {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafRef.current = requestAnimationFrame(frame);
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const W = canvas.width;
      const H = canvas.height;

      ctx.clearRect(0, 0, W, H);

      ctx.fillStyle = "rgba(0, 0, 0, 0.50)";
      ctx.fillRect(0, 0, W, H);

      const sel = selectionRef.current;
      if (sel) {
        const { x, y, w, h } = normalise(sel);
        if (w > 2 && h > 2) {
          const px = x * dpr;
          const py = y * dpr;
          const pw = w * dpr;
          const ph = h * dpr;

          ctx.clearRect(px, py, pw, ph);

          ctx.strokeStyle = "rgba(99, 102, 241, 0.95)";
          ctx.lineWidth = 1.5 * dpr;
          ctx.strokeRect(px, py, pw, ph);

          const cs = 10 * dpr;
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2 * dpr;
          const corners: [number, number, number, number, number, number][] = [
            [px, py + cs, px, py, px + cs, py],
            [px + pw - cs, py, px + pw, py, px + pw, py + cs],
            [px, py + ph - cs, px, py + ph, px + cs, py + ph],
            [px + pw - cs, py + ph, px + pw, py + ph, px + pw, py + ph - cs],
          ];
          for (const [x1, y1, x2, y2, x3, y3] of corners) {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineTo(x3, y3);
            ctx.stroke();
          }

          if (isDraggingRef.current && w > 30 && h > 20) {
            const label = `${Math.round(w)} × ${Math.round(h)}`;
            const fontSize = 11 * dpr;
            ctx.font = `${fontSize}px monospace`;
            const tw = ctx.measureText(label).width;
            const lx = px;
            const ly = py > 24 * dpr ? py - 6 * dpr : py + ph + 16 * dpr;
            ctx.fillStyle = "rgba(0,0,0,0.65)";
            ctx.fillRect(lx - 3 * dpr, ly - 13 * dpr, tw + 6 * dpr, 17 * dpr);
            ctx.fillStyle = "#fff";
            ctx.fillText(label, lx, ly);
          }
        }
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", size);
    };
  }, []);

  // ── Pointer handlers ────────────────────────────────────────────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    const rect = { startX: e.clientX, startY: e.clientY, endX: e.clientX, endY: e.clientY };
    selectionRef.current = rect;
    isDraggingRef.current = true;
    setIsDragging(true);
    setCommittedSelection(null);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !selectionRef.current) return;
    selectionRef.current = { ...selectionRef.current, endX: e.clientX, endY: e.clientY };
    // No setIsDragging call here — RAF reads the ref, no re-render needed
  }, []);

  const handlePointerUp = useCallback(() => {
    isDraggingRef.current = false;
    setIsDragging(false);
    setCommittedSelection(selectionRef.current);
  }, []);

  // ── Capture logic ────────────────────────────────────────────────────────────
  const doCapture = useCallback(
    async (sel: SelectionRect | null) => {
      const video = videoRef.current;
      if (!video) return;
      setIsCapturing(true);

      // Play video to get a fresh frame
      video.muted = true;
      await video.play().catch(() => null);
      await new Promise<void>((res) => {
        if (video.readyState >= 2) { res(); return; }
        video.onloadeddata = () => res();
      });

      const nativeW = video.videoWidth || window.innerWidth;
      const nativeH = video.videoHeight || window.innerHeight;
      const viewW = window.innerWidth;
      const viewH = window.innerHeight;
      const scaleX = nativeW / viewW;
      const scaleY = nativeH / viewH;

      const out = document.createElement("canvas");

      if (sel) {
        const { x, y, w, h } = normalise(sel);
        if (w >= 4 && h >= 4) {
          out.width = Math.round(w * scaleX);
          out.height = Math.round(h * scaleY);
          out.getContext("2d")!.drawImage(
            video,
            Math.round(x * scaleX), Math.round(y * scaleY),
            Math.round(w * scaleX), Math.round(h * scaleY),
            0, 0, out.width, out.height,
          );
        } else {
          out.width = nativeW;
          out.height = nativeH;
          out.getContext("2d")!.drawImage(video, 0, 0, nativeW, nativeH);
        }
      } else {
        out.width = nativeW;
        out.height = nativeH;
        out.getContext("2d")!.drawImage(video, 0, 0, nativeW, nativeH);
      }

      video.pause();

      const blob = await new Promise<Blob>((res, rej) =>
        out.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"),
      );

      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const file = new File([blob], `screenshot-${ts}.png`, { type: "image/png" });
      stream.getTracks().forEach((t) => t.stop());
      onCapture(file);
    },
    [stream, onCapture],
  );

  // ── Derived ──────────────────────────────────────────────────────────────────
  const norm = committedSelection ? normalise(committedSelection) : null;
  const hasValidSelection = !isDragging && norm !== null && norm.w > 4 && norm.h > 4;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] select-none overflow-hidden"
      style={{ cursor: isCapturing ? "wait" : "crosshair" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Hidden video for capture only — NOT shown as background to avoid feedback loop */}
      <video
        ref={videoRef}
        className="pointer-events-none invisible absolute"
        muted
        playsInline
      />

      {/* Selection mask drawn by RAF loop */}
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" />

      {/* Top hint bar */}
      <div className="pointer-events-none absolute left-1/2 top-5 flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-black/75 px-4 py-2 text-sm text-white shadow-xl backdrop-blur-sm">
        <span>{t("screenshotOverlayHint")}</span>
        <kbd className="rounded border border-white/25 bg-white/10 px-1.5 py-0.5 font-mono text-xs">
          Esc
        </kbd>
      </div>

      {/* Buttons — after drag selection */}
      {hasValidSelection && norm && committedSelection && (
        <div
          className="pointer-events-auto absolute flex gap-2"
          style={{
            left: norm.x + norm.w / 2,
            top:
              norm.y + norm.h + 52 > window.innerHeight
                ? norm.y - 42
                : norm.y + norm.h + 10,
            transform: "translateX(-50%)",
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => void doCapture(committedSelection)}
            className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-lg transition-all hover:bg-indigo-700 active:scale-95"
          >
            {t("screenshotOverlayCaptureSelection")}
          </button>
          <button
            type="button"
            onClick={() => {
              selectionRef.current = null;
              setCommittedSelection(null);
            }}
            className="rounded-full border border-white/25 bg-black/70 px-5 py-2 text-sm font-semibold text-white shadow-lg transition-all hover:bg-black/90 active:scale-95"
          >
            {t("screenshotOverlayClearSelection")}
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
