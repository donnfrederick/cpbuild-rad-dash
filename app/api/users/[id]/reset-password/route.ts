import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";

const RESET_TTL_HOURS = 24;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true } });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + RESET_TTL_HOURS * 60 * 60 * 1000);

  await db.user.update({
    where: { id },
    data: { passwordResetToken: token, passwordResetExpiresAt: expiresAt },
  });

  const baseUrl = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3003").replace(/\/$/, "");
  const resetLink = `${baseUrl}/en/reset-password?token=${token}`;

  return NextResponse.json({ resetLink, expiresAt: expiresAt.toISOString() });
}
