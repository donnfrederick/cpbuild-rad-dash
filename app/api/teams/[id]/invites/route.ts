import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { PERMISSIONS } from "@/lib/permissions-core";
import {
  createSingleInvite,
  classifyInviteEmailError,
  getInviteAppBaseUrl,
} from "@/lib/invite-service";
import { buildInviteAcceptUrl } from "@/lib/email";

type RouteContext = { params: Promise<{ id: string }> };

async function canManageTeam(
  callerId: string,
  specialPermissions: string[],
  teamId: string
): Promise<boolean> {
  if (specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS)) return true;
  const m = await db.teamMembership.findUnique({
    where: { userId_teamId: { userId: callerId, teamId } },
    select: { teamRole: true },
  });
  return m?.teamRole === "ADMIN";
}

const teamInviteSchema = z.object({
  email: z.string().email("Invalid email address"),
  roleId: z.string().min(1, "Role is required"),
  teamRole: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});

/**
 * POST /api/teams/[id]/invites — invite a user to a specific team.
 * Creates the invite with teamId and teamRole set so that on acceptance
 * the user is automatically enrolled in this team.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: teamId } = await ctx.params;

  const ok = await canManageTeam(session.user.id, session.user.specialPermissions, teamId);
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const team = await db.team.findUnique({
    where: { id: teamId },
    select: { id: true, name: true },
  });
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const isSuperAdmin = session.user.specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS);

  const parsed = teamInviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  // Non-super-admins can only invite members, never admins
  if (!isSuperAdmin) {
    const role = await db.role.findUnique({
      where: { id: parsed.data.roleId },
      select: { code: true },
    });
    if (role?.code === "ADMIN") {
      return NextResponse.json(
        { error: "Team admins can only invite users with the Member app role" },
        { status: 403 }
      );
    }
  }

  const effectiveTeamRole = isSuperAdmin ? parsed.data.teamRole : "MEMBER";

  const email = parsed.data.email.trim().toLowerCase();

  // Check if the user already exists — if so, just add them as a member directly
  const existingUser = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) {
    const alreadyMember = await db.teamMembership.findUnique({
      where: { userId_teamId: { userId: existingUser.id, teamId } },
      select: { teamId: true },
    });
    if (alreadyMember) {
      return NextResponse.json({ error: "User is already a member of this team" }, { status: 409 });
    }
    await db.teamMembership.create({
      data: { userId: existingUser.id, teamId, teamRole: effectiveTeamRole },
    });
    return NextResponse.json({ added: true, existingUser: true }, { status: 201 });
  }

  // New user — create a standard invite with team context embedded
  const duplicateInvite = await db.invite.findFirst({
    where: {
      email,
      teamId,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (duplicateInvite) {
    return NextResponse.json(
      { error: "An active team invite for this email already exists" },
      { status: 409 }
    );
  }

  const role = await db.role.findUnique({
    where: { id: parsed.data.roleId },
    select: { id: true, name: true },
  });
  if (!role) {
    return NextResponse.json({ error: "Role not found" }, { status: 404 });
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const invite = await db.invite.create({
    data: {
      email,
      roleId: parsed.data.roleId,
      expiresAt,
      sentById: session.user.id,
      teamId,
      teamRole: effectiveTeamRole,
    },
    select: { id: true, token: true, email: true, expiresAt: true },
  });

  const baseUrl = getInviteAppBaseUrl();
  const inviteLink = buildInviteAcceptUrl(baseUrl, invite.token);

  // Attempt email — non-fatal
  let emailSent = false;
  let emailErrorCode: string | undefined;
  try {
    const { sendInviteEmail } = await import("@/lib/email");
    await sendInviteEmail({
      to: email,
      inviterName: session.user.name ?? session.user.email ?? "Administrator",
      roleName: role.name,
      token: invite.token,
    });
    emailSent = true;
  } catch (err) {
    emailErrorCode = classifyInviteEmailError(err);
  }

  return NextResponse.json(
    {
      invite: {
        id: invite.id,
        email: invite.email,
        token: invite.token,
        expiresAt: invite.expiresAt.toISOString(),
      },
      inviteLink,
      emailSent,
      ...(emailErrorCode !== undefined ? { emailErrorCode } : {}),
    },
    { status: 201 }
  );
}
