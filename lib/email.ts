import { Resend } from "resend";
import nodemailer from "nodemailer";
import { routing } from "@/i18n/routing";
import { buildTicketDetailAppUrl } from "@/lib/ticket-urls";
import type { TicketTypeKind } from "@/components/tickets/ticket-types";

function ticketTypeEmailLabel(type: TicketTypeKind): string {
  switch (type) {
    case "BUG":
      return "Bug";
    case "FEEDBACK":
      return "Feedback";
    case "FEATURE_REQUEST":
      return "Feature request";
    case "MINOR_ENHANCEMENT":
      return "Minor enhancement";
    case "REGRESSION":
      return "Regression";
    case "SECURITY_IMPROVEMENT":
      return "Security improvement";
    default:
      return "Ticket";
  }
}

const APP_URL = (
  process.env.AUTH_URL ??
  process.env.NEXTAUTH_URL ??
  "http://localhost:3003"
).replace(/\/$/, "");

const FROM_EMAIL = process.env.EMAIL_FROM ?? "Tickets <onboarding@resend.dev>";

function esc(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** Exported for unit testing only. */
export function isNonProd(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.APP_ENV === "dev";
}

/** Exported for unit testing only. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/** Exported for unit testing only. */
export function resolveRecipient(to: string): string {
  const override = process.env.DEV_EMAIL_OVERRIDE;
  if (override && isNonProd()) {
    console.log(`[email] DEV_EMAIL_OVERRIDE: ${maskEmail(to)} → ${maskEmail(override)}`);
    return override;
  }
  return to;
}

// In development (SMTP_HOST set, or no valid Resend key), emails use nodemailer
// (e.g. Mailpit on localhost:1025). In production with a real Resend key, Resend is used.

/** Exported for unit testing only. */
export function isDevSmtpEnv(env: Readonly<Record<string, string | undefined>>): boolean {
  const hasSmtpHost = !!env.SMTP_HOST;
  const hasRealResendKey =
    !!env.RESEND_API_KEY && !env.RESEND_API_KEY.startsWith("re_YOUR");
  return hasSmtpHost || !hasRealResendKey;
}

function isDevSmtp(): boolean {
  return isDevSmtpEnv(process.env);
}

export interface EmailConfig {
  transport: "smtp" | "resend";
  resendKeySet: boolean;
  resendKeyValid: boolean;
  emailFromSet: boolean;
  smtpHostSet: boolean;
}

/** Pure helper for tests and diagnostics. */
export function computeEmailConfig(env: Readonly<Record<string, string | undefined>>): EmailConfig {
  const resendKey = env.RESEND_API_KEY;
  const hasSmtpHost = !!env.SMTP_HOST;
  const hasRealResendKey = !!resendKey && !resendKey.startsWith("re_YOUR");
  const transport: "smtp" | "resend" = hasSmtpHost || !hasRealResendKey ? "smtp" : "resend";

  return {
    transport,
    resendKeySet: !!resendKey,
    resendKeyValid: !!resendKey && !resendKey.startsWith("re_YOUR"),
    emailFromSet: !!env.EMAIL_FROM && env.EMAIL_FROM.length > 0,
    smtpHostSet: hasSmtpHost,
  };
}

async function sendViaSmtp(options: { to: string; subject: string; html: string }): Promise<void> {
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "localhost",
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: false,
    auth:
      process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
        : undefined,
    ignoreTLS: true,
  });

  const actualTo = resolveRecipient(options.to);
  const info = await transport.sendMail({
    from: FROM_EMAIL,
    to: actualTo,
    subject: options.subject,
    html: options.html,
  });

  console.log(
    `[email:dev] Sent to ${maskEmail(actualTo)} via SMTP (messageId: ${info.messageId})`
  );
  console.log(
    `[email:dev] View at http://localhost:${process.env.SMTP_UI_PORT ?? 8025}`
  );
}

async function sendViaResend(options: { to: string; subject: string; html: string }): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key || key.startsWith("re_YOUR")) {
    throw new Error("RESEND_API_KEY not configured");
  }
  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: resolveRecipient(options.to),
    subject: options.subject,
    html: options.html,
  });
  if (error) {
    const msg =
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : JSON.stringify(error);
    console.error("[email] Resend send failed:", error);
    throw new Error(`Failed to send email: ${msg}`);
  }
}

async function sendHtml(to: string, subject: string, html: string): Promise<void> {
  const resolvedSubject = isNonProd() ? `[DEV TEST] ${subject}` : subject;
  if (isDevSmtp()) {
    await sendViaSmtp({ to, subject: resolvedSubject, html });
  } else {
    await sendViaResend({ to, subject: resolvedSubject, html });
  }
}

export async function sendTicketSubmittedNotificationEmail(args: {
  submitterName: string | null;
  submitterEmail: string;
  type: TicketTypeKind;
  title: string;
  description: string;
  pageUrl: string | null;
  ticketId: string;
}): Promise<void> {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL ?? process.env.BOOTSTRAP_ADMIN_EMAIL;
  if (!adminEmail) {
    console.warn("[tickets] No ADMIN_NOTIFICATION_EMAIL — skipping submit notification email.");
    return;
  }
  const typeLabel = ticketTypeEmailLabel(args.type);
  const inboxUrl = `${APP_URL}/${routing.defaultLocale}/tickets`;
  const fromDisplay = args.submitterName
    ? `${esc(args.submitterName)} (${esc(args.submitterEmail)})`
    : esc(args.submitterEmail);
  const subject = `[Tickets] New ${typeLabel}: ${args.title.slice(0, 80)}`;
  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#111">
      <h2>${typeLabel}</h2>
      <p style="color:#666;font-size:14px">Submitted by ${fromDisplay}</p>
      ${args.pageUrl ? `<p><a href="${esc(args.pageUrl)}">${esc(args.pageUrl)}</a></p>` : ""}
      <pre style="white-space:pre-wrap;background:#f5f5f5;padding:12px;border-radius:6px">${esc(args.description)}</pre>
      <p><a href="${inboxUrl}" style="display:inline-block;background:#111;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px">Open inbox</a></p>
      <p style="color:#999;font-size:12px">Ticket id: ${esc(args.ticketId)}</p>
    </div>`;
  await sendHtml(adminEmail, subject, html);
}

export async function sendTicketStatusEmail(args: {
  to: string;
  userName: string | null;
  ticketTitle: string;
  ticketType: TicketTypeKind;
  newStatus: "IN_PROGRESS" | "RESOLVED" | "DONE";
  adminNote: string | null;
  ticketId: string;
}): Promise<void> {
  const statusLabel =
    args.newStatus === "IN_PROGRESS"
      ? "In progress"
      : args.newStatus === "DONE"
        ? "Done"
        : "Resolved";
  const dashboardUrl = `${APP_URL}/${routing.defaultLocale}/tickets`;
  const subject = `[Tickets] "${args.ticketTitle.slice(0, 60)}" is ${statusLabel}`;
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111">
      <p>${args.userName ? `Hi ${esc(args.userName)},` : "Hi,"}</p>
      <p>Your ticket was updated to <strong>${statusLabel}</strong>.</p>
      ${args.adminNote ? `<p>Note: ${esc(args.adminNote)}</p>` : ""}
      <p><a href="${dashboardUrl}">View tickets</a></p>
      <p style="color:#999;font-size:12px">${esc(args.ticketId)}</p>
    </div>`;
  await sendHtml(args.to, subject, html);
}

export async function sendTicketAssignedEmail(args: {
  to: string;
  assigneeName: string | null;
  assignerName: string;
  ticketTitle: string;
  ticketType: TicketTypeKind;
  ticketId: string;
  projectId?: string | null;
}): Promise<void> {
  const detailUrl = buildTicketDetailAppUrl(args.ticketId, args.projectId);
  const subject = `[Tickets] Assigned: ${args.ticketTitle.slice(0, 60)}`;
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111">
      <p>${args.assigneeName ? `Hi ${esc(args.assigneeName)},` : "Hi,"}</p>
      <p><strong>${esc(args.assignerName)}</strong> assigned you a ticket.</p>
      <p><a href="${detailUrl}">Open ticket</a></p>
      <p style="color:#999;font-size:12px">${esc(args.ticketId)}</p>
    </div>`;
  await sendHtml(args.to, subject, html);
}

export async function sendMentionEmail(args: {
  to: string;
  actorName: string;
  contextTitle: string;
  openUrl: string;
}): Promise<void> {
  const subject = `[Tickets] ${args.actorName} mentioned you`;
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111">
      <p><strong>${esc(args.actorName)}</strong> mentioned you:</p>
      <p style="background:#f5f5f5;padding:12px;border-radius:6px">${esc(args.contextTitle)}</p>
      <p><a href="${esc(args.openUrl)}">View thread</a></p>
    </div>`;
  await sendHtml(args.to, subject, html);
}

export async function sendPasswordResetEmail(args: {
  to: string;
  userName: string | null;
  token: string;
  locale?: string;
}): Promise<void> {
  const locale = args.locale ?? routing.defaultLocale;
  const resetUrl = `${APP_URL}/${locale}/reset-password?token=${encodeURIComponent(args.token)}`;
  const greeting = args.userName ? `Hi ${esc(args.userName)},` : "Hi,";
  const subject = "Reset your Rad Dash password";
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111">
      <p>${greeting}</p>
      <p>We received a request to reset your password. Click the button below to set a new one.</p>
      <p style="margin:24px 0">
        <a href="${esc(resetUrl)}" style="display:inline-block;background:#111;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:600">
          Reset password
        </a>
      </p>
      <p style="color:#666;font-size:13px">This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.</p>
      <p style="color:#999;font-size:12px">If the button doesn't work, copy and paste this link: ${esc(resetUrl)}</p>
    </div>`;
  await sendHtml(args.to, subject, html);
}

/** Public invite acceptance URL (token in query). */
export function buildInviteAcceptUrl(
  appUrl: string,
  token: string,
  locale: string = routing.defaultLocale
): string {
  const base = appUrl.replace(/\/$/, "");
  return `${base}/${locale}/invite/accept?token=${encodeURIComponent(token)}`;
}

export interface InviteEmailContent {
  subject: string;
  html: string;
}

export interface SendTestEmailResult {
  transport: "smtp" | "resend";
  messageId: string | undefined;
}

export function getEmailConfig(): EmailConfig {
  return computeEmailConfig(process.env);
}

export async function sendInviteEmail(args: {
  to: string;
  inviterName: string;
  roleName?: string;
  token: string;
}): Promise<void> {
  const linkHref = buildInviteAcceptUrl(APP_URL, args.token);
  const roleLine = args.roleName ? `<p>Role: <strong>${esc(args.roleName)}</strong></p>` : "";
  const subject = "You're invited to Tickets";
  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#111">
      <h2>Invitation</h2>
      <p><strong>${esc(args.inviterName)}</strong> invited you to join.</p>
      ${roleLine}
      <p style="margin:24px 0">
        <a href="${linkHref}"
           style="background:#1F3A5F;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600">
          Accept invitation
        </a>
      </p>
      <p style="color:#666;font-size:14px">This link expires in 7 days.</p>
      <p style="color:#999;font-size:12px">Or copy: ${linkHref}</p>
    </div>`;
  await sendHtml(args.to, subject, html);
}

export async function sendTestEmail(
  to: string
): Promise<{ transport: "smtp" | "resend"; messageId: string | undefined }> {
  const subject = "[RAD Dashboard] DevTools test email";
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111">
      <p>This is a test message from RAD Dashboard DevTools.</p>
      <p style="color:#999;font-size:12px">Sent at ${esc(new Date().toISOString())}</p>
    </div>`;

  if (isDevSmtp()) {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? "localhost",
      port: Number(process.env.SMTP_PORT ?? 1025),
      secure: false,
      auth:
        process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
          : undefined,
      ignoreTLS: true,
    });
    const actualTo = resolveRecipient(to);
    const info = await transport.sendMail({
      from: FROM_EMAIL,
      to: actualTo,
      subject,
      html,
    });
    console.log(
      `[email:dev] Test email to ${maskEmail(actualTo)} (messageId: ${info.messageId})`
    );
    console.log(
      `[email:dev] View at http://localhost:${process.env.SMTP_UI_PORT ?? 8025}`
    );
    return { transport: "smtp", messageId: info.messageId };
  }

  const key = process.env.RESEND_API_KEY;
  if (!key || key.startsWith("re_YOUR")) {
    throw new Error("RESEND_API_KEY not configured");
  }
  const resend = new Resend(key);
  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: resolveRecipient(to),
    subject,
    html,
  });
  if (error) {
    const msg =
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : JSON.stringify(error);
    throw new Error(`Failed to send test email: ${msg}`);
  }
  return { transport: "resend", messageId: data?.id };
}

/**
 * Renders invite email HTML for previews without sending.
 * In production (`nonProd === false`), `forceDevBanner` is ignored.
 */
export function buildInviteEmailContent(
  args: {
    to: string;
    inviterName: string;
    inviteeName?: string;
    roleName?: string;
    forceDevBanner?: boolean;
  },
  ctx: { nonProd: boolean; isRedirected: boolean }
): { subject: string; html: string } {
  const previewToken = "preview-token-not-valid";
  const linkHref = buildInviteAcceptUrl(APP_URL, previewToken);
  const roleLine = args.roleName ? `<p>Role: <strong>${esc(args.roleName)}</strong></p>` : "";
  const greeting =
    args.inviteeName != null && args.inviteeName.trim().length > 0
      ? `<p style="color:#666;font-size:14px">Hi ${esc(args.inviteeName.trim())},</p>`
      : "";

  const showDevBanner = ctx.nonProd && !!args.forceDevBanner;
  const devPreviewBanner = showDevBanner
    ? `<div style="background:#fef3c7;border:1px solid #f59e0b;padding:10px;margin:0 0 16px;border-radius:6px;font-size:13px;color:#92400e">
        <strong>Preview</strong> — Template shown for development. The accept link uses a placeholder token.
      </div>`
    : "";
  const redirectBanner =
    ctx.nonProd && ctx.isRedirected
      ? `<div style="background:#e0f2fe;border:1px solid #38bdf8;padding:10px;margin:0 0 16px;border-radius:6px;font-size:13px;color:#0c4a6e">
          In non-production, outgoing mail may be redirected via <code style="font-size:12px">DEV_EMAIL_OVERRIDE</code>.
        </div>`
      : "";

  const subject = "You're invited to Tickets";
  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#111">
      ${devPreviewBanner}
      ${redirectBanner}
      <h2>Invitation</h2>
      ${greeting}
      <p><strong>${esc(args.inviterName)}</strong> invited you to join.</p>
      ${roleLine}
      <p style="margin:24px 0">
        <a href="${linkHref}"
           style="background:#1F3A5F;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600">
          Accept invitation
        </a>
      </p>
      <p style="color:#666;font-size:14px">This link expires in 7 days.</p>
      <p style="color:#999;font-size:12px">Or copy: ${linkHref}</p>
    </div>`;

  return { subject, html };
}
