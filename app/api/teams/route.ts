import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { PERMISSIONS } from "@/lib/permissions-core";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const createTeamSchema = z.object({
  name: z.string().min(1).max(80).trim(),
  slug: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "Slug may only contain lowercase letters, numbers, and hyphens")
    .optional(),
});

/** GET /api/teams — list teams the user is a member of (all teams for super admin). */
export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isSuperAdmin = ctx.user.specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS);

  const teams = await db.team.findMany({
    where: isSuperAdmin
      ? undefined
      : { memberships: { some: { userId: ctx.user.id } } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      createdAt: true,
      _count: { select: { memberships: true, projects: true } },
    },
  });

  return NextResponse.json({
    teams: teams.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      logoUrl: t.logoUrl ?? null,
      createdAt: t.createdAt.toISOString(),
      memberCount: t._count.memberships,
      projectCount: t._count.projects,
    })),
  });
}

/** POST /api/teams — create a new team (super admin only). */
export async function POST(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isSuperAdmin = ctx.user.specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS);
  if (!isSuperAdmin) {
    return NextResponse.json({ error: "Forbidden — requires access:all_teams permission" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createTeamSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { name } = parsed.data;
  const slug = parsed.data.slug ?? slugify(name);

  const BUILT_IN_TYPES = [
    { name: "Bug",                  key: "BUG",                  sortOrder: 0 },
    { name: "Feature Request",      key: "FEATURE_REQUEST",      sortOrder: 1 },
    { name: "Feedback",             key: "FEEDBACK",             sortOrder: 2 },
    { name: "Minor Enhancement",    key: "MINOR_ENHANCEMENT",    sortOrder: 3 },
    { name: "Regression",           key: "REGRESSION",           sortOrder: 4 },
    { name: "Security Improvement", key: "SECURITY_IMPROVEMENT", sortOrder: 5 },
  ] as const;

  const BUILT_IN_BOARD_STATUSES = [
    { key: "BACKLOG",        label: "Backlog",        isEnabled: true,  sortOrder: 0 },
    { key: "READY",          label: "Ready",          isEnabled: true,  sortOrder: 1 },
    { key: "IN_PROGRESS",    label: "In Progress",    isEnabled: true,  sortOrder: 2 },
    { key: "FOR_REVIEW",     label: "For Review",     isEnabled: true,  sortOrder: 3 },
    { key: "RESOLVED",       label: "Resolved",       isEnabled: true,  sortOrder: 4 },
    { key: "TO_BE_DEPLOYED", label: "To Be Deployed", isEnabled: true,  sortOrder: 5 },
    { key: "DONE",           label: "Done",           isEnabled: true,  sortOrder: 6 },
    { key: "ARCHIVED",       label: "Archived",       isEnabled: false, sortOrder: 7 },
  ] as const;

  try {
    const team = await db.team.create({
      data: {
        name,
        slug,
        ticketTypes: {
          create: BUILT_IN_TYPES.map((bt) => ({
            name: bt.name,
            key: bt.key,
            isBuiltIn: true,
            isEnabled: true,
            sortOrder: bt.sortOrder,
          })),
        },
        boardStatuses: {
          create: BUILT_IN_BOARD_STATUSES.map((bs) => ({
            key: bs.key,
            label: bs.label,
            isBuiltIn: true,
            isEnabled: bs.isEnabled,
            sortOrder: bs.sortOrder,
          })),
        },
      },
      select: { id: true, name: true, slug: true, createdAt: true },
    });
    return NextResponse.json(
      { ...team, createdAt: team.createdAt.toISOString() },
      { status: 201 }
    );
  } catch (e: unknown) {
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? String((e as { code: string }).code)
        : "";
    if (code === "P2002") {
      return NextResponse.json(
        { error: "A team with that name or slug already exists" },
        { status: 409 }
      );
    }
    throw e;
  }
}
