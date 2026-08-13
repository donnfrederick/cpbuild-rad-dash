import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { revalidateTicketsList } from "@/lib/list-cache";
import { mapSprintRowToApi, sprintApiSelect } from "@/lib/sprint-map";
import { parseSprintDateInput } from "@/lib/sprint-parse";
import { getSessionContext } from "@/lib/session-context";
import { hasTicketTriageAccess } from "@/lib/ticket-access";
import { resolveTeamContext } from "@/lib/team-context";
import { PERMISSIONS } from "@/lib/permissions-core";

/** Avoid stale empty responses when sprint data changes (Next may cache GET handlers). */
export const dynamic = "force-dynamic";

const createSprintSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  /** Optional: link projects to this sprint (for legacy implicit-scope boards or bulk reference). */
  projectIds: z.array(z.string().min(1)).optional(),
  startDate: z.preprocess((v) => (v === "" ? null : v), z.union([z.string().max(40), z.null()]).optional()),
  endDate: z.preprocess((v) => (v === "" ? null : v), z.union([z.string().max(40), z.null()]).optional()),
  maxManSprints: z.union([z.number().int().min(0).max(99999), z.null()]).optional(),
  daysOff: z.number().int().min(0).max(366).optional(),
  carryOverPoints: z.union([z.number().int().min(0).max(9999999), z.null()]).optional(),
  pointsPlanned: z.union([z.number().int().min(0).max(9999999), z.null()]).optional(),
  goals: z.union([z.string().max(8000), z.null()]).optional(),
  /** Tickets to include in the sprint. Can belong to any project (or none). */
  ticketIds: z.array(z.string().min(1)).max(10000).optional(),
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
    return NextResponse.json({ sprints: [] });
  }

  try {
    const rows = await db.sprint.findMany({
      where: teamCtx ? { teamId: teamCtx.teamId } : undefined,
      orderBy: { updatedAt: "desc" },
      select: sprintApiSelect(),
    });
    return NextResponse.json({ sprints: rows.map(mapSprintRowToApi) });
  } catch (e: unknown) {
    console.error("[api/sprints GET]", e);
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2021") {
      return NextResponse.json(
        {
          sprints: [],
          error:
            "Sprint tables are missing. Run: npx prisma migrate dev (or migrate deploy in production).",
        },
        { status: 503 }
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof Prisma.PrismaClientValidationError && /Unknown field/i.test(msg)) {
      return NextResponse.json(
        {
          sprints: [],
          error:
            "Prisma Client is out of date (it does not match this app's schema — common after git pull). Run: npx prisma generate — then stop and restart npm run dev. If the DB is missing new columns, also run: npx prisma migrate deploy",
        },
        { status: 503 }
      );
    }
    const schemaDrift =
      /column .* does not exist|does not exist.*column|42703|sprint.*goals|P2022/i.test(msg);
    if (schemaDrift) {
      return NextResponse.json(
        {
          sprints: [],
          error:
            "Sprint database columns are out of date (for example after a code update). Run: npx prisma migrate deploy — then restart the Next.js dev server.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        error: "Could not load sprints",
        detail: process.env.NODE_ENV === "development" ? msg.slice(0, 400) : undefined,
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasTicketTriageAccess(ctx.user.role, ctx.user.specialPermissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSprintSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const { name, projectIds } = parsed.data;
  const uniqueIds = projectIds && projectIds.length > 0 ? [...new Set(projectIds)] : [];

  const startRaw = parsed.data.startDate;
  const endRaw = parsed.data.endDate;
  const startDate = parseSprintDateInput(startRaw);
  const endDate = parseSprintDateInput(endRaw);
  if (startRaw != null && startRaw !== "" && startDate === null) {
    return NextResponse.json({ error: "Invalid start date" }, { status: 400 });
  }
  if (endRaw != null && endRaw !== "" && endDate === null) {
    return NextResponse.json({ error: "Invalid end date" }, { status: 400 });
  }
  if (startDate && endDate && endDate < startDate) {
    return NextResponse.json({ error: "End date must be on or after start date" }, { status: 400 });
  }

  // Resolve team context
  const teamParam = parsed.data.teamId ?? req.nextUrl.searchParams.get("team");
  const teamCtx = await resolveTeamContext(
    ctx.user.id,
    ctx.user.specialPermissions,
    teamParam
  );
  if (!teamCtx) {
    return NextResponse.json({ error: "No team context — provide a team parameter or ensure you are a team member" }, { status: 400 });
  }

  if (uniqueIds.length > 0) {
    const found = await db.project.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true },
    });
    if (found.length !== uniqueIds.length) {
      return NextResponse.json({ error: "One or more projects were not found" }, { status: 400 });
    }
  }

  const rawTicketIds = parsed.data.ticketIds;
  const ticketIdsUnique =
    rawTicketIds && rawTicketIds.length > 0 ? [...new Set(rawTicketIds)] : null;
  if (ticketIdsUnique && ticketIdsUnique.length > 0) {
    const found = await db.ticket.findMany({
      where: { id: { in: ticketIdsUnique } },
      select: { id: true },
    });
    if (found.length !== ticketIdsUnique.length) {
      return NextResponse.json({ error: "One or more tickets were not found" }, { status: 400 });
    }
  }

  try {
    const created = await db.sprint.create({
      data: {
        name: name.trim(),
        teamId: teamCtx.teamId,
        startDate,
        endDate,
        maxManSprints: parsed.data.maxManSprints ?? null,
        daysOff: parsed.data.daysOff ?? 0,
        carryOverPoints: parsed.data.carryOverPoints ?? null,
        pointsPlanned: parsed.data.pointsPlanned ?? null,
        goals:
          parsed.data.goals === undefined
            ? null
            : parsed.data.goals === null
              ? null
              : parsed.data.goals.trim() === ""
                ? null
                : parsed.data.goals.trim(),
      },
      select: { id: true },
    });
    if (uniqueIds.length > 0) {
      await db.sprintProject.createMany({
        data: uniqueIds.map((projectId) => ({ sprintId: created.id, projectId })),
      });
    }
    if (ticketIdsUnique && ticketIdsUnique.length > 0) {
      await db.sprintTicket.createMany({
        data: ticketIdsUnique.map((ticketId) => ({ sprintId: created.id, ticketId })),
        skipDuplicates: true,
      });
    }
    const sprint = await db.sprint.findUniqueOrThrow({
      where: { id: created.id },
      select: sprintApiSelect(),
    });
    try {
      revalidateTicketsList();
    } catch (revErr: unknown) {
      console.error("[api/sprints POST] revalidateTicketsList", revErr);
    }
    return NextResponse.json(mapSprintRowToApi(sprint), { status: 201 });
  } catch (e: unknown) {
    console.error("[api/sprints POST]", e);
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2021") {
        return NextResponse.json(
          {
            error:
              "Sprint tables are missing in the database. From the project root run: npx prisma migrate dev (or prisma migrate deploy in production).",
          },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: `Database error (${e.code}): ${e.message}` },
        { status: 500 }
      );
    }
    if (e instanceof Prisma.PrismaClientValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof Error) {
      const msg = e.message.trim();
      const missingRelation =
        /does not exist|relation.*does not exist|no such table/i.test(msg);
      if (missingRelation) {
        return NextResponse.json(
          {
            error:
              "Sprint database objects are missing or out of date. Run: npx prisma migrate dev",
          },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: msg.length > 500 ? `${msg.slice(0, 500)}…` : msg },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: "Could not create sprint" }, { status: 500 });
  }
}
