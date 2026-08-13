import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { revalidateTicketsList } from "@/lib/list-cache";
import { getSessionContext } from "@/lib/session-context";
import { hasTicketTriageAccess } from "@/lib/ticket-access";

type Params = { params: Promise<{ id: string }> };

const linkSchema = z.object({
  canonicalId: z.string().min(1),
  /** Optional cosine similarity (0–1) captured at link time so the UI can
   * always display the score without recomputing an embedding. */
  similarity: z.number().min(0).max(1).optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasTicketTriageAccess(ctx.user.role, ctx.user.specialPermissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = linkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const { canonicalId, similarity } = parsed.data;
  if (id === canonicalId) {
    return NextResponse.json({ error: "A ticket cannot be a duplicate of itself" }, { status: 400 });
  }

  const [duplicate, canonical] = await Promise.all([
    db.ticket.findUnique({
      where: { id },
      select: {
        id: true,
        shortId: true,
        title: true,
        canonicalDuplicates: { select: { id: true } },
        duplicateOf: { select: { canonicalId: true } },
      },
    }),
    db.ticket.findUnique({
      where: { id: canonicalId },
      select: {
        id: true,
        shortId: true,
        title: true,
        duplicateOf: { select: { canonicalId: true } },
      },
    }),
  ]);

  if (!duplicate) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }
  if (!canonical) {
    return NextResponse.json({ error: "Canonical ticket not found" }, { status: 404 });
  }
  if (duplicate.canonicalDuplicates.length > 0) {
    return NextResponse.json(
      {
        error:
          "This ticket is already a canonical — unlink its duplicates before linking it as a duplicate of another",
      },
      { status: 409 }
    );
  }
  if (duplicate.duplicateOf) {
    return NextResponse.json({ error: "This ticket is already linked as a duplicate" }, { status: 409 });
  }
  if (canonical.duplicateOf) {
    return NextResponse.json(
      { error: "The target ticket is itself a duplicate — link to its canonical instead" },
      { status: 409 }
    );
  }

  const link = await db.ticketDuplicate.create({
    data: {
      canonicalId,
      duplicateId: id,
      similarity: similarity ?? null,
    },
    select: {
      id: true,
      canonicalId: true,
      duplicateId: true,
      similarity: true,
      canonical: { select: { id: true, shortId: true, title: true } },
    },
  });

  revalidateTicketsList();
  return NextResponse.json(link, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasTicketTriageAccess(ctx.user.role, ctx.user.specialPermissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const duplicateIdParam = req.nextUrl.searchParams.get("duplicateId");

  if (duplicateIdParam) {
    const link = await db.ticketDuplicate.findUnique({
      where: { duplicateId: duplicateIdParam },
      select: { id: true, canonicalId: true, duplicateId: true },
    });

    if (!link || link.canonicalId !== id) {
      return NextResponse.json(
        { error: "This ticket is not linked as a duplicate of the given canonical" },
        { status: 404 }
      );
    }

    await db.ticketDuplicate.delete({ where: { duplicateId: duplicateIdParam } });

    revalidateTicketsList();
    return NextResponse.json({ unlinked: true, canonicalId: id, duplicateId: duplicateIdParam });
  }

  const link = await db.ticketDuplicate.findUnique({
    where: { duplicateId: id },
    select: { id: true },
  });

  if (!link) {
    return NextResponse.json({ error: "This ticket is not linked as a duplicate" }, { status: 404 });
  }

  await db.ticketDuplicate.delete({ where: { duplicateId: id } });

  revalidateTicketsList();
  return NextResponse.json({ unlinked: true, ticketId: id });
}
