import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { sendInviteEmail } from "@/lib/email";
import { classifyInviteEmailError, type InviteEmailErrorCode } from "@/lib/invite-service";

/** POST /api/invites/[id]/resend — resend invite email (ADMIN only) */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const invite = await db.invite.findUnique({
    where: { id },
    include: {
      sentBy: { select: { name: true, email: true } },
      role: { select: { name: true } },
    },
  });

  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  if (invite.acceptedAt) {
    return NextResponse.json({ error: "This invite has already been accepted" }, { status: 410 });
  }

  if (invite.expiresAt < new Date()) {
    return NextResponse.json({ error: "This invite has expired" }, { status: 410 });
  }

  const inviterName = invite.sentBy?.name ?? invite.sentBy?.email ?? "Administrator";

  let emailSent = false;
  let emailErrorCode: InviteEmailErrorCode | undefined;
  try {
    await sendInviteEmail({
      to: invite.email,
      inviterName,
      roleName: invite.role?.name ?? undefined,
      token: invite.token,
    });
    emailSent = true;
  } catch (err) {
    console.error("[invites/resend] email failed:", err);
    emailErrorCode = classifyInviteEmailError(err);
  }

  return NextResponse.json({
    emailSent,
    email: invite.email,
    ...(emailErrorCode !== undefined && !emailSent ? { emailErrorCode } : {}),
  });
}
