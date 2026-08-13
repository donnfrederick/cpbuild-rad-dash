/**
 * GET /api/devtools/diagnostics
 *
 * Server-side diagnostic checks returned as JSON.
 * Hard-blocked in production.
 *
 * Returns:
 *   - db: database connectivity + basic stats
 *   - env: required environment variable presence (values never exposed)
 */

import { NextResponse } from "next/server";
import { isDevToolsAllowed, DEVTOOLS_BLOCKED_MESSAGE } from "@/lib/devtools-env";

export const dynamic = "force-dynamic";

interface DiagResult {
  name: string;
  pass: boolean;
  warning?: boolean;
  detail: string;
  durationMs?: number;
}

async function checkDatabase(): Promise<DiagResult[]> {
  const results: DiagResult[] = [];
  const t0 = Date.now();

  try {
    const { db } = await import("@/lib/db");

    // Basic connectivity
    await db.$queryRaw`SELECT 1`;
    const pingMs = Date.now() - t0;

    results.push({
      name: "Database Connection",
      pass: true,
      detail: `Connected successfully (${pingMs}ms)`,
      durationMs: pingMs,
    });

    // Project count
    const t1 = Date.now();
    const projectCount = await db.project.count();
    results.push({
      name: "Projects Table",
      pass: true,
      detail: `${projectCount} project${projectCount !== 1 ? "s" : ""}`,
      durationMs: Date.now() - t1,
    });

    // User count
    const t2 = Date.now();
    const userCount = await db.user.count();
    results.push({
      name: "Users Table",
      pass: true,
      detail: `${userCount} user${userCount !== 1 ? "s" : ""} registered`,
      durationMs: Date.now() - t2,
    });

    // Pending invites
    const t3 = Date.now();
    const pendingInvites = await db.invite.count({
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
    });
    results.push({
      name: "Invites Table",
      pass: true,
      detail: `${pendingInvites} pending invite${pendingInvites !== 1 ? "s" : ""}`,
      durationMs: Date.now() - t3,
    });

  } catch (err) {
    results.push({
      name: "Database Connection",
      pass: false,
      detail: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - t0,
    });
  }

  return results;
}

function checkEnvVars(): DiagResult[] {
  const checks: Array<{
    name: string;
    key: string;
    required: boolean;
    description: string;
    validate?: (v: string) => string | null; // returns error message or null
  }> = [
    {
      name: "DATABASE_URL",
      key: "DATABASE_URL",
      required: true,
      description: "PostgreSQL connection string",
      validate: (v) =>
        v.startsWith("postgresql://") || v.startsWith("postgres://")
          ? null
          : "Must start with postgresql:// or postgres://",
    },
    {
      name: "AUTH_SECRET",
      key: "AUTH_SECRET",
      required: true,
      description: "NextAuth.js signing secret",
      validate: (v) => (v.length >= 32 ? null : "Should be at least 32 characters (run: openssl rand -base64 32)"),
    },
    {
      name: "AUTH_URL",
      key: "AUTH_URL",
      required: false,
      description: "NextAuth.js base URL — required when not behind a trusted host",
      validate: (v) =>
        v.startsWith("http://") || v.startsWith("https://")
          ? null
          : "Must be a full URL (http:// or https://)",
    },
    {
      name: "DEV_BYPASS_AUTH",
      key: "DEV_BYPASS_AUTH",
      required: false,
      description: "Dev-only auth bypass flag",
      validate: (v) =>
        v === "true" && process.env.NODE_ENV === "production"
          ? "DANGER: DEV_BYPASS_AUTH=true in production!"
          : null,
    },
    {
      name: "RESEND_API_KEY",
      key: "RESEND_API_KEY",
      required: false,
      description: "Resend API key for invite emails (required in dev/prod for real delivery)",
      validate: (v) =>
        v?.startsWith("re_YOUR") ? "Still placeholder — get key from resend.com" : null,
    },
    {
      name: "EMAIL_FROM",
      key: "EMAIL_FROM",
      required: false,
      description: "From address for emails",
    },
    {
      name: "APP_ENV",
      key: "APP_ENV",
      required: false,
      description: "Set to 'dev' on Railway dev to enable DevTools (NODE_ENV=production there)",
    },
    {
      name: "NEXT_PUBLIC_APP_ENV",
      key: "NEXT_PUBLIC_APP_ENV",
      required: false,
      description: "Client-readable APP_ENV mirror for DevTools tab visibility",
    },
  ];

  return checks.map(({ name, key, required, description, validate }) => {
    const value = process.env[key];
    const isSet = value !== undefined && value !== "";

    if (!isSet) {
      return {
        name,
        pass: !required,
        warning: !required,
        detail: required ? `Missing — ${description}` : `Not set (optional) — ${description}`,
      };
    }

    const validationError = validate?.(value);
    if (validationError) {
      return {
        name,
        pass: false,
        warning: true,
        detail: validationError,
      };
    }

    // Mask the actual value but show it's set
    let masked: string;
    if (key.toLowerCase().includes("password") || key.toLowerCase().includes("secret")) {
      masked = `Set (${value.length} chars)`;
    } else if (key === "DATABASE_URL") {
      masked = `Set — ${value.replace(/:[^:@]+@/, ":***@")}`;
    } else {
      masked = `Set — ${value}`;
    }

    return { name, pass: true, detail: masked };
  });
}

export async function GET() {
  if (!isDevToolsAllowed()) {
    return NextResponse.json({ error: DEVTOOLS_BLOCKED_MESSAGE }, { status: 403 });
  }

  const [dbResults, envResults] = await Promise.all([
    checkDatabase(),
    Promise.resolve(checkEnvVars()),
  ]);

  return NextResponse.json({
    db: dbResults,
    env: envResults,
    timestamp: new Date().toISOString(),
  });
}
