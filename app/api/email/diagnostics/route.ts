import { NextResponse } from "next/server";
import { getEmailConfig } from "@/lib/email";
import { getSessionContext } from "@/lib/session-context";

/** GET /api/email/diagnostics — email transport summary for admins (no secrets). */
export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const config = getEmailConfig();
  const hint =
    config.transport === "smtp"
      ? "Mail is sent via SMTP (default localhost:1025). Start Mailpit or set SMTP_HOST / SMTP_PORT, or set a real RESEND_API_KEY + EMAIL_FROM for cloud delivery."
      : "Mail is sent via Resend. Use a verified domain in EMAIL_FROM (see Resend dashboard).";

  return NextResponse.json({ config, hint });
}
