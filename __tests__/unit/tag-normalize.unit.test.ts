import { describe, it, expect } from "vitest";
import {
  TAG_NAME_MAX_LENGTH,
  capCurrentTagToken,
  normalizeTagName,
  parseTagInput,
} from "@/lib/tag-normalize";

describe("normalizeTagName", () => {
  it("caps length at TAG_NAME_MAX_LENGTH", () => {
    const long = "a".repeat(55);
    expect(normalizeTagName(long).length).toBe(TAG_NAME_MAX_LENGTH);
    expect(normalizeTagName(long)).toBe("a".repeat(TAG_NAME_MAX_LENGTH));
  });
});

describe("capCurrentTagToken", () => {
  it("caps only the active segment", () => {
    const prefix = "a, ";
    const token = "b".repeat(60);
    const input = `${prefix}${token}`;
    const out = capCurrentTagToken(input);
    expect(out.startsWith(prefix)).toBe(true);
    expect(out.slice(prefix.length).length).toBe(TAG_NAME_MAX_LENGTH);
  });
});

describe("parseTagInput", () => {
  it("produces names within max length", () => {
    const long = "x".repeat(60);
    const out = parseTagInput(long);
    expect(out).toHaveLength(1);
    expect(out[0].length).toBe(TAG_NAME_MAX_LENGTH);
  });
});
