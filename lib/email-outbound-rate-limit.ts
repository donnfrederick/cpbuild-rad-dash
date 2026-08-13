/**
 * In-memory sliding-window limits for outbound transactional email.
 *
 * **Per Node process** — multi-instance deployments each hold separate counters
 * until Redis / Upstash (or edge rate limiting) is added. Same caveat as
 * `lib/field-media-upload-rate-limit.ts`.
 */

import { createHash } from "node:crypto";
import { getClientIpFromHeaders } from "@/lib/request-client-ip";

const emailOutboundWindows = new Map<string, number[]>();

export type EmailOutboundDenied = { ok: false; count: number; limit: number };
export type EmailOutboundOk = { ok: true };

/** Max @mention email recipients processed in one request (notifications + mail aligned). */
export const MAX_MENTION_EMAIL_RECIPIENTS_PER_REQUEST = 25;

/** Where @mention broadcast was capped — used in `[email_security]` logs. */
export type MentionEmailSecuritySource =
  | "issue_comment"
  | "issue_notes"
  | "observation_comment"
  | "feedback_comment"
  | "feedback_comment_patch"
  | "feedback_internal_comment";

export type MentionRecipientCapLogContext = {
  source: MentionEmailSecuritySource;
  actorUserId: string;
  projectId?: string;
  feedbackId?: string;
  issueId?: string;
  observationId?: string;
};

export function capMentionIdsForBroadcast(ids: string[], logCtx?: MentionRecipientCapLogContext): string[] {
  if (ids.length <= MAX_MENTION_EMAIL_RECIPIENTS_PER_REQUEST) return ids;
  if (logCtx) {
    logEmailSecurityEvent({
      event: "mention_email_recipients_truncated",
      source: logCtx.source,
      actorUserIdHash: hashForEmailSecurityLog(logCtx.actorUserId),
      projectId: logCtx.projectId,
      feedbackId: logCtx.feedbackId,
      issueId: logCtx.issueId,
      observationId: logCtx.observationId,
      requestedCount: ids.length,
      limit: MAX_MENTION_EMAIL_RECIPIENTS_PER_REQUEST,
    });
  }
  return ids.slice(0, MAX_MENTION_EMAIL_RECIPIENTS_PER_REQUEST);
}

/** When @mention email sliding window denies the batch (abuse / burst). */
export function logMentionEmailActorThrottled(
  source: MentionEmailSecuritySource,
  details: {
    actorUserId: string;
    denied: EmailOutboundDenied;
    projectId?: string;
    feedbackId?: string;
    issueId?: string;
    observationId?: string;
  }
): void {
  logEmailSecurityEvent({
    event: "mention_email_actor_throttled",
    source,
    actorUserIdHash: hashForEmailSecurityLog(details.actorUserId),
    projectId: details.projectId,
    feedbackId: details.feedbackId,
    issueId: details.issueId,
    observationId: details.observationId,
    count: details.denied.count,
    limit: details.denied.limit,
  });
}

/** POST /api/auth/forgot-password — valid-body attempts per client IP per window. */
export const FORGOT_PASSWORD_IP_WINDOW_MS = 15 * 60 * 1000;
export const FORGOT_PASSWORD_IP_MAX = 20;

/** Invite create + resend emails per inviter per hour. */
export const INVITE_EMAIL_ACTOR_WINDOW_MS = 60 * 60 * 1000;
export const INVITE_EMAIL_ACTOR_MAX = 40;

/** Invite emails (create + resend) per recipient address per rolling day — anti-harassment / spam relay. */
export const INVITE_EMAIL_RECIPIENT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const INVITE_EMAIL_RECIPIENT_MAX = 10;

/**
 * Hard ceiling on all transactional sends in this Node process (every path that
 * calls SMTP/Resend in `lib/email.ts`). Catches bugs and coordinated multi-key abuse.
 */
export const GLOBAL_OUTBOUND_EMAIL_WINDOW_MS = 60 * 60 * 1000;
export const GLOBAL_OUTBOUND_EMAIL_MAX = 2500;

/** @mention notification emails per actor (1 min + 1 hour). */
const MENTION_EMAIL_ONE_MINUTE_MS = 60_000;
const MENTION_EMAIL_ONE_HOUR_MS = 60 * 60 * 1000;
export const MENTION_EMAIL_MAX_PER_MINUTE = 35;
export const MENTION_EMAIL_MAX_PER_HOUR = 100;

/** Feedback “new report” inbox notification per submitter per hour. */
export const FEEDBACK_NOTIFY_ACTOR_WINDOW_MS = 60 * 60 * 1000;
export const FEEDBACK_NOTIFY_ACTOR_MAX = 30;

/** DevTools test email per admin per hour. */
export const DEVTOOLS_TEST_EMAIL_WINDOW_MS = 60 * 60 * 1000;
export const DEVTOOLS_TEST_EMAIL_MAX = 5;

/**
 * Records one outbound-email slot for a scope key (single-window max).
 * On deny, nothing is recorded.
 */
export function tryRecordEmailOutbound(
  scopeKey: string,
  limits: { windowMs: number; max: number }
): EmailOutboundOk | EmailOutboundDenied {
  return tryRecordEmailOutboundBatch(scopeKey, 1, limits);
}

/**
 * Records `addCount` sends against one sliding window. On deny, nothing is recorded.
 */
export function tryRecordEmailOutboundBatch(
  scopeKey: string,
  addCount: number,
  limits: { windowMs: number; max: number }
): EmailOutboundOk | EmailOutboundDenied {
  if (addCount <= 0) return { ok: true };
  const now = Date.now();
  let stamps = emailOutboundWindows.get(scopeKey) ?? [];
  stamps = stamps.filter((t) => now - t < limits.windowMs);
  if (stamps.length + addCount > limits.max) {
    // Evict keys whose window is empty to prevent unbounded Map growth under
    // high-cardinality keys (e.g. per-recipient email scopes).
    if (stamps.length === 0) emailOutboundWindows.delete(scopeKey);
    return { ok: false, count: stamps.length, limit: limits.max };
  }
  for (let i = 0; i < addCount; i++) stamps.push(now);
  emailOutboundWindows.set(scopeKey, stamps);
  return { ok: true };
}

/**
 * Dual window for @mention emails: per-minute burst + per-hour sustained cap.
 * On deny, nothing is recorded.
 */
export function tryRecordMentionEmailBatch(
  actorUserId: string,
  emailRecipientCount: number
): EmailOutboundOk | EmailOutboundDenied {
  if (emailRecipientCount <= 0) return { ok: true };
  const key = `mention-email:${actorUserId}`;
  const now = Date.now();
  let stamps = emailOutboundWindows.get(key) ?? [];
  stamps = stamps.filter((t) => now - t < MENTION_EMAIL_ONE_HOUR_MS);
  if (stamps.length === 0) emailOutboundWindows.delete(key);
  const inLastMinute = stamps.filter((t) => now - t < MENTION_EMAIL_ONE_MINUTE_MS).length;
  if (inLastMinute + emailRecipientCount > MENTION_EMAIL_MAX_PER_MINUTE) {
    return { ok: false, count: inLastMinute, limit: MENTION_EMAIL_MAX_PER_MINUTE };
  }
  if (stamps.length + emailRecipientCount > MENTION_EMAIL_MAX_PER_HOUR) {
    return { ok: false, count: stamps.length, limit: MENTION_EMAIL_MAX_PER_HOUR };
  }
  for (let i = 0; i < emailRecipientCount; i++) stamps.push(now);
  emailOutboundWindows.set(key, stamps);
  return { ok: true };
}

export function forgotPasswordIpScopeKey(headers: Headers): string {
  return `forgot-password:ip:${getClientIpFromHeaders(headers)}`;
}

export function inviteActorScopeKey(actorUserId: string): string {
  return `invite-email:actor:${actorUserId}`;
}

/** Normalize invite target for storage + rate-limit keys (lowercase, trimmed). */
export function normalizedInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Sliding window per invitee email — shared by POST /api/invites and resend. */
export function inviteRecipientScopeKey(email: string): string {
  return `invite-email:recipient:${normalizedInviteEmail(email)}`;
}

/**
 * One slot toward the global per-process hourly cap. Call immediately before
 * each SMTP/Resend send in `lib/email.ts`.
 */
export function tryRecordGlobalOutboundEmailSend():
  | EmailOutboundOk
  | EmailOutboundDenied {
  return tryRecordEmailOutbound("global-outbound-email:process", {
    windowMs: GLOBAL_OUTBOUND_EMAIL_WINDOW_MS,
    max: GLOBAL_OUTBOUND_EMAIL_MAX,
  });
}

/** SHA-256 prefix for logging — never log raw IPs or emails in security lines. */
export function hashForEmailSecurityLog(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** Structured single-line warning for log aggregation (grep `[email_security]`). */
export function logEmailSecurityEvent(details: Record<string, unknown>): void {
  console.warn("[email_security]", JSON.stringify({ ...details, ts: new Date().toISOString() }));
}

export function feedbackNotifyActorScopeKey(actorUserId: string): string {
  return `feedback-notify:actor:${actorUserId}`;
}

export function devtoolsTestEmailActorScopeKey(actorUserId: string): string {
  return `devtools-test-email:actor:${actorUserId}`;
}

/** Test helper — clears all windows. */
export function resetEmailOutboundRateLimitForTests(): void {
  emailOutboundWindows.clear();
}
