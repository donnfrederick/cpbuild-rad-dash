import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { revalidateTicketsList } from "@/lib/list-cache";
import { mapSprintRowToApi, sprintApiSelect } from "@/lib/sprint-map";
import { parseSprintDateInput } from "@/lib/sprint-parse";
import { getSessionContext } from "@/lib/session-context";
import { resolveAccessibleTeamIds } from "@/lib/team-context";
import { hasTicketTriageAccess } from "@/lib/ticket-access";

const patchSprintSchema = z
  .object({
    name: z.string().min(1).max(120).trim().optional(),
    projectIds: z.array(z.string().min(1)).optional(),
    startDate: z.preprocess((v) => (v === "" ? null : v), z.union([z.string().max(40), z.null()]).optional()),
    endDate: z.preprocess((v) => (v === "" ? null : v), z.union([z.string().max(40), z.null()]).optional()),
    maxManSprints: z.union([z.number().int().min(0).max(99999), z.null()]).optional(),
    daysOff: z.number().int().min(0).max(366).optional(),
    carryOverPoints: z.union([z.number().int().min(0).max(9999999), z.null()]).optional(),
    pointsPlanned: z.union([z.number().int().min(0).max(9999999), z.null()]).optional(),
    goals: z.union([z.string().max(8000), z.null()]).optional(),
  })
  .refine(
    (b) =>
      b.name !== undefined ||
      b.projectIds !== undefined ||
      b.startDate !== undefined ||
      b.endDate !== undefined ||
      b.maxManSprints !== undefined ||
      b.daysOff !== undefined ||
      b.carryOverPoints !== undefined ||
      b.pointsPlanned !== undefined ||
      b.goals !== undefined,
    { message: "Provide at least one field to update" }
  );

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  try {
    const sprint = await db.sprint.findUnique({
      where: { id },
      select: { ...sprintApiSelect(), teamId: true },
    });
    if (!sprint) {
      return NextResponse.json({ error: "Sprint not found" }, { status: 404 });
    }
    const teamIds = await resolveAccessibleTeamIds(session.user.id, session.user.specialPermissions);
    if (!teamIds.includes(sprint.teamId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json(mapSprintRowToApi(sprint));
  } catch (e: unknown) {
    console.error("[api/sprints/[id] GET]", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof Prisma.PrismaClientValidationError && /Unknown field/i.test(msg)) {
      return NextResponse.json(
        {
          error:
            "Prisma Client is out of date (it does not match this app’s schema — common after git pull). Run: npx prisma generate — then stop and restart npm run dev. If the DB is missing new columns, also run: npx prisma migrate deploy",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        error: "Could not load sprint",
        detail: process.env.NODE_ENV === "development" ? msg.slice(0, 400) : undefined,
      },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasTicketTriageAccess(session.user.role, session.user.specialPermissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSprintSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await db.sprint.findUnique({
    where: { id },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      completedAt: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Sprint not found" }, { status: 404 });
  }
  if (existing.completedAt) {
    return NextResponse.json({ error: "Cannot edit a completed sprint" }, { status: 400 });
  }

  const d = parsed.data;

  let nextStart = existing.startDate;
  if (d.startDate !== undefined) {
    if (d.startDate === null) {
      nextStart = null;
    } else {
      const parsedStart = parseSprintDateInput(d.startDate);
      if (parsedStart === null) {
        return NextResponse.json({ error: "Invalid start date" }, { status: 400 });
      }
      nextStart = parsedStart;
    }
  }

  let nextEnd = existing.endDate;
  if (d.endDate !== undefined) {
    if (d.endDate === null) {
      nextEnd = null;
    } else {
      const parsedEnd = parseSprintDateInput(d.endDate);
      if (parsedEnd === null) {
        return NextResponse.json({ error: "Invalid end date" }, { status: 400 });
      }
      nextEnd = parsedEnd;
    }
  }

  if (nextStart && nextEnd && nextEnd < nextStart) {
    return NextResponse.json({ error: "End date must be on or after start date" }, { status: 400 });
  }

  if (d.projectIds !== undefined) {
    const uniqueIds = [...new Set(d.projectIds)];
    if (uniqueIds.length > 0) {
      const found = await db.project.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true },
      });
      if (found.length !== uniqueIds.length) {
        return NextResponse.json({ error: "One or more projects were not found" }, { status: 400 });
      }
    }
    await db.$transaction([
      db.sprintProject.deleteMany({ where: { sprintId: id } }),
      ...(uniqueIds.length > 0
        ? [
            db.sprintProject.createMany({
              data: uniqueIds.map((projectId) => ({ sprintId: id, projectId })),
            }),
          ]
        : []),
    ]);
  }

  const updateData: {
    name?: string;
    startDate?: Date | null;
    endDate?: Date | null;
    maxManSprints?: number | null;
    daysOff?: number;
    carryOverPoints?: number | null;
    pointsPlanned?: number | null;
    goals?: string | null;
  } = {};

  if (d.name !== undefined) updateData.name = d.name.trim();
  if (d.startDate !== undefined) updateData.startDate = nextStart;
  if (d.endDate !== undefined) updateData.endDate = nextEnd;
  if (d.maxManSprints !== undefined) updateData.maxManSprints = d.maxManSprints;
  if (d.daysOff !== undefined) updateData.daysOff = d.daysOff;
  if (d.carryOverPoints !== undefined) updateData.carryOverPoints = d.carryOverPoints;
  if (d.pointsPlanned !== undefined) updateData.pointsPlanned = d.pointsPlanned;
  if (d.goals !== undefined) {
    updateData.goals =
      d.goals === null ? null : d.goals.trim() === "" ? null : d.goals.trim();
  }

  if (Object.keys(updateData).length > 0) {
    await db.sprint.update({
      where: { id },
      data: updateData,
    });
  }

  revalidateTicketsList();

  const updated = await db.sprint.findUniqueOrThrow({
    where: { id },
    select: sprintApiSelect(),
  });
  return NextResponse.json(mapSprintRowToApi(updated));
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasTicketTriageAccess(session.user.role, session.user.specialPermissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;

  try {
    await db.sprint.delete({ where: { id } });
  } catch {
    return NextResponse.json({ error: "Sprint not found" }, { status: 404 });
  }

  revalidateTicketsList();
  return NextResponse.json({ ok: true });
}
