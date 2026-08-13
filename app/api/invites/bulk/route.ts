import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/session-context";
import { createSingleInvite } from "@/lib/invite-service";
import { bulkInvitesSchema, parseBulkInviteEmails } from "@/lib/validations/invite";

/** POST /api/invites/bulk — create multiple invites (ADMIN only); per-email outcomes */
export async function POST(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body: unknown = await req.json();
  const parsed = bulkInvitesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { valid: emails, invalid: invalidEmails } = parseBulkInviteEmails(parsed.data.emails);
  if (emails.length === 0) {
    return NextResponse.json(
      {
        error: "No valid emails after trimming",
        invalidEmails,
      },
      { status: 422 }
    );
  }

  const roleId = parsed.data.roleId;
  const teamAssignments = parsed.data.teamAssignments;
  const grantAllTeams = parsed.data.grantAllTeams;
  const results: Array<{
    email: string;
    success: boolean;
    invite?: { id: string; email: string; token: string; expiresAt: string };
    inviteLink?: string;
    emailSent?: boolean;
    emailErrorCode?: string;
    error?: string;
    errorKind?: string;
  }> = [];

  for (const email of emails) {
    const r = await createSingleInvite(email, roleId, ctx.user.id, teamAssignments, grantAllTeams);
    if (r.success) {
      results.push({
        email,
        success: true,
        invite: r.invite,
        inviteLink: r.inviteLink,
        emailSent: r.emailSent,
        ...(r.emailErrorCode !== undefined ? { emailErrorCode: r.emailErrorCode } : {}),
      });
    } else {
      results.push({
        email,
        success: false,
        error: r.error,
        errorKind: r.errorKind,
      });
    }
  }

  const created = results.filter((x) => x.success).length;
  const failed = results.length - created;

  return NextResponse.json({
    results,
    summary: { total: results.length, created, failed },
    ...(invalidEmails.length > 0 ? { invalidEmails } : {}),
  });
}
