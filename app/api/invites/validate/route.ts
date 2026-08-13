import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/** GET /api/invites/validate?token= — public; returns masked email if valid */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim();
  if (!token) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }

  const invite = await db.invite.findUnique({
    where: { token },
    include: { role: { select: { name: true } } },
  });

  if (!invite) {
    return NextResponse.json({ valid: false }, { status: 404 });
  }

  if (invite.acceptedAt) {
    return NextResponse.json({ valid: false, reason: "used" }, { status: 410 });
  }

  if (invite.expiresAt < new Date()) {
    return NextResponse.json({ valid: false, reason: "expired" }, { status: 410 });
  }

  const at = invite.email.indexOf("@");
  const masked =
    at <= 1 ? "***" : `${invite.email[0]}***${invite.email.slice(at)}`;

  return NextResponse.json({
    valid: true,
    emailMasked: masked,
    roleName: invite.role.name,
  });
}
