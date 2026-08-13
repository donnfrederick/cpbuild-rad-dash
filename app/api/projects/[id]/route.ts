import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { revalidateProjectsList, revalidateTicketsList } from "@/lib/list-cache";
import { getSessionContext } from "@/lib/session-context";
import { canManageProject } from "@/lib/project-management-server";
import { ensureUniqueKeyPrefix } from "@/lib/project-key-prefix";

const patchProjectSchema = z.object({
  name: z.string().min(1).max(120).trim().optional(),
  description: z.string().max(4000).optional().nullable(),
  ticketKeyPrefix: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Z0-9]+$/i)
    .transform((s) => s.toUpperCase())
    .optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const project = await db.project.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      ticketKeyPrefix: true,
      teamId: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { tickets: true } },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { _count, ...rest } = project;
  return NextResponse.json({
    ...rest,
    ticketCount: _count.tickets,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const canManage = await canManageProject(
    ctx.user.id,
    ctx.user.role,
    ctx.user.specialPermissions,
    id
  );
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  if (data.name === undefined && data.description === undefined && data.ticketKeyPrefix === undefined) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const existing = await db.project.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let nextPrefix: string | undefined;
  if (data.ticketKeyPrefix !== undefined) {
    nextPrefix = await ensureUniqueKeyPrefix(data.ticketKeyPrefix, id);
  }

  try {
    const project = await db.project.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.description !== undefined && {
          description: data.description === null ? null : data.description.trim() || null,
        }),
        ...(nextPrefix !== undefined && { ticketKeyPrefix: nextPrefix }),
      },
      select: {
        id: true,
        name: true,
        description: true,
        ticketKeyPrefix: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    revalidateProjectsList();
    revalidateTicketsList();
    return NextResponse.json(project);
  } catch (e: unknown) {
    const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: string }).code) : "";
    if (code === "P2002") {
      return NextResponse.json({ error: "A project with this name already exists" }, { status: 409 });
    }
    throw e;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const canManage = await canManageProject(
    ctx.user.id,
    ctx.user.role,
    ctx.user.specialPermissions,
    id
  );
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const project = await db.project.findUnique({
    where: { id },
    select: { _count: { select: { tickets: true } } },
  });
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (project._count.tickets > 0) {
    return NextResponse.json(
      { error: "Cannot delete a project that still has tickets. Move or remove tickets first.", code: "PROJECT_HAS_TICKETS" },
      { status: 409 }
    );
  }

  await db.project.delete({ where: { id } });
  revalidateProjectsList();
  revalidateTicketsList();
  return NextResponse.json({ ok: true });
}
