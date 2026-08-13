/** Max stored length for a tag name (trimmed, case-insensitive storage uses lowercase). */
export const TAG_NAME_MAX_LENGTH = 50;

/** Lowercase trimmed tag name for storage and deduplication (capped at {@link TAG_NAME_MAX_LENGTH}). */
export function normalizeTagName(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (t.length <= TAG_NAME_MAX_LENGTH) return t;
  return t.slice(0, TAG_NAME_MAX_LENGTH);
}

/** Text up to and including the last comma or newline, and the trimmed segment after it (the token being edited). */
export function splitTagInputPrefixAndCurrentToken(input: string): { prefix: string; currentToken: string } {
  let sep = -1;
  for (let j = input.length - 1; j >= 0; j--) {
    if (input[j] === "," || input[j] === "\n") {
      sep = j;
      break;
    }
  }
  if (sep < 0) {
    return { prefix: "", currentToken: input.trim() };
  }
  return {
    prefix: input.slice(0, sep + 1),
    currentToken: input.slice(sep + 1).trim(),
  };
}

/**
 * Limits the segment the user is currently typing (after the last comma/newline) to
 * {@link TAG_NAME_MAX_LENGTH} characters so the field cannot exceed the cap while typing.
 */
export function capCurrentTagToken(input: string, max: number = TAG_NAME_MAX_LENGTH): string {
  const { prefix, currentToken } = splitTagInputPrefixAndCurrentToken(input);
  if (currentToken.length <= max) return input;
  const capped = currentToken.slice(0, max);
  if (!prefix) return capped;
  const base = prefix.replace(/\s+$/, "");
  const spacer = base.endsWith(",") || base.endsWith("\n") ? " " : ", ";
  return `${base}${spacer}${capped}`;
}

/** Replace the current token with a chosen tag name (keeps earlier comma-separated segments). */
export function replaceCurrentTagToken(input: string, chosenName: string): string {
  const safe =
    chosenName.length > TAG_NAME_MAX_LENGTH ? chosenName.slice(0, TAG_NAME_MAX_LENGTH) : chosenName;
  const { prefix } = splitTagInputPrefixAndCurrentToken(input);
  const base = prefix.replace(/\s+$/, "");
  if (!base) return safe;
  const spacer = base.endsWith(",") || base.endsWith("\n") ? " " : ", ";
  return `${base}${spacer}${safe}`;
}

/** Split comma/newline separated user input into normalized unique tag names. */
export function parseTagInput(input: string): string[] {
  const parts = input.split(/[\n,]+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const n = normalizeTagName(p);
    if (!n) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}
