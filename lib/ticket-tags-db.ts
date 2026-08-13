import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeTagName } from "@/lib/tag-normalize";

type Db = PrismaClient | Prisma.TransactionClient;

/** Upsert tags by normalized names and return ids in stable order. */
export async function upsertTagsByNames(db: Db, rawNames: string[]): Promise<{ id: string; name: string }[]> {
  const names = [...new Set(rawNames.map(normalizeTagName).filter(Boolean))];
  const out: { id: string; name: string }[] = [];
  for (const name of names) {
    const row = await db.tag.upsert({
      where: { name },
      create: { name },
      update: {},
      select: { id: true, name: true },
    });
    out.push(row);
  }
  return out;
}

export async function setTicketTagsReplace(db: Db, ticketId: string, rawNames: string[]): Promise<void> {
  const tags = await upsertTagsByNames(db, rawNames);
  await db.ticket.update({
    where: { id: ticketId },
    data: {
      tags: { set: tags.map((t) => ({ id: t.id })) },
    },
  });
}

export async function setTicketTagsAdd(db: Db, ticketId: string, rawNames: string[]): Promise<void> {
  const tags = await upsertTagsByNames(db, rawNames);
  await db.ticket.update({
    where: { id: ticketId },
    data: {
      tags: { connect: tags.map((t) => ({ id: t.id })) },
    },
  });
}

export async function setTicketTagsRemove(db: Db, ticketId: string, rawNames: string[]): Promise<void> {
  const names = rawNames.map(normalizeTagName).filter(Boolean);
  if (names.length === 0) return;
  const existing = await db.tag.findMany({
    where: { name: { in: names } },
    select: { id: true },
  });
  if (existing.length === 0) return;
  await db.ticket.update({
    where: { id: ticketId },
    data: {
      tags: { disconnect: existing.map((t) => ({ id: t.id })) },
    },
  });
}
