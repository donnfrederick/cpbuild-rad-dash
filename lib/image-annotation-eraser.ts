/**
 * Vector eraser: removes freehand strokes / shapes / text touched by the eraser path.
 */

import type { EditorShapeInput, EditorStrokeInput, EditorTextItemInput } from "@/lib/image-annotation-schema";

function distPointToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const c1 = wx * vx + wy * vy;
  if (c1 <= 0) return Math.hypot(px - ax, py - ay);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px - bx, py - by);
  const t = c1 / c2;
  const projx = ax + t * vx;
  const projy = ay + t * vy;
  return Math.hypot(px - projx, py - projy);
}

function strokeHitByPoint(
  stroke: EditorStrokeInput,
  px: number,
  py: number,
  radius: number,
): boolean {
  const w = stroke.width;
  for (let i = 0; i + 1 < stroke.points.length; i++) {
    const a = stroke.points[i];
    const b = stroke.points[i + 1];
    const d = distPointToSeg(px, py, a.x, a.y, b.x, b.y);
    if (d <= radius + w / 2) return true;
  }
  return false;
}

function shapeHitByPoint(s: EditorShapeInput, px: number, py: number, radius: number): boolean {
  const minX = Math.min(s.x1, s.x2) - radius;
  const maxX = Math.max(s.x1, s.x2) + radius;
  const minY = Math.min(s.y1, s.y2) - radius;
  const maxY = Math.max(s.y1, s.y2) + radius;
  if (px < minX || px > maxX || py < minY || py > maxY) return false;

  if (s.kind === "rectangle") {
    const left = Math.min(s.x1, s.x2);
    const right = Math.max(s.x1, s.x2);
    const top = Math.min(s.y1, s.y2);
    const bottom = Math.max(s.y1, s.y2);
    const nearEdge =
      distPointToSeg(px, py, left, top, right, top) <= radius + s.width ||
      distPointToSeg(px, py, right, top, right, bottom) <= radius + s.width ||
      distPointToSeg(px, py, right, bottom, left, bottom) <= radius + s.width ||
      distPointToSeg(px, py, left, bottom, left, top) <= radius + s.width;
    return nearEdge;
  }

  if (s.kind === "ellipse") {
    const cx = (s.x1 + s.x2) / 2;
    const cy = (s.y1 + s.y2) / 2;
    const rx = Math.abs(s.x2 - s.x1) / 2;
    const ry = Math.abs(s.y2 - s.y1) / 2;
    if (rx < 1 || ry < 1) return false;
    const nx = (px - cx) / rx;
    const ny = (py - cy) / ry;
    const dist = Math.abs(Math.hypot(nx, ny) - 1) * Math.min(rx, ry);
    return dist <= radius + s.width;
  }

  // arrow = line + arrowhead box — erase if near main line
  return distPointToSeg(px, py, s.x1, s.y1, s.x2, s.y2) <= radius + s.width * 2;
}

function textHitByPoint(
  t: EditorTextItemInput,
  px: number,
  py: number,
  radius: number,
  containerW: number,
  containerH: number,
): boolean {
  const cx = t.xPct * containerW;
  const cy = t.yPct * containerH;
  const approxW = Math.max(t.text.length * t.fontSize * 0.55, t.fontSize * 2);
  const approxH = t.fontSize * 1.4;
  return (
    px >= cx - approxW / 2 - radius &&
    px <= cx + approxW / 2 + radius &&
    py >= cy - approxH / 2 - radius &&
    py <= cy + approxH / 2 + radius
  );
}

/**
 * Apply eraser samples (canvas coords). Removes any stroke/shape/text touched by any sample.
 */
export function applyEraserSamples(params: {
  strokes: EditorStrokeInput[];
  shapes: EditorShapeInput[];
  textItems: EditorTextItemInput[];
  samples: { x: number; y: number }[];
  radiusPx: number;
  containerW: number;
  containerH: number;
}): {
  strokes: EditorStrokeInput[];
  shapes: EditorShapeInput[];
  textItems: EditorTextItemInput[];
} {
  const { strokes, shapes, textItems, samples, radiusPx, containerW, containerH } = params;
  if (samples.length === 0) return { strokes, shapes, textItems };

  const nextStrokes = strokes.filter((s) => {
    for (const p of samples) {
      if (strokeHitByPoint(s, p.x, p.y, radiusPx)) return false;
    }
    return true;
  });

  const nextShapes = shapes.filter((sh) => {
    for (const p of samples) {
      if (shapeHitByPoint(sh, p.x, p.y, radiusPx)) return false;
    }
    return true;
  });

  const nextText = textItems.filter((t) => {
    for (const p of samples) {
      if (textHitByPoint(t, p.x, p.y, radiusPx, containerW, containerH)) return false;
    }
    return true;
  });

  return { strokes: nextStrokes, shapes: nextShapes, textItems: nextText };
}
