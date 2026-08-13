/**
 * GET /api/devtools/email-preview
 *
 * Returns the rendered HTML (and subject) for an email template without sending it.
 * Used by the invite modal previewer. DevTools-gated (admin/developer only).
 *
 * Query params:
 *   type        — email type to preview. Currently only "invite" is supported.
 *   to          — recipient email (used for greeting derivation and dev-banner display)
 *   inviteeName — optional first name entered by the inviter
 *   inviterName — optional inviter display name (defaults to "You")
 *   roleName    — optional role label (e.g. "Member")
 */
import { NextResponse } from "next/server";
import { isDevToolsAllowed, DEVTOOLS_BLOCKED_MESSAGE } from "@/lib/devtools-env";
import { requireDevToolsAdmin } from "@/lib/devtools-auth";
import { buildInviteEmailContent, isNonProd } from "@/lib/email";
import type { ApiError } from "@/types";

export async function GET(request: Request) {
  if (!isDevToolsAllowed()) {
    return NextResponse.json<ApiError>({ error: DEVTOOLS_BLOCKED_MESSAGE }, { status: 403 });
  }

  const guard = await requireDevToolsAdmin();
  if (guard) return guard;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "invite";

  if (type !== "invite") {
    return NextResponse.json<ApiError>({ error: `Unknown email type: ${type}` }, { status: 400 });
  }

  const to = searchParams.get("to") ?? "invitee@example.com";
  const inviteeName = searchParams.get("inviteeName") ?? undefined;
  const inviterName = searchParams.get("inviterName") ?? "Your Admin";
  const roleName = searchParams.get("roleName") ?? undefined;

  const nonProd = isNonProd();
  // In non-prod, show the dev banner even without an active DEV_EMAIL_OVERRIDE
  // so the preview accurately represents what a redirected email would look like.
  // In production (nonProd=false), forceDevBanner is ignored by buildInviteEmailContent.
  const { subject, html } = buildInviteEmailContent(
    { to, inviterName, inviteeName, roleName, forceDevBanner: true },
    { nonProd, isRedirected: false }
  );

  return NextResponse.json({ data: { subject, html, type } });
}
