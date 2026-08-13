import fs from "fs/promises";
import path from "path";
import type { NextRequest } from "next/server";

const DEFAULT_RELATIVE_ROOT = ".local-field-media";

/** When false, POST /api/upload/field-media writes to local disk instead of Supabase. */
export function isSupabaseFieldMediaConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

export function getLocalFieldMediaRoot(): string {
  const env = process.env.LOCAL_FIELD_MEDIA_ROOT?.trim();
  if (env) return path.resolve(env);
  return path.join(process.cwd(), DEFAULT_RELATIVE_ROOT);
}

const ALLOWED_FIELD_MEDIA_FOLDERS = new Set(["ticket-comments", "tickets", "team-logos"]);

/** Validates keys produced by POST /api/upload/field-media (path injection safe). */
export function isValidFieldMediaStorageKey(key: string): boolean {
  if (!key || key.includes("..") || !key.startsWith("field-media/")) return false;
  const rest = key.slice("field-media/".length);
  if (!rest || rest.startsWith("/") || rest.endsWith("/")) return false;
  const segments = rest.split("/");
  if (segments.length < 2) return false;
  if (!ALLOWED_FIELD_MEDIA_FOLDERS.has(segments[0] ?? "")) return false;
  return segments.every((s) => s.length > 0 && !s.includes(".."));
}

function resolveSafeAbsolutePath(storageKey: string): string | null {
  if (!isValidFieldMediaStorageKey(storageKey)) return null;
  const root = path.resolve(getLocalFieldMediaRoot());
  const full = path.join(root, ...storageKey.split("/"));
  const rel = path.relative(root, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return full;
}

export async function writeLocalFieldMediaFile(storageKey: string, data: Buffer): Promise<void> {
  const abs = resolveSafeAbsolutePath(storageKey);
  if (!abs) throw new Error("Invalid storage key");
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, data);
}

export async function readLocalFieldMediaFile(storageKey: string): Promise<Buffer | null> {
  const abs = resolveSafeAbsolutePath(storageKey);
  if (!abs) return null;
  try {
    return await fs.readFile(abs);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    throw e;
  }
}

/** Best-effort delete of local files for validated storage keys (ignores missing files). */
export async function unlinkLocalFieldMediaKeys(keys: string[]): Promise<void> {
  await Promise.all(
    keys.map(async (key) => {
      if (!isValidFieldMediaStorageKey(key)) return;
      const abs = resolveSafeAbsolutePath(key);
      if (!abs) return;
      try {
        await fs.unlink(abs);
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (err.code === "ENOENT") return;
        throw e;
      }
    })
  );
}

/** MIME type for GET responses; aligned with upload extension mapping. */
export function contentTypeForFieldMediaKey(storageKey: string): string {
  const ext = storageKey.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    aac: "audio/aac",
    bin: "application/octet-stream",
  };
  return map[ext] ?? "application/octet-stream";
}

/**
 * Public origin for storageUrl (localhost or tunnel).
 * Prefer request headers; fall back to NEXTAUTH_URL / AUTH_URL; then localhost:3000.
 */
export function absoluteAppOriginFromRequest(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const proto =
      req.headers.get("x-forwarded-proto") ??
      (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");
    return `${proto}://${host}`;
  }
  const fromEnv =
    process.env.NEXTAUTH_URL?.replace(/\/$/, "") ??
    process.env.AUTH_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  return "http://localhost:3000";
}
