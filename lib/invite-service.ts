import { db } from "@/lib/db";
import { buildInviteAcceptUrl, sendInviteEmail } from "@/lib/email";

export type InviteEmailErrorCode = "SMTP_CONNECTION" | "RESEND_CONFIG" | "UNKNOWN";

export function classifyInviteEmailError(error: unknown): InviteEmailErrorCode {
  if (error instanceof Error) {
    const m = error.message.toLowerCase();
    if (
      m.includes("econnrefused") ||
      m.includes("etimedout") ||
      m.includes("connect") ||
      m.includes("socket") ||
      m.includes("getaddrinfo")
    ) {
      return "SMTP_CONNECTION";
    }
    if (
      m.includes("resend") ||
      m.includes("failed to send email") ||
      m.includes("domain") ||
      m.includes("not configured")
    ) {
      return "RESEND_CONFIG";
    }
  }
  return "UNKNOWN";
}

export function getInviteAppBaseUrl(): string {
  return (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3003").replace(
    /\/$/,
    ""
  );
}

export interface InviteCreatedPayload {
  invite: {
    id: string;
    email: string;
    token: string;
    expiresAt: string;
  };
  inviteLink: string;
  emailSent: boolean;
  emailErrorCode?: InviteEmailErrorCode;
}

export type CreateSingleInviteResult =
  | ({ success: true } & InviteCreatedPayload)
  | {
      success: false;
      error: string;
      errorKind: "USER_EXISTS" | "DUPLICATE_INVITE";
    };

export interface TeamAssignment {
  teamId: string;
  teamRole: "ADMIN" | "MEMBER";
}

/**
 * Create a pending invite and attempt to email the link. Caller must enforce admin auth.
 * Optionally pass teamAssignments to enrol the new user in multiple teams on accept.
 * Pass grantAllTeams=true to automatically grant the accepted user the access:all_teams permission.
 */
export async function createSingleInvite(
  emailNormalized: string,
  roleId: string,
  sentByUserId: string,
  teamAssignments?: TeamAssignment[],
  grantAllTeams?: boolean
): Promise<CreateSingleInviteResult> {
  const existingUser = await db.user.findUnique({ where: { email: emailNormalized } });
  if (existingUser) {
    return {
      success: false,
      error: "A user with this email already exists",
      errorKind: "USER_EXISTS",
    };
  }

  const duplicate = await db.invite.findFirst({
    where: {
      email: emailNormalized,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (duplicate) {
    return {
      success: false,
      error: "An active invite for this email already exists",
      errorKind: "DUPLICATE_INVITE",
    };
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const invite = await db.invite.create({
    data: {
      email: emailNormalized,
      roleId,
      expiresAt,
      sentById: sentByUserId,
      grantAllTeams: grantAllTeams === true,
      ...(teamAssignments && teamAssignments.length > 0
        ? {
            inviteTeams: {
              create: teamAssignments.map((ta) => ({
                teamId: ta.teamId,
                teamRole: ta.teamRole,
              })),
            },
          }
        : {}),
    },
    include: {
      role: { select: { name: true } },
    },
  });

  const inviter = await db.user.findUnique({
    where: { id: sentByUserId },
    select: { name: true, email: true },
  });
  const inviterName = inviter?.name ?? inviter?.email ?? "Administrator";

  const baseUrl = getInviteAppBaseUrl();
  const inviteLink = buildInviteAcceptUrl(baseUrl, invite.token);

  let emailSent = false;
  let emailErrorCode: InviteEmailErrorCode | undefined;
  try {
    await sendInviteEmail({
      to: emailNormalized,
      inviterName,
      roleName: invite.role?.name ?? undefined,
      token: invite.token,
    });
    emailSent = true;
  } catch (emailError) {
    console.error("[invite-service] Failed to send invite email (link still usable):", emailError);
    emailErrorCode = classifyInviteEmailError(emailError);
  }

  const payload: InviteCreatedPayload = {
    invite: {
      id: invite.id,
      email: invite.email,
      token: invite.token,
      expiresAt: invite.expiresAt.toISOString(),
    },
    inviteLink,
    emailSent,
  };
  if (!emailSent && emailErrorCode !== undefined) {
    payload.emailErrorCode = emailErrorCode;
  }
  return { success: true, ...payload };
}
