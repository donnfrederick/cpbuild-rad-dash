/**
 * Versioned JSON for non-destructive image markup (pencil, shapes, text).
 * Coordinates are normalized to the editor canvas dimensions at save time.
 */
import { z } from "zod";

export const IMAGE_ANNOTATION_SCHEMA_VERSION = 2 as const;

const pointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

const strokeSchema = z.object({
  kind: z.literal("stroke"),
  color: z.string().min(1).max(32),
  widthNorm: z.number().positive().max(0.5),
  points: z.array(pointSchema).min(2).max(4000),
});

const textItemSchema = z.object({
  id: z.string().min(1).max(80),
  text: z.string().min(1).max(2000),
  color: z.string().min(1).max(32),
  xNorm: z.number().min(0).max(1),
  yNorm: z.number().min(0).max(1),
  fontSizeNorm: z.number().positive().max(0.5),
});

const shapeItemSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(["rectangle", "ellipse", "arrow"]),
  color: z.string().min(1).max(32),
  strokeWidthNorm: z.number().positive().max(0.5),
  x1: z.number().min(0).max(1),
  y1: z.number().min(0).max(1),
  x2: z.number().min(0).max(1),
  y2: z.number().min(0).max(1),
});

export const imageAnnotationV1Schema = z.object({
  schemaVersion: z.literal(1),
  canvasRef: z.object({
    width: z.number().int().positive().max(16000),
    height: z.number().int().positive().max(16000),
  }),
  strokes: z.array(strokeSchema).max(500),
  textItems: z.array(textItemSchema).max(100),
});

export const imageAnnotationV2Schema = z.object({
  schemaVersion: z.literal(2),
  canvasRef: z.object({
    width: z.number().int().positive().max(16000),
    height: z.number().int().positive().max(16000),
  }),
  strokes: z.array(strokeSchema).max(500),
  textItems: z.array(textItemSchema).max(100),
  shapeItems: z.array(shapeItemSchema).max(200),
});

export type ImageAnnotationV1 = z.infer<typeof imageAnnotationV1Schema>;
export type ImageAnnotationV2 = z.infer<typeof imageAnnotationV2Schema>;
export type ImageAnnotationPayload = ImageAnnotationV1 | ImageAnnotationV2;

export type SerializedStroke = ImageAnnotationV2["strokes"][number];
export type SerializedTextItem = ImageAnnotationV2["textItems"][number];
export type SerializedShapeItem = ImageAnnotationV2["shapeItems"][number];

const MAX_TOTAL_STROKE_POINTS = 8000;

function countStrokePoints(strokes: { points: { x: number; y: number }[] }[]): number {
  return strokes.reduce((n, s) => n + s.points.length, 0);
}

/** Parse and validate JSON from DB or API (v1 or v2). */
export function parseImageAnnotation(raw: unknown): ImageAnnotationPayload | null {
  const v2 = imageAnnotationV2Schema.safeParse(raw);
  if (v2.success) {
    if (countStrokePoints(v2.data.strokes) > MAX_TOTAL_STROKE_POINTS) return null;
    return v2.data;
  }
  const v1 = imageAnnotationV1Schema.safeParse(raw);
  if (v1.success) {
    if (countStrokePoints(v1.data.strokes) > MAX_TOTAL_STROKE_POINTS) return null;
    return v1.data;
  }
  return null;
}

export function isImageAnnotationPayload(v: unknown): v is ImageAnnotationPayload {
  return parseImageAnnotation(v) !== null;
}

/** @deprecated Use isImageAnnotationPayload */
export function isImageAnnotationV1(v: unknown): v is ImageAnnotationV1 {
  return imageAnnotationV1Schema.safeParse(v).success;
}

export interface EditorStrokeInput {
  kind: "stroke";
  color: string;
  width: number;
  points: { x: number; y: number }[];
}

export interface EditorShapeInput {
  id: string;
  kind: "rectangle" | "ellipse" | "arrow";
  color: string;
  width: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface EditorTextItemInput {
  id: string;
  text: string;
  color: string;
  xPct: number;
  yPct: number;
  fontSize: number;
}

/** Layered save always persists as schema v2. */
export function serializeImageAnnotationLayered(params: {
  canvasWidth: number;
  canvasHeight: number;
  strokes: EditorStrokeInput[];
  shapeItems: EditorShapeInput[];
  textItems: EditorTextItemInput[];
  canvasRect: DOMRectReadOnly;
  containerRect: DOMRectReadOnly;
}): ImageAnnotationV2 {
  const { canvasWidth, canvasHeight, strokes, shapeItems, textItems, canvasRect, containerRect } = params;
  const minDim = Math.min(canvasWidth, canvasHeight);
  const scaleX = canvasWidth / canvasRect.width;
  const scaleY = canvasHeight / canvasRect.height;
  const offsetX = canvasRect.left - containerRect.left;
  const offsetY = canvasRect.top - containerRect.top;

  const outStrokes: SerializedStroke[] = strokes.map((s) => ({
    kind: "stroke" as const,
    color: s.color,
    widthNorm: s.width / minDim,
    points: s.points.map((p) => ({
      x: p.x / canvasWidth,
      y: p.y / canvasHeight,
    })),
  }));

  const outShapes: SerializedShapeItem[] = shapeItems.map((sh) => ({
    id: sh.id,
    kind: sh.kind,
    color: sh.color,
    strokeWidthNorm: sh.width / minDim,
    x1: sh.x1 / canvasWidth,
    y1: sh.y1 / canvasHeight,
    x2: sh.x2 / canvasWidth,
    y2: sh.y2 / canvasHeight,
  }));

  const outText: SerializedTextItem[] = textItems.map((item) => {
    const dispX = item.xPct * containerRect.width - offsetX;
    const dispY = item.yPct * containerRect.height - offsetY;
    const canX = dispX * scaleX;
    const canY = dispY * scaleY;
    return {
      id: item.id,
      text: item.text,
      color: item.color,
      xNorm: canX / canvasWidth,
      yNorm: canY / canvasHeight,
      fontSizeNorm: item.fontSize / canvasHeight,
    };
  });

  return {
    schemaVersion: 2,
    canvasRef: { width: canvasWidth, height: canvasHeight },
    strokes: outStrokes,
    textItems: outText,
    shapeItems: outShapes,
  };
}

/** @deprecated Use serializeImageAnnotationLayered */
export function serializeImageAnnotationV1(params: {
  canvasWidth: number;
  canvasHeight: number;
  strokes: EditorStrokeInput[];
  textItems: EditorTextItemInput[];
  canvasRect: DOMRectReadOnly;
  containerRect: DOMRectReadOnly;
}): ImageAnnotationV1 {
  const v2 = serializeImageAnnotationLayered({
    ...params,
    shapeItems: [],
  });
  return {
    schemaVersion: 1,
    canvasRef: v2.canvasRef,
    strokes: v2.strokes,
    textItems: v2.textItems,
  };
}

/**
 * Expand stored JSON into editor state (canvas px for strokes/shapes, container % for text).
 */
export function deserializeImageAnnotationToEditorState(
  ann: ImageAnnotationPayload,
  canvasWidth: number,
  canvasHeight: number,
  canvasRect: DOMRectReadOnly,
  containerRect: DOMRectReadOnly,
): {
  strokes: EditorStrokeInput[];
  shapeItems: EditorShapeInput[];
  textItems: EditorTextItemInput[];
} {
  const minDim = Math.min(canvasWidth, canvasHeight);
  const scaleX = canvasWidth / canvasRect.width;
  const scaleY = canvasHeight / canvasRect.height;
  const offsetX = canvasRect.left - containerRect.left;
  const offsetY = canvasRect.top - containerRect.top;

  const strokes: EditorStrokeInput[] = ann.strokes.map((s) => ({
    kind: "stroke" as const,
    color: s.color,
    width: s.widthNorm * minDim,
    points: s.points.map((p) => ({
      x: p.x * canvasWidth,
      y: p.y * canvasHeight,
    })),
  }));

  const shapeItems: EditorShapeInput[] =
    ann.schemaVersion === 2
      ? ann.shapeItems.map((sh) => ({
          id: sh.id,
          kind: sh.kind,
          color: sh.color,
          width: sh.strokeWidthNorm * minDim,
          x1: sh.x1 * canvasWidth,
          y1: sh.y1 * canvasHeight,
          x2: sh.x2 * canvasWidth,
          y2: sh.y2 * canvasHeight,
        }))
      : [];

  const textItems: EditorTextItemInput[] = ann.textItems.map((t) => {
    const canX = t.xNorm * canvasWidth;
    const canY = t.yNorm * canvasHeight;
    const dispX = canX / scaleX;
    const dispY = canY / scaleY;
    const xPct = (dispX + offsetX) / containerRect.width;
    const yPct = (dispY + offsetY) / containerRect.height;
    return {
      id: t.id,
      text: t.text,
      color: t.color,
      xPct: Math.max(0.05, Math.min(0.95, xPct)),
      yPct: Math.max(0.05, Math.min(0.95, yPct)),
      fontSize: Math.max(12, Math.round(t.fontSizeNorm * canvasHeight)),
    };
  });

  return { strokes, shapeItems, textItems };
}

/** @deprecated Use deserializeImageAnnotationToEditorState */
export function deserializeImageAnnotationV1ToEditorState(
  ann: ImageAnnotationV1,
  canvasWidth: number,
  canvasHeight: number,
  canvasRect: DOMRectReadOnly,
  containerRect: DOMRectReadOnly,
): {
  strokes: EditorStrokeInput[];
  textItems: EditorTextItemInput[];
} {
  const { strokes, textItems } = deserializeImageAnnotationToEditorState(
    ann,
    canvasWidth,
    canvasHeight,
    canvasRect,
    containerRect,
  );
  return { strokes, textItems };
}
