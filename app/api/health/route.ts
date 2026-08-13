import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    version:
      process.env.APP_VERSION ??
      process.env.NEXT_PUBLIC_APP_VERSION ??
      "unknown",
    // APP_COMMIT / APP_VERSION are plain runtime env vars set by CI before each deploy,
    // so they don't need to be baked into the Next.js build.
    // Falls back to build-time NEXT_PUBLIC_* for local dev.
    commit: process.env.APP_COMMIT ?? process.env.NEXT_PUBLIC_APP_COMMIT ?? "unknown",
    buildTime: process.env.NEXT_PUBLIC_APP_BUILD_TIME ?? null,
    env: process.env.NEXT_PUBLIC_APP_ENV ?? null,
  });
}
