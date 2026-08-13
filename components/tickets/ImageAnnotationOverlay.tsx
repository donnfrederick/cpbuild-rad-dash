"use client";

/**
 * Renders non-destructive markup over an image (freehand, shapes, text).
 */
import { useCallback, useEffect, useRef } from "react";
import type { ImageAnnotationPayload } from "@/lib/image-annotation-schema";

function paintStrokeOverlay(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  color: string,
  lineWidth: number,
) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
}

function paintShapeOverlay(
  ctx: CanvasRenderingContext2D,
  sh: {
    kind: "rectangle" | "ellipse" | "arrow";
    color: string;
    strokeWidth: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  },
) {
  const { color, strokeWidth: w } = sh;
  const x1 = sh.x1;
  const y1 = sh.y1;
  const x2 = sh.x2;
  const y2 = sh.y2;
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (sh.kind === "rectangle") {
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    ctx.strokeRect(left, top, Math.abs(x2 - x1), Math.abs(y2 - y1));
    return;
  }

  if (sh.kind === "ellipse") {
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const rx = Math.abs(x2 - x1) / 2;
    const ry = Math.abs(y2 - y1) / 2;
    if (rx < 1 || ry < 1) return;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }

  // arrow
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.max(12, w * 4);
  const a1 = angle + Math.PI * 0.82;
  const a2 = angle - Math.PI * 0.82;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 + Math.cos(a1) * head, y2 + Math.sin(a1) * head);
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 + Math.cos(a2) * head, y2 + Math.sin(a2) * head);
  ctx.stroke();
}

export interface ImageAnnotationOverlayProps {
  src: string;
  annotation: ImageAnnotationPayload | null | undefined;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function ImageAnnotationOverlay({ src, annotation, alt = "", className, style }: ImageAnnotationOverlayProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const redraw = useCallback(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas || !annotation) return;
    const w = img.offsetWidth;
    const h = img.offsetHeight;
    if (w < 2 || h < 2) return;

    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.style.left = "0";
    canvas.style.top = "0";

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio ?? 1 : 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const minDim = Math.min(w, h);
    for (const s of annotation.strokes) {
      const pts = s.points.map((p) => ({ x: p.x * w, y: p.y * h }));
      paintStrokeOverlay(ctx, pts, s.color, s.widthNorm * minDim);
    }

    if (annotation.schemaVersion === 2) {
      for (const sh of annotation.shapeItems) {
        paintShapeOverlay(ctx, {
          kind: sh.kind,
          color: sh.color,
          strokeWidth: Math.max(1, sh.strokeWidthNorm * minDim),
          x1: sh.x1 * w,
          y1: sh.y1 * h,
          x2: sh.x2 * w,
          y2: sh.y2 * h,
        });
      }
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const t of annotation.textItems) {
      const fs = Math.max(12, t.fontSizeNorm * h);
      ctx.font = `bold ${fs}px Arial, sans-serif`;
      ctx.fillStyle = t.color;
      ctx.shadowColor = "rgba(0,0,0,0.85)";
      ctx.shadowBlur = 6;
      ctx.fillText(t.text, t.xNorm * w, t.yNorm * h);
    }
    ctx.shadowBlur = 0;
  }, [annotation]);

  useEffect(() => {
    redraw();
  }, [redraw, src]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [redraw]);

  if (!annotation) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={alt} className={className} style={{ ...style, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
    );
  }

  return (
    <div
      ref={wrapRef}
      className={className}
      style={{
        position: "relative",
        display: "inline-block",
        maxWidth: "100%",
        maxHeight: "100%",
        lineHeight: 0,
        ...style,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        onLoad={redraw}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          width: "auto",
          height: "auto",
          display: "block",
          verticalAlign: "top",
        }}
      />
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
