import type { ClipboardEvent } from "react";

/**
 * Read image files from a clipboard paste event (e.g. screenshot pasted with Cmd+V).
 */
export function getClipboardImageFiles(e: ClipboardEvent): File[] {
  const out: File[] = [];
  const items = e.clipboardData?.items;
  if (!items) return out;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}
