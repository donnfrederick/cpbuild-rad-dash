import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { PERMISSIONS } from "@/lib/permissions-core";

type RouteContext = { params: Promise<{ id: string }> };

async function resolveAccess(
  userId: string,
  specialPermissions: string[],
  teamId: string
): Promise<{ isMember: boolean; canManage: boolean }> {
  const isSuperAdmin = specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS);
  if (isSuperAdmin) return { isMember: true, canManage: true };

  const membership = await db.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { teamRole: true },
  });

  return {
    isMember: !!membership,
    canManage: membership?.teamRole === "ADMIN",
  };
}

const KEY_PATTERN = /^[A-Z0-9_]+$/;

function nameToKey(name: string): string {
  return name
    .toUpperCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_]/g, "");
}

const createTicketTypeSchema = z.object({
  name: z.string().min(1).max(60).trim(),
  key: z
    .string()
    .min(1)
    .max(60)
    .regex(KEY_PATTERN, "Key must be uppercase letters, digits, or underscores")
    .optional(),
});

/** GET /api/teams/[id]/ticket-types — list enabled ticket types for the team (any member) */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: teamId } = await ctx.params;

  const { isMember } = await resolveAccess(session.user.id, session.user.specialPermissions, teamId);
  if (!isMember) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const types = await db.teamTicketType.findMany({
    where: { teamId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      key: true,
      isBuiltIn: true,
      isEnabled: true,
      sortOrder: true,
    },
  });

  return NextResponse.json({ ticketTypes: types });
}

/** POST /api/teams/[id]/ticket-types — create a custom ticket type (team ADMIN only) */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: teamId } = await ctx.params;

  const { canManage } = await resolveAccess(session.user.id, session.user.specialPermissions, teamId);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createTicketTypeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const key = parsed.data.key ?? nameToKey(parsed.data.name);
  if (!key || !KEY_PATTERN.test(key)) {
    return NextResponse.json(
      { error: "Could not derive a valid key from the name. Please provide a key explicitly." },
      { status: 422 }
    );
  }

  const existing = await db.teamTicketType.findUnique({
    where: { teamId_key: { teamId, key } },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: `A ticket type with key "${key}" already exists for this team.` },
      { status: 409 }
    );
  }

  const maxOrder = await db.teamTicketType.aggregate({
    where: { teamId },
    _max: { sortOrder: true },
  });
  const sortOrder = (maxOrder._max.sortOrder ?? -1) + 1;

  const created = await db.teamTicketType.create({
    data: {
      teamId,
      name: parsed.data.name,
      key,
      isBuiltIn: false,
      isEnabled: true,
      sortOrder,
    },
    select: {
      id: true,
      name: true,
      key: true,
      isBuiltIn: true,
      isEnabled: true,
      sortOrder: true,
    },
  });

  return NextResponse.json({ ticketType: created }, { status: 201 });
}
