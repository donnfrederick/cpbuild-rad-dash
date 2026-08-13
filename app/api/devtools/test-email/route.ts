/**
 * POST /api/devtools/test-email
 *
 * Sends a test email to the given address. Admin only.
 * Allowed in local dev and when APP_ENV=dev (Railway dev).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { sendTestEmail, getEmailConfig } from "@/lib/email";
import { isDevToolsAllowed, DEVTOOLS_BLOCKED_MESSAGE } from "@/lib/devtools-env";
import type { ApiError } from "@/types";
import {
  tryRecordEmailOutbound,
  devtoolsTestEmailActorScopeKey,
  DEVTOOLS_TEST_EMAIL_WINDOW_MS,
  DEVTOOLS_TEST_EMAIL_MAX,
  hashForEmailSecurityLog,
  logEmailSecurityEvent,
} from "@/lib/email-outbound-rate-limit";

const testEmailRequestSchema = z.object({ to: z.string().email("Valid email address required") });

function isAdminRole(role: string): boolean {
  return role === "ADMIN";
}

async function getSession() {
  const isBypass =
    process.env.DEV_BYPASS_AUTH === "true" && process.env.NODE_ENV !== "production";
  if (isBypass) {
    const { db } = await import("@/lib/db");
    const admin = await db.user.findFirst({
      where: { role: { code: "ADMIN" } },
      select: { id: true, name: true, email: true },
    });
    if (admin) return { user: { id: admin.id, name: admin.name, email: admin.email, role: "ADMIN" } };
  }
  return auth();
}

export async function POST(request: Request) {
  if (!isDevToolsAllowed()) {
    return NextResponse.json<ApiError>({ error: DEVTOOLS_BLOCKED_MESSAGE }, { status: 403 });
  }

  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json<ApiError>({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminRole(session.user.role)) {
    return NextResponse.json<ApiError>({ error: "Forbidden" }, { status: 403 });
  }

  const body: unknown = await request.json();
  const parsed = testEmailRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json<ApiError>(
      { error: parsed.error.issues[0]?.message ?? "Valid email address required (body: { to: string })" },
      { status: 422 }
    );
  }
  const { to } = parsed.data;

  const testRl = tryRecordEmailOutbound(devtoolsTestEmailActorScopeKey(session.user.id), {
    windowMs: DEVTOOLS_TEST_EMAIL_WINDOW_MS,
    max: DEVTOOLS_TEST_EMAIL_MAX,
  });
  if (!testRl.ok) {
    logEmailSecurityEvent({
      event: "devtools_test_email_throttled",
      actorUserIdHash: hashForEmailSecurityLog(session.user.id),
      count: testRl.count,
      limit: testRl.limit,
    });
    return NextResponse.json<ApiError>(
      {
        error: "TEST_EMAIL_RATE_LIMITED",
        detail: "Too many test emails from your account. Try again later.",
      },
      { status: 429 }
    );
  }

  try {
    const result = await sendTestEmail(to);
    return NextResponse.json({
      data: {
        to,
        transport: result.transport,
        messageId: result.messageId,
        message: result.transport === "smtp"
          ? "Sent via SMTP (Mailpit). Check http://localhost:8025"
          : "Sent via Resend. Check inbox.",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[devtools] test-email failed:", err);
    return NextResponse.json<ApiError>(
      { error: "Failed to send test email", detail: message },
      { status: 500 }
    );
  }
}

export async function GET() {
  if (!isDevToolsAllowed()) {
    return NextResponse.json<ApiError>({ error: DEVTOOLS_BLOCKED_MESSAGE }, { status: 403 });
  }

  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json<ApiError>({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminRole(session.user.role)) {
    return NextResponse.json<ApiError>({ error: "Forbidden" }, { status: 403 });
  }

  const config = getEmailConfig();
  return NextResponse.json({
    data: config,
    hint:
      config.transport === "smtp"
        ? "Using SMTP (Mailpit). Set RESEND_API_KEY + EMAIL_FROM for real delivery in dev."
        : "Using Resend. Ensure EMAIL_FROM is set to a verified domain address (e.g. noreply@cp-command-center.com).",
  });
}
