import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { revalidateProjectsList, revalidateTicketsList } from "@/lib/list-cache";
import { getSessionContext } from "@/lib/session-context";
import { canManageTeamProjects } from "@/lib/project-management-server";
import { ensureUniqueKeyPrefix, suggestKeyPrefixFromName } from "@/lib/project-key-prefix";
import { resolveTeamContext } from "@/lib/team-context";
import { PERMISSIONS } from "@/lib/permissions-core";
import type { TicketStatus } from "@/components/tickets/ticket-types";

const ALL_STATUSES: TicketStatus[] = [
  "BACKLOG",
  "READY",
  "IN_PROGRESS",
  "FOR_REVIEW",
  "RESOLVED",
  "TO_BE_DEPLOYED",
  "DONE",
  "ARCHIVED",
];

function statusBreakdownFromGroups(
  groups: Array<{ status: string; _count: { _all: number } }>
): { status: TicketStatus; count: number }[] {
  const counts = new Map<TicketStatus, number>();
  for (const g of groups) {
    counts.set(g.status as TicketStatus, g._count._all);
  }
  return ALL_STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 })).filter((x) => x.count > 0);
}

const createProjectSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  description: z.string().max(4000).optional().nullable(),
  ticketKeyPrefix: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Z0-9]+$/i)
    .transform((s) => s.toUpperCase())
    .optional(),
  teamId: z.string().min(1).optional(),
});

export async function GET(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teamParam = req.nextUrl.searchParams.get("team");
  const teamCtx = await resolveTeamContext(
    ctx.user.id,
    ctx.user.specialPermissions,
    teamParam
  );

  const isSuperAdmin = ctx.user.specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS);
  if (!teamCtx && !isSuperAdmin) {
    return NextResponse.json(
      { projects: [], unassigned: { statusBreakdown: [] } },
      { headers: { "Cache-Control": "no-store, must-revalidate" } }
    );
  }

  /** Read projects live — do not use `unstable_cache` here; tag revalidation is not always visible on the very next request. */
  const projects = await db.project.findMany({
    where: teamCtx ? { teamId: teamCtx.teamId } : undefined,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      ticketKeyPrefix: true,
      teamId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const projectIds = projects.map((p) => p.id);

  const [byProjectIdStatus, unassignedByStatus] = await Promise.all([
    projectIds.length
      ? db.ticket.groupBy({
          by: ["projectId", "status"],
          where: { projectId: { in: projectIds } },
          _count: { _all: true },
        })
      : Promise.resolve(
          [] as Array<{
            projectId: string;
            status: string;
            _count: { _all: number };
          }>
        ),
    db.ticket.groupBy({
      by: ["status"],
      where: {
        projectId: null,
        ...(teamCtx
          ? { user: { teamMemberships: { some: { teamId: teamCtx.teamId } } } }
          : {}),
      },
      _count: { _all: true },
    }),
  ]);

  const groupsByProject = new Map<string, Array<{ status: string; _count: { _all: number } }>>();
  for (const row of byProjectIdStatus) {
    if (!row.projectId) continue;
    const list = groupsByProject.get(row.projectId) ?? [];
    list.push({ status: row.status, _count: row._count });
    groupsByProject.set(row.projectId, list);
  }

  const projectsOut = projects.map((p) => ({
    ...p,
    statusBreakdown: statusBreakdownFromGroups(groupsByProject.get(p.id) ?? []),
  }));

  return NextResponse.json(
    {
      projects: projectsOut,
      unassigned: { statusBreakdown: statusBreakdownFromGroups(unassignedByStatus) },
    },
    {
      headers: {
        "Cache-Control": "no-store, must-revalidate",
      },
    }
  );
}

export async function POST(req: NextRequest) {
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

  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const { name, description, ticketKeyPrefix: rawPrefix, teamId: bodyTeamId } = parsed.data;
  const basePrefix = rawPrefix ?? suggestKeyPrefixFromName(name);
  const ticketKeyPrefix = await ensureUniqueKeyPrefix(basePrefix, null);

  // Resolve which team this project belongs to
  const teamParam = bodyTeamId ?? req.nextUrl.searchParams.get("team");
  const teamCtx = await resolveTeamContext(
    ctx.user.id,
    ctx.user.specialPermissions,
    teamParam
  );
  if (!teamCtx) {
    return NextResponse.json({ error: "No team context — provide a team parameter or ensure you are a team member" }, { status: 400 });
  }

  const canManage = await canManageTeamProjects(
    ctx.user.id,
    ctx.user.role,
    ctx.user.specialPermissions,
    teamCtx.teamId
  );
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const project = await db.project.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        ticketKeyPrefix,
        teamId: teamCtx.teamId,
      },
      select: {
        id: true,
        name: true,
        description: true,
        ticketKeyPrefix: true,
        teamId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    revalidateProjectsList();
    revalidateTicketsList();
    return NextResponse.json(project, { status: 201 });
  } catch (e: unknown) {
    const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: string }).code) : "";
    if (code === "P2002") {
      return NextResponse.json({ error: "A project with this name already exists" }, { status: 409 });
    }
    throw e;
  }
}
