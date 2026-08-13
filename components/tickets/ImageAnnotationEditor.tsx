"use client";

/**
 * ImageAnnotationEditor — Instagram-style full-screen image markup tool.
 *
 * Text flow (like Instagram Stories):
 *  1. Tap the "Aa" button → dark overlay slides in, keyboard rises.
 *  2. Type text — styled preview appears centered over the photo.
 *  3. Pick a color from the row of swatches.
 *  4. Tap "Done" → text item lands centered on the photo.
 *  5. Drag text items to reposition. Tap to select (shows Edit / Delete).
 *  6. Tap "Aa" again to add more text; tap Edit on a selected item to modify it.
 *
 * Pencil tool works as before (draw anywhere, stroke-width picker, undo).
 *
 * On Save: draws canvas (image + strokes) then burns all text items → JPEG blob.
 */

import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, RotateCcw, Pencil, Check, Trash2, Edit2, Eraser, Square, Circle, ArrowUpRight } from "lucide-react";
import type { EditorShapeInput, ImageAnnotationPayload } from "@/lib/image-annotation-schema";
import {
  deserializeImageAnnotationToEditorState,
  parseImageAnnotation,
  serializeImageAnnotationLayered,
} from "@/lib/image-annotation-schema";
import { applyEraserSamples } from "@/lib/image-annotation-eraser";

// ── Types ─────────────────────────────────────────────────────────────────────

type StrokeWidth = 3 | 6 | 12;

interface DrawAction {
  kind: "stroke";
  color: string;
  width: number;
  points: { x: number; y: number }[];
}

/** A text overlay. Position is stored as fractions of the canvas container. */
interface TextItem {
  id: string;
  text: string;
  color: string;
  xPct: number; // 0..1 left→right within the container div
  yPct: number; // 0..1 top→bottom within the container div
  fontSize: number; // display px (scaled to canvas on save)
}

export interface AnnotationResult {
  blob: Blob;
  localUrl: string;
}

/** Flattened JPEG export (issues, bulk, etc.) or layered JSON (observation markup). */
export type AnnotationSaveResult =
  | AnnotationResult
  | { kind: "layered"; annotation: ImageAnnotationPayload };

export function isFlattenAnnotationSave(r: AnnotationSaveResult): r is AnnotationResult {
  return "blob" in r;
}

export interface ImageAnnotationEditorProps {
  src: string;
  onSave: (result: AnnotationSaveResult) => void;
  onClose: () => void;
  /** `"layered"` saves vector JSON only (default). `"flatten"` burns markup into a JPEG blob. */
  exportMode?: "flatten" | "layered";
  /** When editing existing observation markup, hydrate pencil/text from JSON. */
  initialAnnotation?: unknown;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const COLORS = ["#ffffff", "#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#000000"];
const STROKE_WIDTHS: StrokeWidth[] = [3, 6, 12];

function snapStrokeWidth(w: number): StrokeWidth {
  let best: StrokeWidth = 6;
  let bestD = Infinity;
  for (const s of STROKE_WIDTHS) {
    const d = Math.abs(s - w);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

const ICON_BTN: React.CSSProperties = {
  width: 48, height: 48, minWidth: 48, minHeight: 48, borderRadius: 99,
  backgroundColor: "rgba(255,255,255,0.15)",
  border: "none", padding: 0,
  display: "flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer", flexShrink: 0,
};

type ToolMode = "draw" | "eraser" | "rectangle" | "ellipse" | "arrow";

const ERASER_RADIUS_PX = 20;

// ── Component ─────────────────────────────────────────────────────────────────

export function ImageAnnotationEditor({
  src,
  onSave,
  onClose,
  exportMode = "layered",
  initialAnnotation,
}: ImageAnnotationEditorProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef       = useRef<HTMLImageElement | null>(null);
  const dragRef      = useRef<{
    id: string; startX: number; startY: number;
    origXPct: number; origYPct: number;
    moved: boolean;
  } | null>(null);

  // ── Canvas / image state ───────────────────────────────────────────────────
  const [imgLoaded,    setImgLoaded]    = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [color,        setColor]        = useState(COLORS[0]);
  const [strokeWidth,  setStrokeWidth]  = useState<StrokeWidth>(6);
  const [strokes,      setStrokes]      = useState<DrawAction[]>([]);
  const [currentStroke, setCurrentStroke] = useState<{ x: number; y: number }[] | null>(null);

  // ── Text overlay state ─────────────────────────────────────────────────────
  const [textItems,    setTextItems]    = useState<TextItem[]>([]);
  const [selectedId,   setSelectedId]   = useState<string | null>(null);

  // Text input overlay
  const [showTextInput, setShowTextInput] = useState(false);
  const [editingId,     setEditingId]     = useState<string | null>(null); // null = new text
  const [draftText,     setDraftText]     = useState("");
  const [draftColor,    setDraftColor]    = useState(COLORS[0]);

  const [tool, setTool] = useState<ToolMode>("draw");
  const [shapeItems, setShapeItems] = useState<EditorShapeInput[]>([]);
  const [shapeDraft, setShapeDraft] = useState<{
    kind: Exclude<ToolMode, "draw" | "eraser">;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const eraserSamplesRef = useRef<{ x: number; y: number }[]>([]);
  const [past, setPast] = useState<Array<{ strokes: DrawAction[]; shapes: EditorShapeInput[]; text: TextItem[] }>>([]);

  const parsedInitial = useMemo(
    () => (exportMode === "layered" && initialAnnotation != null ? parseImageAnnotation(initialAnnotation) : null),
    [exportMode, initialAnnotation],
  );
  const hydratedKeyRef = useRef<string | null>(null);

  // ── Load image ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { imgRef.current = img; setImgLoaded(true); };
    img.onerror = () => {
      const img2 = new Image();
      img2.onload = () => { imgRef.current = img2; setImgLoaded(true); };
      img2.src = src;
    };
    img.src = src;
  }, [src]);

  // ── Canvas sizing & redraw ─────────────────────────────────────────────────

  function paintShapeOnCanvas(ctx: CanvasRenderingContext2D, sh: EditorShapeInput, dashed: boolean) {
    ctx.save();
    if (dashed) ctx.setLineDash([6, 4]);
    ctx.strokeStyle = sh.color;
    ctx.lineWidth = sh.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const { x1, y1, x2, y2, kind } = sh;
    if (kind === "rectangle") {
      const left = Math.min(x1, x2);
      const top = Math.min(y1, y2);
      ctx.strokeRect(left, top, Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else if (kind === "ellipse") {
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;
      if (rx >= 1 && ry >= 1) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.max(12, sh.width * 4);
      const a1 = angle + Math.PI * 0.82;
      const a2 = angle - Math.PI * 0.82;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 + Math.cos(a1) * head, y2 + Math.sin(a1) * head);
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 + Math.cos(a2) * head, y2 + Math.sin(a2) * head);
      ctx.stroke();
    }
    ctx.restore();
  }

  function cloneSnap(s: DrawAction[], sh: EditorShapeInput[], t: TextItem[]) {
    return {
      strokes: s.map((x) => ({ ...x, points: x.points.map((p) => ({ ...p })) })),
      shapes: sh.map((x) => ({ ...x })),
      text: t.map((x) => ({ ...x })),
    };
  }

  function pushUndo() {
    setPast((p) => [...p.slice(-24), cloneSnap(strokes, shapeItems, textItems)]);
  }

  function applyUndo() {
    setPast((p) => {
      if (p.length === 0) return p;
      const snap = p[p.length - 1];
      setStrokes(snap.strokes);
      setShapeItems(snap.shapes);
      setTextItems(snap.text);
      return p.slice(0, -1);
    });
  }

  const redraw = useCallback((extra?: { x: number; y: number }[]) => {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    for (const s of strokes) paintStroke(ctx, s.points, s.color, s.width);
    for (const sh of shapeItems) paintShapeOnCanvas(ctx, sh, false);
    if (shapeDraft) {
      paintShapeOnCanvas(
        ctx,
        {
          id: "draft",
          kind: shapeDraft.kind,
          color,
          width: strokeWidth,
          x1: shapeDraft.x1,
          y1: shapeDraft.y1,
          x2: shapeDraft.x2,
          y2: shapeDraft.y2,
        },
        true,
      );
    }
    if (extra && extra.length > 1) paintStroke(ctx, extra, color, strokeWidth);
  }, [strokes, shapeItems, shapeDraft, color, strokeWidth]);

  useEffect(() => {
    if (!imgLoaded) return;
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !img) return;
    const container = containerRef.current;
    if (container) {
      const { width, height } = container.getBoundingClientRect();
      const r = img.naturalWidth / img.naturalHeight;
      if (r > width / height) {
        canvas.width  = Math.round(width);
        canvas.height = Math.round(width / r);
      } else {
        canvas.height = Math.round(height);
        canvas.width  = Math.round(height * r);
      }
    } else {
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
    }
    redraw();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgLoaded]);

  useEffect(() => { if (imgLoaded) redraw(); }, [imgLoaded, redraw]);

  useEffect(() => {
    hydratedKeyRef.current = null;
  }, [src, parsedInitial]);

  useEffect(() => {
    if (exportMode !== "layered" || !parsedInitial || !imgLoaded) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const shapeN = parsedInitial.schemaVersion === 2 ? parsedInitial.shapeItems.length : 0;
    const key = `${src}|${parsedInitial.schemaVersion}|${parsedInitial.canvasRef.width}x${parsedInitial.canvasRef.height}|${parsedInitial.strokes.length}|${parsedInitial.textItems.length}|${shapeN}`;
    if (hydratedKeyRef.current === key) return;

    const run = () => {
      const canvasRect = canvas.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      if (canvas.width < 2 || canvas.height < 2) return;
      const { strokes: st, textItems: ti, shapeItems: si } = deserializeImageAnnotationToEditorState(
        parsedInitial,
        canvas.width,
        canvas.height,
        canvasRect,
        containerRect,
      );
      setStrokes(
        st.map((s) => ({
          kind: "stroke" as const,
          color: s.color,
          width: snapStrokeWidth(s.width),
          points: s.points,
        })),
      );
      setShapeItems(si.map((sh) => ({ ...sh, width: snapStrokeWidth(sh.width) })));
      setTextItems(ti);
      hydratedKeyRef.current = key;
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(run);
    });
  }, [exportMode, parsedInitial, imgLoaded, src]);

  // ── Drawing primitives ─────────────────────────────────────────────────────

  function paintStroke(
    ctx: CanvasRenderingContext2D,
    points: { x: number; y: number }[],
    c: string,
    w: number,
  ) {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = c;
    ctx.lineWidth   = w;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }

  function clientToCanvas(clientX: number, clientY: number) {
    const canvas = canvasRef.current!;
    const rect   = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width  / rect.width),
      y: (clientY - rect.top)  * (canvas.height / rect.height),
    };
  }

  // ── Pencil pointer events ──────────────────────────────────────────────────

  function onCanvasPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    setSelectedId(null);
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = clientToCanvas(e.clientX, e.clientY);
    if (tool === "draw") {
      pushUndo();
      setCurrentStroke([p]);
      return;
    }
    if (tool === "eraser") {
      pushUndo();
      eraserSamplesRef.current = [p];
      return;
    }
    if (tool === "rectangle" || tool === "ellipse" || tool === "arrow") {
      setShapeDraft({ kind: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    }
  }

  function onCanvasPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = clientToCanvas(e.clientX, e.clientY);
    if (tool === "draw" && currentStroke) {
      const next = [...currentStroke, p];
      setCurrentStroke(next);
      redraw(next);
      return;
    }
    if (tool === "eraser") {
      eraserSamplesRef.current.push(p);
      return;
    }
    if (shapeDraft && (tool === "rectangle" || tool === "ellipse" || tool === "arrow")) {
      setShapeDraft({ ...shapeDraft, x2: p.x, y2: p.y });
    }
  }

  function onCanvasPointerUp() {
    if (tool === "draw") {
      if (currentStroke && currentStroke.length > 1) {
        setStrokes((prev) => [...prev, { kind: "stroke", color, width: strokeWidth, points: currentStroke }]);
      }
      setCurrentStroke(null);
      redraw();
      return;
    }
    if (tool === "eraser") {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      const samples = eraserSamplesRef.current;
      eraserSamplesRef.current = [];
      if (canvas && container && samples.length > 0) {
        const rect = container.getBoundingClientRect();
        const mapped = applyEraserSamples({
          strokes: strokes.map((s) => ({
            kind: "stroke" as const,
            color: s.color,
            width: s.width,
            points: s.points,
          })),
          shapes: shapeItems,
          textItems: textItems.map((t) => ({
            id: t.id,
            text: t.text,
            color: t.color,
            xPct: t.xPct,
            yPct: t.yPct,
            fontSize: t.fontSize,
          })),
          samples,
          radiusPx: ERASER_RADIUS_PX,
          containerW: rect.width,
          containerH: rect.height,
        });
        setStrokes(
          mapped.strokes.map((s) => ({
            kind: "stroke" as const,
            color: s.color,
            width: s.width,
            points: s.points,
          })),
        );
        setShapeItems(mapped.shapes);
        setTextItems(mapped.textItems);
      }
      redraw();
      return;
    }
    if (shapeDraft && (tool === "rectangle" || tool === "ellipse" || tool === "arrow")) {
      const { x1, y1, x2, y2, kind } = shapeDraft;
      if (Math.hypot(x2 - x1, y2 - y1) > 4) {
        pushUndo();
        const id = `sh-${Date.now()}`;
        setShapeItems((prev) => [
          ...prev,
          { id, kind, color, width: strokeWidth, x1, y1, x2, y2 },
        ]);
      }
      setShapeDraft(null);
      redraw();
    }
  }

  // ── Text input overlay ─────────────────────────────────────────────────────

  function openNewText() {
    setSelectedId(null);
    setEditingId(null);
    setDraftText("");
    setDraftColor(color);
    setShowTextInput(true);
  }

  function openEditText(item: TextItem) {
    setEditingId(item.id);
    setDraftText(item.text);
    setDraftColor(item.color);
    setShowTextInput(true);
  }

  function confirmText() {
    const trimmed = draftText.trim();
    if (!trimmed) { cancelText(); return; }

    if (editingId) {
      pushUndo();
      setTextItems(prev => prev.map(t =>
        t.id === editingId ? { ...t, text: trimmed, color: draftColor } : t,
      ));
      setSelectedId(editingId);
    } else {
      pushUndo();
      const id = `txt-${Date.now()}`;
      setTextItems(prev => [...prev, {
        id,
        text: trimmed,
        color: draftColor,
        xPct: 0.5,
        yPct: 0.5,
        fontSize: 28,
      }]);
      setSelectedId(id);
    }

    setShowTextInput(false);
    setDraftText("");
    setEditingId(null);
  }

  function cancelText() {
    setShowTextInput(false);
    setDraftText("");
    setEditingId(null);
  }

  function deleteTextItem(id: string) {
    pushUndo();
    setTextItems(prev => prev.filter(t => t.id !== id));
    setSelectedId(null);
  }

  // ── Text item drag ─────────────────────────────────────────────────────────

  function onTextPointerDown(e: React.PointerEvent<HTMLDivElement>, item: TextItem) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      id: item.id,
      startX: e.clientX,
      startY: e.clientY,
      origXPct: item.xPct,
      origYPct: item.yPct,
      moved: false,
    };
  }

  function onTextPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!dragRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const dx = (e.clientX - dragRef.current.startX) / rect.width;
    const dy = (e.clientY - dragRef.current.startY) / rect.height;
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) dragRef.current.moved = true;
    const { id, origXPct, origYPct } = dragRef.current;
    setTextItems(prev => prev.map(t =>
      t.id === id
        ? { ...t,
            xPct: Math.max(0.05, Math.min(0.95, origXPct + dx)),
            yPct: Math.max(0.05, Math.min(0.95, origYPct + dy)),
          }
        : t,
    ));
  }

  function onTextPointerUp(e: React.PointerEvent<HTMLDivElement>, item: TextItem) {
    e.stopPropagation();
    if (dragRef.current && !dragRef.current.moved) {
      // Treat as tap — toggle selection
      setSelectedId(prev => prev === item.id ? null : item.id);
    } else {
      setSelectedId(item.id);
    }
    dragRef.current = null;
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    const canvas    = canvasRef.current;
    const img       = imgRef.current;
    const container = containerRef.current;
    if (!canvas || !img || !container) return;
    setSaving(true);

    try {
      if (exportMode === "layered") {
        const canvasRect = canvas.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const annotation = serializeImageAnnotationLayered({
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
          strokes: strokes.map((s) => ({
            kind: "stroke" as const,
            color: s.color,
            width: s.width,
            points: s.points,
          })),
          shapeItems: shapeItems.map((sh) => ({
            id: sh.id,
            kind: sh.kind,
            color: sh.color,
            width: sh.width,
            x1: sh.x1,
            y1: sh.y1,
            x2: sh.x2,
            y2: sh.y2,
          })),
          textItems: textItems.map((t) => ({
            id: t.id,
            text: t.text,
            color: t.color,
            xPct: t.xPct,
            yPct: t.yPct,
            fontSize: t.fontSize,
          })),
          canvasRect,
          containerRect,
        });
        onSave({ kind: "layered", annotation });
        return;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No canvas context");

      // Redraw base image + pencil strokes + shapes
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const s of strokes) paintStroke(ctx, s.points, s.color, s.width);
      for (const sh of shapeItems) paintShapeOnCanvas(ctx, sh, false);

      // Burn text items onto canvas
      if (textItems.length > 0) {
        const cRect = canvas.getBoundingClientRect();
        const tRect = container.getBoundingClientRect();
        const scaleX = canvas.width  / cRect.width;
        const scaleY = canvas.height / cRect.height;
        const offsetX = cRect.left - tRect.left;
        const offsetY = cRect.top  - tRect.top;

        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";

        for (const item of textItems) {
          const dispX = item.xPct * tRect.width  - offsetX;
          const dispY = item.yPct * tRect.height - offsetY;
          const canX  = dispX * scaleX;
          const canY  = dispY * scaleY;
          const fs    = Math.max(18, Math.round(canvas.width * 0.05));

          ctx.font        = `bold ${fs}px Arial, sans-serif`;
          ctx.fillStyle   = item.color;
          ctx.shadowColor = "rgba(0,0,0,0.85)";
          ctx.shadowBlur  = 8;
          ctx.fillText(item.text, canX, canY);
        }

        ctx.shadowBlur   = 0;
        ctx.textAlign    = "start";
        ctx.textBaseline = "alphabetic";
      }

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          b => b ? resolve(b) : reject(new Error("toBlob returned null")),
          "image/jpeg",
          0.6,
        );
      });
      onSave({ blob, localUrl: URL.createObjectURL(blob) });
    } finally {
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Annotate image"
      style={{
        position: "fixed", inset: 0, zIndex: 600,
        backgroundColor: "#111",
        display: "flex", flexDirection: "column",
      }}
    >
      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "calc(env(safe-area-inset-top, 0px) + 10px) 16px 10px",
        flexShrink: 0, backgroundColor: "#111", zIndex: 10,
      }}>
        <button type="button" onClick={onClose} aria-label="Cancel" style={ICON_BTN}>
          <X size={20} style={{ color: "#fff" }} />
        </button>
        <span style={{ color: "#fff", fontSize: 15, fontWeight: 700 }}>Annotate</span>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          aria-label="Save"
          style={{
            ...ICON_BTN,
            backgroundColor: saving ? "rgba(255,255,255,0.15)" : "#22c55e",
            width: "auto", padding: "0 16px", borderRadius: 20, gap: 6,
          }}
        >
          <Check size={15} style={{ color: "#fff" }} />
          <span style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>
            {saving ? "Saving…" : "Save"}
          </span>
        </button>
      </div>

      {/* ── Canvas + text overlays ───────────────────────────────────────────── */}
      <div
        ref={containerRef}
        onClick={() => setSelectedId(null)}
        style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          position: "relative", overflow: "hidden", minHeight: 0,
          backgroundColor: "#000",
        }}
      >
        {!imgLoaded && (
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 14 }}>Loading…</div>
        )}

        {/* Canvas — pencil drawing only */}
        <canvas
          ref={canvasRef}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onPointerLeave={onCanvasPointerUp}
          style={{
            display: imgLoaded ? "block" : "none",
            maxWidth: "100%", maxHeight: "100%",
            touchAction: "none",
            cursor: tool === "eraser" ? "cell" : "crosshair",
          }}
        />

        {/* Text item overlays */}
        {textItems.map(item => {
          const isSelected = selectedId === item.id;
          return (
            <div
              key={item.id}
              onPointerDown={e => onTextPointerDown(e, item)}
              onPointerMove={onTextPointerMove}
              onPointerUp={e => onTextPointerUp(e, item)}
              onPointerCancel={e => { dragRef.current = null; e.stopPropagation(); }}
              onClick={e => e.stopPropagation()}
              style={{
                position: "absolute",
                left: `${item.xPct * 100}%`,
                top:  `${item.yPct * 100}%`,
                transform: "translate(-50%, -50%)",
                zIndex: isSelected ? 20 : 10,
                touchAction: "none",
                userSelect: "none",
                WebkitUserSelect: "none",
                cursor: "move",
              }}
            >
              {/* Selection ring */}
              {isSelected && (
                <div style={{
                  position: "absolute",
                  inset: -8,
                  borderRadius: 8,
                  border: "1.5px dashed rgba(255,255,255,0.6)",
                  pointerEvents: "none",
                }} />
              )}

              {/* The text label */}
              <div style={{
                color: item.color,
                fontSize: item.fontSize,
                fontWeight: 800,
                fontFamily: "Arial, sans-serif",
                whiteSpace: "nowrap",
                textShadow: "2px 2px 6px rgba(0,0,0,0.9), -1px -1px 4px rgba(0,0,0,0.9)",
                lineHeight: 1.2,
                padding: "2px 4px",
              }}>
                {item.text}
              </div>

              {/* Edit / Delete controls — only when selected */}
              {isSelected && (
                <div
                  onClick={e => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 10px)",
                    left: "50%",
                    transform: "translateX(-50%)",
                    display: "flex", gap: 8,
                    pointerEvents: "all",
                  }}
                >
                  <button
                    type="button"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); openEditText(item); }}
                    aria-label="Edit text"
                    style={{
                      width: 36, height: 36, borderRadius: 99, border: "none",
                      backgroundColor: "rgba(255,255,255,0.9)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
                    }}
                  >
                    <Edit2 size={16} style={{ color: "#111" }} />
                  </button>
                  <button
                    type="button"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); deleteTextItem(item.id); }}
                    aria-label="Delete text"
                    style={{
                      width: 36, height: 36, borderRadius: 99, border: "none",
                      backgroundColor: "#ef4444",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
                    }}
                  >
                    <Trash2 size={16} style={{ color: "#fff" }} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Bottom toolbar ───────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        padding: "12px 12px",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
        backgroundColor: "#111",
        display: "flex", flexDirection: "column", gap: 10,
      }}>
        {/* Color swatches — scroll on narrow screens */}
        <div style={{
          display: "flex", justifyContent: "flex-start", gap: 10,
          overflowX: "auto", WebkitOverflowScrolling: "touch", paddingBottom: 4,
          touchAction: "manipulation",
        }}>
          {COLORS.map(c => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              style={{
                width: 36, height: 36, minWidth: 36, minHeight: 36, borderRadius: "50%",
                backgroundColor: c,
                border: color === c ? "3px solid #fff" : "2px solid rgba(255,255,255,0.25)",
                boxShadow: color === c ? "0 0 0 2px rgba(0,0,0,0.5)" : "none",
                cursor: "pointer", padding: 0, flexShrink: 0,
              }}
            />
          ))}
        </div>

        {/* Tools: draw / eraser / shapes / stroke widths / text / undo */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          overflowX: "auto", WebkitOverflowScrolling: "touch", paddingBottom: 4,
          touchAction: "manipulation",
        }}>
          <button type="button" aria-label="Draw" aria-pressed={tool === "draw"} onClick={() => setTool("draw")}
            style={{ ...ICON_BTN, backgroundColor: tool === "draw" ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.15)" }}>
            <Pencil size={20} style={{ color: "#fff" }} />
          </button>
          <button type="button" aria-label="Eraser" aria-pressed={tool === "eraser"} onClick={() => setTool("eraser")}
            style={{ ...ICON_BTN, backgroundColor: tool === "eraser" ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.15)" }}>
            <Eraser size={20} style={{ color: "#fff" }} />
          </button>
          <button type="button" aria-label="Rectangle" aria-pressed={tool === "rectangle"} onClick={() => setTool("rectangle")}
            style={{ ...ICON_BTN, backgroundColor: tool === "rectangle" ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.15)" }}>
            <Square size={20} style={{ color: "#fff" }} />
          </button>
          <button type="button" aria-label="Ellipse" aria-pressed={tool === "ellipse"} onClick={() => setTool("ellipse")}
            style={{ ...ICON_BTN, backgroundColor: tool === "ellipse" ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.15)" }}>
            <Circle size={20} style={{ color: "#fff" }} />
          </button>
          <button type="button" aria-label="Arrow" aria-pressed={tool === "arrow"} onClick={() => setTool("arrow")}
            style={{ ...ICON_BTN, backgroundColor: tool === "arrow" ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.15)" }}>
            <ArrowUpRight size={20} style={{ color: "#fff" }} />
          </button>
          <div style={{ width: 1, height: 28, backgroundColor: "rgba(255,255,255,0.2)", flexShrink: 0 }} />
          {STROKE_WIDTHS.map(w => (
            <button
              key={w}
              type="button"
              aria-label={`Stroke ${w}px`}
              aria-pressed={strokeWidth === w}
              onClick={() => setStrokeWidth(w)}
              style={{
                width: 48, height: 48, minWidth: 48, minHeight: 48, borderRadius: "50%",
                backgroundColor: strokeWidth === w ? "rgba(255,255,255,0.25)" : "transparent",
                border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}
            >
              <div style={{
                width: w === 3 ? 14 : w === 6 ? 18 : 22,
                height: w,
                borderRadius: 99,
                backgroundColor: color,
              }} />
            </button>
          ))}
          <div style={{ width: 1, height: 28, backgroundColor: "rgba(255,255,255,0.2)", flexShrink: 0 }} />
          <button
            type="button"
            aria-label="Add text"
            onClick={openNewText}
            style={{
              ...ICON_BTN,
              backgroundColor: "rgba(255,255,255,0.15)",
              width: "auto", padding: "0 16px", gap: 4, minWidth: 48,
            }}
          >
            <span style={{ color: "#fff", fontSize: 16, fontWeight: 800, letterSpacing: -0.5 }}>Aa</span>
          </button>
          <button
            type="button"
            aria-label="Undo"
            onClick={applyUndo}
            disabled={past.length === 0}
            style={{
              ...ICON_BTN,
              opacity: past.length === 0 ? 0.35 : 1,
            }}
          >
            <RotateCcw size={20} style={{ color: "#fff" }} />
          </button>
        </div>
      </div>

      {/* ── Full-screen text input overlay (Instagram-style) ─────────────────── */}
      {showTextInput && (
        <div
          style={{
            position: "absolute", inset: 0, zIndex: 800,
            backgroundColor: "rgba(0,0,0,0.82)",
            display: "flex", flexDirection: "column",
          }}
        >
          {/* Overlay top bar */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "calc(env(safe-area-inset-top, 0px) + 12px) 16px 12px",
            flexShrink: 0,
          }}>
            <button
              type="button"
              onClick={cancelText}
              style={{ ...ICON_BTN, backgroundColor: "transparent" }}
            >
              <X size={22} style={{ color: "#fff" }} />
            </button>
            <button
              type="button"
              onClick={confirmText}
              disabled={!draftText.trim()}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: draftText.trim() ? "#fff" : "rgba(255,255,255,0.35)",
                fontSize: 17, fontWeight: 700, padding: "8px 4px",
              }}
            >
              Done
            </button>
          </div>

          {/* Live text preview — centered on the photo */}
          <div style={{
            flex: 1,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "0 24px",
            minHeight: 0,
          }}>
            <textarea
              autoFocus
              value={draftText}
              onChange={e => setDraftText(e.target.value)}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === "Escape") cancelText();
              }}
              placeholder="Add text…"
              rows={4}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                outline: "none",
                resize: "none",
                color: draftColor,
                fontSize: 32,
                fontWeight: 800,
                fontFamily: "Arial, sans-serif",
                textAlign: "center",
                textShadow: "2px 2px 8px rgba(0,0,0,0.9), -1px -1px 4px rgba(0,0,0,0.9)",
                lineHeight: 1.3,
                caretColor: "#fff",
                WebkitTextFillColor: draftColor,
              }}
            />
          </div>

          {/* Color swatches for draft */}
          <div style={{
            flexShrink: 0,
            padding: "16px",
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
            display: "flex", justifyContent: "center", gap: 14,
          }}>
            {COLORS.map(c => (
              <button
                key={c}
                type="button"
                aria-label={`Text color ${c}`}
                onClick={() => setDraftColor(c)}
                style={{
                  width: 34, height: 34, borderRadius: "50%",
                  backgroundColor: c,
                  border: draftColor === c
                    ? "3px solid #fff"
                    : "2px solid rgba(255,255,255,0.3)",
                  boxShadow: draftColor === c ? "0 0 0 2px rgba(0,0,0,0.5)" : "none",
                  cursor: "pointer", padding: 0,
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
