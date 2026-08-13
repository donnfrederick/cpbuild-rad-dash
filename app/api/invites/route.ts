import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { createSingleInvite } from "@/lib/invite-service";
import { createInviteSchema } from "@/lib/validations/invite";

/** GET /api/invites — pending invites (ADMIN only) */
export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const invites = await db.invite.findMany({
    where: {
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      role: { select: { id: true, code: true, name: true } },
      sentBy: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      token: i.token,
      role: i.role,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
      sentBy: i.sentBy.name ?? i.sentBy.email ?? "—",
    })),
  });
}

/** POST /api/invites — create invite (ADMIN only) */
export async function POST(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body: unknown = await req.json();
  const parsed = createInviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const email = parsed.data.email.trim().toLowerCase();
  const result = await createSingleInvite(email, parsed.data.roleId, ctx.user.id);

  if (!result.success) {
    const status = result.errorKind === "USER_EXISTS" || result.errorKind === "DUPLICATE_INVITE" ? 409 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(
    {
      invite: result.invite,
      inviteLink: result.inviteLink,
      emailSent: result.emailSent,
      ...(result.emailErrorCode !== undefined ? { emailErrorCode: result.emailErrorCode } : {}),
    },
    { status: 201 }
  );
}
