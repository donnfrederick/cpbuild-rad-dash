/**
 * Parse sprint date fields from API JSON (e.g. `YYYY-MM-DD` from `<input type="date">` or ISO strings).
 * @returns `null` when empty / omitted / invalid (caller may treat invalid as 400).
 */
export function parseSprintDateInput(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (s === "") return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseSprintOptionalInt(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string") {
    const t = value.trim();
    if (t === "") return null;
    const n = Number.parseInt(t, 10);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }
  return undefined;
}
