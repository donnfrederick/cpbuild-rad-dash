import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { revalidateTicketsList } from "@/lib/list-cache";
import { getSessionContext } from "@/lib/session-context";
import { resolveAccessibleTeamIds } from "@/lib/team-context";
import { hasTicketTriageAccess, ticketMainInboxVisibilityWhere } from "@/lib/ticket-access";
import { mapSprintRowToApi, sprintApiSelect } from "@/lib/sprint-map";
import {
  buildSprintCompletionPreview,
  loadSprintCompletionScopeRow,
  loadTicketsForSprintCompletion,
  materializeImplicitSprintTicketSet,
  upsertCarriedTickets,
} from "@/lib/sprint-completion";

const completeBodySchema = z.object({
  nextSprintId: z.union([z.string().min(1), z.null()]).optional(),
  /** Extra tickets to link to `nextSprintId` after carryover (same transaction; avoids active-sprint blocking). */
  additionalNextSprintTicketIds: z.array(z.string().min(1)).max(200).optional(),
});

class CompleteSprintHttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "CompleteSprintHttpError";
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasTicketTriageAccess(session.user.role, session.user.specialPermissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: sprintId } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = completeBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const nextSprintIdRaw = parsed.data.nextSprintId;
  const nextSprintId =
    nextSprintIdRaw === undefined || nextSprintIdRaw === null || nextSprintIdRaw === ""
      ? null
      : nextSprintIdRaw;

  const additionalRaw = parsed.data.additionalNextSprintTicketIds;
  const additionalRequested =
    additionalRaw && additionalRaw.length > 0 ? [...new Set(additionalRaw)] : [];

  if (additionalRequested.length > 0 && !nextSprintId) {
    return NextResponse.json(
      { error: "additionalNextSprintTicketIds requires nextSprintId" },
      { status: 400 }
    );
  }

  const teamIds = await resolveAccessibleTeamIds(session.user.id, session.user.specialPermissions);

  try {
    const updated = await db.$transaction(async (tx) => {
      const scopeRow = await loadSprintCompletionScopeRow(tx, sprintId);
      if (!scopeRow) {
        throw new CompleteSprintHttpError(404, "Sprint not found");
      }
      if (!teamIds.includes(scopeRow.teamId)) {
        throw new CompleteSprintHttpError(403, "Forbidden");
      }
      if (scopeRow.completedAt) {
        throw new CompleteSprintHttpError(400, "Sprint is already completed");
      }

      const tickets = await loadTicketsForSprintCompletion(tx, scopeRow);
      const preview = buildSprintCompletionPreview(tickets);

      await tx.sprint.update({
        where: { id: sprintId },
        data: {
          completedAt: new Date(),
          velocity: preview.velocity,
        },
      });

      if (nextSprintId) {
        if (nextSprintId === sprintId) {
          throw new CompleteSprintHttpError(400, "Carryover sprint cannot be the same sprint");
        }
        const next = await tx.sprint.findUnique({
          where: { id: nextSprintId },
          select: {
            id: true,
            teamId: true,
            completedAt: true,
            projects: { select: { projectId: true } },
          },
        });
        if (!next) {
          throw new CompleteSprintHttpError(400, "Carryover sprint not found");
        }
        if (next.teamId !== scopeRow.teamId) {
          throw new CompleteSprintHttpError(400, "Carryover sprint must belong to the same team");
        }
        if (next.completedAt) {
          throw new CompleteSprintHttpError(400, "Cannot carry tickets into a completed sprint");
        }

        await materializeImplicitSprintTicketSet(tx, nextSprintId);
        const carryIds = preview.carryover.map((c) => c.id);
        const carryIdSet = new Set(carryIds);
        if (carryIds.length > 0) {
          await upsertCarriedTickets(tx, nextSprintId, carryIds);
        }

        const extrasFiltered = additionalRequested.filter((id) => !carryIdSet.has(id));
        if (extrasFiltered.length > 0) {
          const nextProjectIds = next.projects.map((p) => p.projectId);
          const foundExtras = await tx.ticket.findMany({
            where: {
              AND: [
                ticketMainInboxVisibilityWhere(),
                { id: { in: extrasFiltered } },
                { projectId: { in: nextProjectIds } },
              ],
            },
            select: { id: true },
          });
          if (foundExtras.length !== extrasFiltered.length) {
            throw new CompleteSprintHttpError(400, "One or more additional tickets were not found");
          }
          await tx.sprintTicket.createMany({
            data: extrasFiltered.map((ticketId) => ({
              sprintId: nextSprintId,
              ticketId,
              isCarriedOver: false,
            })),
            skipDuplicates: true,
          });
        }
      }

      return tx.sprint.findUniqueOrThrow({
        where: { id: sprintId },
        select: sprintApiSelect(),
      });
    });

    revalidateTicketsList();
    return NextResponse.json({ sprint: mapSprintRowToApi(updated) });
  } catch (e: unknown) {
    if (e instanceof CompleteSprintHttpError) {
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    }
    console.error("[api/sprints/[id]/complete POST]", e);
    return NextResponse.json({ error: "Could not complete sprint" }, { status: 500 });
  }
}
