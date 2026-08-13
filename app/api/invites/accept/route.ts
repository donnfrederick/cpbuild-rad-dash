import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { acceptInviteSchema } from "@/lib/validations/invite";

const SALT_ROUNDS = 12;

/** POST /api/invites/accept — public; create account from invite */
export async function POST(req: NextRequest) {
  const body: unknown = await req.json();
  const parsed = acceptInviteSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { token, name, password } = parsed.data;

  const invite = await db.invite.findUnique({
    where: { token },
    select: {
      id: true,
      email: true,
      roleId: true,
      acceptedAt: true,
      expiresAt: true,
      grantAllTeams: true,
      teamId: true,
      teamRole: true,
      inviteTeams: {
        select: { teamId: true, teamRole: true },
      },
      sentById: true,
    },
  });

  if (!invite) {
    return NextResponse.json({ error: "Invalid invite token" }, { status: 404 });
  }

  if (invite.acceptedAt) {
    return NextResponse.json({ error: "This invite has already been used" }, { status: 410 });
  }

  if (invite.expiresAt < new Date()) {
    return NextResponse.json({ error: "This invite has expired" }, { status: 410 });
  }

  const existingUser = await db.user.findUnique({ where: { email: invite.email } });
  if (existingUser) {
    return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  try {
    await db.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: invite.email,
          name,
          passwordHash,
          roleId: invite.roleId,
        },
        select: { id: true },
      });
      await tx.invite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
      // Enrol in teams from the multi-team invite_teams join table
      if (invite.inviteTeams.length > 0) {
        await tx.teamMembership.createMany({
          data: invite.inviteTeams.map((it) => ({
            userId: newUser.id,
            teamId: it.teamId,
            teamRole: it.teamRole,
          })),
          skipDuplicates: true,
        });
      } else if (invite.teamId) {
        // Legacy single-team invite (team-detail invite form)
        await tx.teamMembership.create({
          data: {
            userId: newUser.id,
            teamId: invite.teamId,
            teamRole: invite.teamRole ?? "MEMBER",
          },
        });
      }
      if (invite.grantAllTeams) {
        await tx.userSpecialPermission.create({
          data: {
            userId: newUser.id,
            permission: "access:all_teams",
            grantedById: invite.sentById,
            note: "Granted via super-admin invite",
          },
        });
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    console.error("[invites/accept]", err);
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }

  return NextResponse.json({ message: "Account created. You can now sign in." }, { status: 201 });
}
