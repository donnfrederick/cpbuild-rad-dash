import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";
import { db } from "@/lib/db";

/** Safety net if a write path forgets to call revalidateTag. */
export const LIST_CACHE_REVALIDATE_SECONDS = 45;

export const listCacheTags = {
  tagsCatalog: "list:tags-catalog",
  projectsList: "list:projects-list",
  ticketsList: "list:tickets-list",
} as const;

export function revalidateTagsCatalog(): void {
  revalidateTag(listCacheTags.tagsCatalog, "default");
}

export function revalidateProjectsList(): void {
  revalidateTag(listCacheTags.projectsList, "default");
}

export function revalidateTicketsList(): void {
  revalidateTag(listCacheTags.ticketsList, "default");
}

const TAGS_BASELINE_LIMIT = 500;

/**
 * Module-level — must be outside any per-request function so revalidateTag works correctly.
 */
const _cachedTagsCatalog = unstable_cache(
  async () => {
    const tags = await db.tag.findMany({
      orderBy: { name: "asc" },
      take: TAGS_BASELINE_LIMIT,
      select: { id: true, name: true },
    });
    return { tags };
  },
  ["tags-catalog", "baseline", String(TAGS_BASELINE_LIMIT)],
  {
    tags: [listCacheTags.tagsCatalog],
    revalidate: LIST_CACHE_REVALIDATE_SECONDS,
  }
);

export async function getCachedTagsCatalogBaseline(): Promise<{ tags: Array<{ id: string; name: string }> }> {
  return _cachedTagsCatalog();
}

/**
 * Module-level — must be outside any per-request function so revalidateTag works correctly.
 */
const _cachedProjectsList = unstable_cache(
  async () => {
    const projects = await db.project.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        ticketKeyPrefix: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return { projects };
  },
  ["projects-list"],
  {
    tags: [listCacheTags.projectsList],
    revalidate: LIST_CACHE_REVALIDATE_SECONDS,
  }
);

export async function getCachedProjectsList(): Promise<{
  projects: Array<{
    id: string;
    name: string;
    description: string | null;
    ticketKeyPrefix: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
}> {
  return _cachedProjectsList();
}
