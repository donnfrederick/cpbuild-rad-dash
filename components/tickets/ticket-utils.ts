import { UNASSIGNED_DISPLAY_PREFIX } from "@/lib/ticket-scopes";

/** @deprecated — use `row.ref` from the API; kept for rare legacy `shortId` display. */
export function formatTicketRef(shortId: number): string {
  return `RAD-${String(shortId).padStart(4, "0")}`;
}

/** Strip simple HTML tags and collapse whitespace for card previews (not a security sanitizer). */
export function ticketDescriptionPreview(raw: string, maxChars: number): string {
  const collapsed = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "";
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, Math.max(0, maxChars - 1))}…`;
}

/** Parses `RAD-0042` / `rad-42` into numeric short id, or null if invalid. */
export function parseTicketRefLabel(input: string): number | null {
  const m = input.trim().match(/^RAD-0*(\d+)$/i);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

export type ParsedDisplayRef =
  | { kind: "legacyRad"; shortId: number }
  | { kind: "un"; keyNumber: number }
  | { kind: "prefixed"; prefix: string; keyNumber: number };

/**
 * Parses `RAD-0001` (global legacy), `UN-0001` (unassigned), or `ENG-0001` (project prefix + key number).
 */
export function parseDisplayTicketRef(input: string): ParsedDisplayRef | null {
  const t = input.trim();
  if (!t) return null;
  const rad = t.match(/^RAD-0*(\d+)$/i);
  if (rad) {
    const n = Number.parseInt(rad[1]!, 10);
    return Number.isFinite(n) && n >= 1 ? { kind: "legacyRad", shortId: n } : null;
  }
  const un = t.match(
    new RegExp(`^${UNASSIGNED_DISPLAY_PREFIX}-0*(\\d+)$`, "i")
  );
  if (un) {
    const n = Number.parseInt(un[1]!, 10);
    return Number.isFinite(n) && n >= 1 ? { kind: "un", keyNumber: n } : null;
  }
  const m = t.match(/^([A-Z0-9]{2,10})-0*(\d+)$/i);
  if (!m) return null;
  const prefix = m[1]!.toUpperCase();
  const n = Number.parseInt(m[2]!, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return { kind: "prefixed", prefix, keyNumber: n };
}
