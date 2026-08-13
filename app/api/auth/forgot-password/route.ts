import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { db } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/email";
import { routing } from "@/i18n/routing";

const schema = z.object({
  email: z.string().email("Invalid email address"),
  locale: z.string().optional(),
});

const EXPIRY_MS = 60 * 60 * 1000; // 1 hour

export async function POST(req: NextRequest) {
  const body: unknown = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 422 });
  }

  const { email, locale } = parsed.data;

  // Always return 200 — never reveal whether the email exists
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { id: true, name: true },
  });

  if (user) {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + EXPIRY_MS);

    await db.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: token,
        passwordResetExpiresAt: expiresAt,
      },
    });

    await sendPasswordResetEmail({
      to: email,
      userName: user.name,
      token,
      locale: locale ?? routing.defaultLocale,
    }).catch((err: unknown) => {
      console.error("[forgot-password] Failed to send reset email:", err);
    });
  }

  return NextResponse.json({
    message: "If an account exists for that email, a reset link has been sent.",
  });
}
