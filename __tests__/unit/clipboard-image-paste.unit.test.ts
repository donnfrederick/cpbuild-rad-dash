import { describe, it, expect } from "vitest";
import { getClipboardImageFiles } from "@/lib/clipboard-image-paste";
import type { ClipboardEvent } from "react";

type FakeItem = { kind: string; type: string; file?: File | null };

function makeEvent(items: FakeItem[]): ClipboardEvent {
  const list = Object.assign(
    items.map((item) => ({
      kind: item.kind,
      type: item.type,
      getAsFile: () => item.file ?? null,
    })),
    { length: items.length }
  );
  return {
    clipboardData: { items: list },
    preventDefault: () => {},
  } as unknown as ClipboardEvent;
}

const pngFile = new File([""], "screenshot.png", { type: "image/png" });
const jpgFile = new File([""], "photo.jpg", { type: "image/jpeg" });

describe("getClipboardImageFiles()", () => {
  it("returns empty array when clipboardData is absent", () => {
    const e = { clipboardData: null, preventDefault: () => {} } as unknown as ClipboardEvent;
    expect(getClipboardImageFiles(e)).toEqual([]);
  });

  it("returns empty array when items is undefined", () => {
    const e = { clipboardData: {}, preventDefault: () => {} } as unknown as ClipboardEvent;
    expect(getClipboardImageFiles(e)).toEqual([]);
  });

  it("returns empty array when clipboard contains only text", () => {
    const e = makeEvent([{ kind: "string", type: "text/plain" }]);
    expect(getClipboardImageFiles(e)).toEqual([]);
  });

  it("returns empty array when a file item has a non-image mime type", () => {
    const pdf = new File([""], "doc.pdf", { type: "application/pdf" });
    const e = makeEvent([{ kind: "file", type: "application/pdf", file: pdf }]);
    expect(getClipboardImageFiles(e)).toEqual([]);
  });

  it("returns a single image file pasted from clipboard", () => {
    const e = makeEvent([{ kind: "file", type: "image/png", file: pngFile }]);
    expect(getClipboardImageFiles(e)).toEqual([pngFile]);
  });

  it("returns multiple image files when several are pasted", () => {
    const e = makeEvent([
      { kind: "file", type: "image/png", file: pngFile },
      { kind: "file", type: "image/jpeg", file: jpgFile },
    ]);
    expect(getClipboardImageFiles(e)).toEqual([pngFile, jpgFile]);
  });

  it("filters out non-image files when mixed with images", () => {
    const txt = new File([""], "note.txt", { type: "text/plain" });
    const e = makeEvent([
      { kind: "file", type: "image/png", file: pngFile },
      { kind: "file", type: "text/plain", file: txt },
    ]);
    expect(getClipboardImageFiles(e)).toEqual([pngFile]);
  });

  it("skips items where getAsFile() returns null", () => {
    const e = makeEvent([{ kind: "file", type: "image/png", file: null }]);
    expect(getClipboardImageFiles(e)).toEqual([]);
  });
});
