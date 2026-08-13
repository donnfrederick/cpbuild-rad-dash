import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";

/** GET /api/me — current user for client-rendered shells (session + DB role name). */
export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const row = await db.user.findUnique({
    where: { id: ctx.user.id },
    select: {
      name: true,
      email: true,
      status: true,
      role: { select: { code: true, name: true } },
      teamMemberships: {
        select: {
          teamId: true,
          teamRole: true,
          team: { select: { name: true, slug: true, logoUrl: true } },
        },
      },
    },
  });
  if (!row) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (row.status !== "ACTIVE") {
    return NextResponse.json(
      { error: "Unauthorized", reason: "account_inactive" as const },
      { status: 401 }
    );
  }

  return NextResponse.json({
    user: {
      id: ctx.user.id,
      email: row.email,
      name: row.name,
      role: row.role.code,
      roleNameFromDb: row.role.name,
      status: row.status,
      specialPermissions: ctx.user.specialPermissions,
      teamMemberships: row.teamMemberships.map((m) => ({
        teamId: m.teamId,
        teamName: m.team.name,
        teamSlug: m.team.slug,
        teamRole: m.teamRole,
        teamLogoUrl: m.team.logoUrl ?? null,
      })),
    },
  });
}

const patchSchema = z.object({
  name: z
    .string()
    .max(120)
    .transform((s) => {
      const t = s.trim();
      return t === "" ? null : t;
    }),
});

/** PATCH /api/me — update own display name (authenticated). */
export async function PATCH(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  await db.user.update({
    where: { id: ctx.user.id },
    data: { name: parsed.data.name },
  });

  return NextResponse.json({
    name: parsed.data.name,
    email: ctx.user.email,
    role: ctx.user.role,
  });
}
