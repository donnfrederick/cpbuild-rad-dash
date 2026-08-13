import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  /** Dev-only: sorted Ticket scalar field names from the Prisma build that created `prisma`. */
  prismaTicketFieldsFingerprint: string | undefined;
};

/** Fingerprint of Ticket scalars from the currently loaded `@prisma/client` module. */
function prismaTicketFieldsFingerprint(): string {
  return Object.keys(Prisma.TicketScalarFieldEnum)
    .sort()
    .join("\u001f");
}

/**
 * True when this Prisma build includes the Sprint model (added after initial RAD Dash schema).
 * If logs show `Unknown field 'goals'` on Sprint, the Node process has a stale client: run
 * `npx prisma generate`, then restart `npm run dev` (the @prisma/client module stays loaded until then).
 */
function prismaHasSprintDelegate(client: PrismaClient): boolean {
  return typeof (client as unknown as { sprint?: unknown }).sprint !== "undefined";
}

function getDb(): PrismaClient {
  const cached = globalForPrisma.prisma;
  if (cached) {
    if (process.env.NODE_ENV !== "production") {
      // Dev: `next dev` keeps a global Prisma instance across HMR. After `prisma generate`,
      // the cached client can still validate against an old DMMF (e.g. Unknown field `environment`
      // on Ticket) even though `sprint` exists. Bust when Ticket scalars drift vs this module's Prisma.
      const staleSprint = !prismaHasSprintDelegate(cached);
      const staleTicketFields =
        globalForPrisma.prismaTicketFieldsFingerprint !== prismaTicketFieldsFingerprint();
      if (staleSprint || staleTicketFields) {
        void cached.$disconnect().catch(() => {});
        globalForPrisma.prisma = undefined;
        globalForPrisma.prismaTicketFieldsFingerprint = undefined;
      } else {
        return cached;
      }
    } else {
      return cached;
    }
  }

  const client = createPrismaClient();
  if (!prismaHasSprintDelegate(client)) {
    throw new Error(
      "Prisma Client is out of date (missing Sprint model). From the project root run: npx prisma generate — then restart the Next.js dev server."
    );
  }
  // Cache in all environments. In production this prevents a new PrismaClient
  // (and a new pg connection pool) from being created on every db property access,
  // which caused P2028 interactive-transaction errors due to pool lifecycle issues.
  globalForPrisma.prisma = client;
  globalForPrisma.prismaTicketFieldsFingerprint = prismaTicketFieldsFingerprint();
  return client;
}

/** Lazy-initialized so build (no DATABASE_URL) doesn't fail. */
export const db = new Proxy({} as PrismaClient, {
  get(_, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
