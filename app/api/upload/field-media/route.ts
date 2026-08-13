import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSession } from "@/lib/dev-session";
import {
  isSupabaseFieldMediaConfigured,
  writeLocalFieldMediaFile,
  absoluteAppOriginFromRequest,
} from "@/lib/field-media-local";

const BUCKET = "field-media";
const SIGNED_URL_EXPIRY_SECONDS = 365 * 24 * 60 * 60;
const MAX_BYTES = 50 * 1024 * 1024;

const ALLOWED_MIME_PREFIXES = ["image/", "video/", "audio/"];

const ALLOWED_TYPES = new Set(["ticket-comments", "tickets", "team-logos"]);

function resolvedMimeType(file: Blob, fileName?: string): string {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const ext = (fileName ?? "").split(".").pop()?.toLowerCase();
  if (ext === "heic" || ext === "heif") return "image/heic";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "mp4" || ext === "mov") return "video/mp4";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "m4a") return "audio/aac";
  return file.type || "application/octet-stream";
}

function extFromMime(mime: string): string {
  if (mime.startsWith("image/jpeg")) return "jpg";
  if (mime.startsWith("image/png")) return "png";
  if (mime.startsWith("image/webp")) return "webp";
  if (mime.startsWith("image/gif")) return "gif";
  if (mime.startsWith("image/heic") || mime.startsWith("image/heif")) return "heic";
  if (mime.includes("mp4") || mime.includes("quicktime")) return "mp4";
  if (mime.includes("webm")) return "webm";
  if (mime.startsWith("audio/mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.startsWith("audio/wav") || mime.startsWith("audio/wave")) return "wav";
  if (mime.startsWith("audio/ogg")) return "ogg";
  if (mime.startsWith("audio/aac")) return "aac";
  if (mime.startsWith("audio/")) return "webm";
  return "bin";
}

function getSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (url) return url.replace(/\/$/, "");
  const dbUrl = process.env.DATABASE_URL ?? "";
  const directMatch = dbUrl.match(/postgres\.([a-z0-9]+):/);
  if (directMatch) return `https://${directMatch[1]}.supabase.co`;
  const jwt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (jwt) {
    try {
      const payloadB64 = jwt.split(".")[1];
      if (payloadB64) {
        const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8")) as { ref?: string };
        if (payload.ref) return `https://${payload.ref}.supabase.co`;
      }
    } catch {
      /* ignore */
    }
  }
  throw new Error("SUPABASE_URL is not set and cannot be derived");
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  const typeParam = (formData.get("type") as string | null) ?? "ticket-comments";

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 50 MB limit" }, { status: 413 });
  }

  const originalName = file instanceof File ? file.name : undefined;
  const mimeType = resolvedMimeType(file, originalName);
  const isAllowed = ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
  if (!isAllowed) {
    return NextResponse.json(
      { error: "Unsupported file type. Only images, videos, and audio are accepted." },
      { status: 415 }
    );
  }

  const folder = ALLOWED_TYPES.has(typeParam) ? typeParam : "ticket-comments";
  const isTeamLogo = folder === "team-logos";

  const effectiveMaxBytes = isTeamLogo ? 5 * 1024 * 1024 : MAX_BYTES;
  if (file.size > effectiveMaxBytes) {
    return NextResponse.json(
      { error: `File exceeds ${isTeamLogo ? "5 MB" : "50 MB"} limit` },
      { status: 413 }
    );
  }

  if (isTeamLogo && !mimeType.startsWith("image/")) {
    return NextResponse.json(
      { error: "Team logos must be an image file." },
      { status: 415 }
    );
  }

  const ext = extFromMime(mimeType);
  const fileName = `${folder}/${randomUUID()}.${ext}`;
  const storageKey = `${BUCKET}/${fileName}`;

  // Local dev fallback — write to disk when Supabase is not configured
  if (!isSupabaseFieldMediaConfigured()) {
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      await writeLocalFieldMediaFile(storageKey, buf);
    } catch (err) {
      console.error("[upload/field-media] Local write failed:", err);
      return NextResponse.json({ error: "Local storage write failed" }, { status: 500 });
    }
    const origin = absoluteAppOriginFromRequest(req);
    const storageUrl = `${origin}/api/upload/field-media/file?key=${encodeURIComponent(storageKey)}`;
    return NextResponse.json({ storageKey, storageUrl, mimeType, fileSizeBytes: file.size });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    return NextResponse.json({ error: "Storage service is not configured" }, { status: 503 });
  }

  let supabaseUrl: string;
  try {
    supabaseUrl = getSupabaseUrl();
  } catch {
    return NextResponse.json({ error: "Storage service URL is not configured" }, { status: 503 });
  }

  const uploadUrl = `${supabaseUrl}/storage/v1/object/${storageKey}`;

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": mimeType,
    },
    body: file,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    console.error("[upload/field-media] Supabase upload failed:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 502 });
  }

  const signRes = await fetch(`${supabaseUrl}/storage/v1/object/sign/${storageKey}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: SIGNED_URL_EXPIRY_SECONDS }),
  });

  if (!signRes.ok) {
    const err = await signRes.text();
    console.error("[upload/field-media] Failed to sign URL:", err);
    return NextResponse.json({ error: "Failed to generate download URL" }, { status: 502 });
  }

  const { signedURL } = (await signRes.json()) as { signedURL: string };
  let storageUrl: string;
  if (signedURL.startsWith("http")) {
    storageUrl = signedURL;
  } else if (signedURL.startsWith("/storage/")) {
    storageUrl = `${supabaseUrl}${signedURL}`;
  } else {
    storageUrl = `${supabaseUrl}/storage/v1${signedURL}`;
  }

  return NextResponse.json({
    storageKey,
    storageUrl,
    mimeType,
    fileSizeBytes: file.size,
  });
}
