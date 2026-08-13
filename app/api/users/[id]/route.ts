import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { UserStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";

const userStatusSchema = z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]);

const patchSchema = z
  .object({
    roleId: z.string().min(1).optional(),
    status: userStatusSchema.optional(),
  })
  .refine((data) => data.roleId !== undefined || data.status !== undefined, {
    message: "Provide roleId and/or status",
  });

async function countOtherActiveAdmins(excludeUserId: string): Promise<number> {
  return db.user.count({
    where: {
      id: { not: excludeUserId },
      status: "ACTIVE",
      role: { code: "ADMIN" },
    },
  });
}

/** PATCH /api/users/[id] — update role and/or status (ADMIN only) */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body: unknown = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const existing = await db.user.findUnique({
    where: { id },
    include: { role: { select: { code: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const nextStatus = parsed.data.status;
  const nextRoleId = parsed.data.roleId;

  if (nextStatus !== undefined && nextStatus !== "ACTIVE" && id === ctx.user.id) {
    return NextResponse.json(
      { error: "You cannot deactivate your own account from here" },
      { status: 400 }
    );
  }

  let resolvedRoleId = existing.roleId;
  if (nextRoleId !== undefined) {
    const newRole = await db.role.findUnique({
      where: { id: nextRoleId },
      select: { id: true, code: true },
    });
    if (!newRole) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    if (existing.role.code === "ADMIN" && newRole.code !== "ADMIN") {
      const otherAdmins = await countOtherActiveAdmins(id);
      if (otherAdmins === 0) {
        return NextResponse.json(
          { error: "Cannot remove the last administrator" },
          { status: 400 }
        );
      }
    }
    resolvedRoleId = newRole.id;
  }

  const effectiveRoleCode =
    nextRoleId !== undefined
      ? (
          await db.role.findUnique({
            where: { id: resolvedRoleId },
            select: { code: true },
          })
        )?.code ?? existing.role.code
      : existing.role.code;

  if (effectiveRoleCode === "ADMIN" && nextStatus !== undefined && nextStatus !== "ACTIVE") {
    const otherAdmins = await countOtherActiveAdmins(id);
    if (otherAdmins === 0) {
      return NextResponse.json(
        { error: "Cannot deactivate the last administrator" },
        { status: 400 }
      );
    }
  }

  const data: { roleId?: string; status?: UserStatus } = {};
  if (nextRoleId !== undefined) {
    data.roleId = resolvedRoleId;
  }
  if (nextStatus !== undefined) {
    data.status = nextStatus as UserStatus;
  }

  const updated = await db.user.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      role: { select: { id: true, code: true, name: true } },
    },
  });

  return NextResponse.json(updated);
}

const DELETE_CONFIRM = "DELETE";

/** DELETE /api/users/[id] — remove user when safe (ADMIN only). Body: { confirm: "DELETE" } */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (id === ctx.user.id) {
    return NextResponse.json({ error: "You cannot delete your own account" }, { status: 400 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* optional body */
  }
  const confirmParsed = z.object({ confirm: z.literal(DELETE_CONFIRM) }).safeParse(body);
  if (!confirmParsed.success) {
    return NextResponse.json(
      { error: `Send JSON body { "confirm": "${DELETE_CONFIRM}" } to delete this user.` },
      { status: 400 }
    );
  }

  const existing = await db.user.findUnique({
    where: { id },
    include: { role: { select: { code: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (existing.role.code === "ADMIN") {
    const otherAdmins = await countOtherActiveAdmins(id);
    if (otherAdmins === 0) {
      return NextResponse.json(
        { error: "Cannot delete the last administrator" },
        { status: 400 }
      );
    }
  }

  const [commentsCount, mediaCount, ticketsCount] = await Promise.all([
    db.ticketComment.count({ where: { authorId: id } }),
    db.mediaAttachment.count({ where: { uploadedById: id } }),
    db.ticket.count({ where: { userId: id } }),
  ]);

  const reasons: string[] = [];
  if (commentsCount > 0) {
    reasons.push(`ticket_comments:${commentsCount}`);
  }
  if (mediaCount > 0) {
    reasons.push(`media_uploads:${mediaCount}`);
  }

  if (reasons.length > 0) {
    return NextResponse.json(
      {
        code: "USER_DELETE_BLOCKED" as const,
        reasons,
        message:
          "This user has comments or uploads that block deletion. Remove or reassign them first.",
      },
      { status: 409 }
    );
  }

  await db.$transaction(async (tx) => {
    await tx.invite.deleteMany({ where: { sentById: id } });
    await tx.user.delete({ where: { id } });
  });

  return NextResponse.json({
    ok: true,
    deletedTickets: ticketsCount,
    message:
      ticketsCount > 0
        ? `User removed. ${ticketsCount} ticket(s) they submitted were removed (cascade).`
        : "User removed.",
  });
}
