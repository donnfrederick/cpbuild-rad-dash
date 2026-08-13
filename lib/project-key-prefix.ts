import { db } from "@/lib/db";

const MAX_LEN = 10;
const MIN_LEN = 2;

/**
 * Suggests a new unique `ticketKeyPrefix` from a project `name` (A–Z, 0–9 only).
 */
export function suggestKeyPrefixFromName(name: string): string {
  const s = name
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toUpperCase()
    .slice(0, 4);
  if (s.length >= MIN_LEN) {
    return s.slice(0, MAX_LEN);
  }
  return `P${(s + "X").replace(/[^A-Z0-9]+/g, "").slice(0, MAX_LEN - 1)}`.slice(0, MAX_LEN);
}

export async function ensureUniqueKeyPrefix(
  base: string,
  excludeProjectId: string | null
): Promise<string> {
  let n = 0;
  const cleaned = base.replace(/[^A-Z0-9]+/g, "").slice(0, MAX_LEN) || "P";
  let attempt = cleaned;
  for (;;) {
    const other = await db.project.findFirst({
      where: {
        ticketKeyPrefix: attempt,
        ...(excludeProjectId ? { id: { not: excludeProjectId } } : {}),
      },
      select: { id: true },
    });
    if (!other) {
      return attempt;
    }
    n += 1;
    const suffix = String(n);
    attempt = `${cleaned.replace(/\d+$/g, "")}${suffix}`.slice(0, MAX_LEN);
  }
}
