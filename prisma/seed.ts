/**
 * Idempotent dev seed: roles, triage permission, local admin user.
 * Run after migrations: `npx prisma db seed` (also invoked from `npm run setup:local`).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { PERMISSIONS } from "../lib/permissions-core";

function createPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

function isLikelyLocalDatabase(url: string): boolean {
  return (
    url.includes("127.0.0.1") ||
    url.includes("localhost") ||
    url.includes("@db:") ||
    url.includes("postgres:5432")
  );
}

async function main(): Promise<void> {
  const prisma = createPrisma();
  const url = process.env.DATABASE_URL ?? "";
  const local = isLikelyLocalDatabase(url);

  const adminRole = await prisma.role.upsert({
    where: { code: "ADMIN" },
    create: {
      code: "ADMIN",
      name: "Administrator",
      description: "Ticket triage and user management",
    },
    update: { name: "Administrator" },
  });

  await prisma.role.upsert({
    where: { code: "MEMBER" },
    create: {
      code: "MEMBER",
      name: "Member",
      description: "Standard team member",
    },
    update: { name: "Member" },
  });

  const triagePerm = await prisma.permission.upsert({
    where: { code: PERMISSIONS.TICKETS_TRIAGE },
    create: {
      code: PERMISSIONS.TICKETS_TRIAGE,
      name: "Tickets triage",
      description: "List and manage all tickets",
    },
    update: { name: "Tickets triage" },
  });

  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: adminRole.id,
        permissionId: triagePerm.id,
      },
    },
    create: {
      roleId: adminRole.id,
      permissionId: triagePerm.id,
    },
    update: {},
  });

  await prisma.permission.upsert({
    where: { code: PERMISSIONS.ACCESS_ALL_TEAMS },
    create: {
      code: PERMISSIONS.ACCESS_ALL_TEAMS,
      name: "Access all teams",
      description:
        "Cross-team visibility — see all teams, switch between dashboards, create new teams. Grant via UserSpecialPermission to designated ADMIN users.",
    },
    update: { name: "Access all teams" },
  });

  const teamRad = await prisma.team.upsert({
    where: { slug: "team-rad" },
    create: { id: "cm000000000000teamrad0000", name: "Team RAD", slug: "team-rad" },
    update: { name: "Team RAD" },
  });

  const email =
    process.env.SEED_ADMIN_EMAIL?.trim() || "admin@rad-dash.local";
  const password =
    process.env.SEED_ADMIN_PASSWORD?.trim() ||
    (local ? "rad-dash-local" : undefined);

  if (!password) {
    console.warn(
      "Skipping seeded user: set SEED_ADMIN_PASSWORD (required when DATABASE_URL is not a local URL)."
    );
    await prisma.$disconnect();
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: "Local admin",
      passwordHash,
      roleId: adminRole.id,
      status: "ACTIVE",
    },
    update: {
      passwordHash,
      roleId: adminRole.id,
      status: "ACTIVE",
    },
  });

  const adminUser = await prisma.user.findUniqueOrThrow({ where: { email } });

  await prisma.teamMembership.upsert({
    where: { userId_teamId: { userId: adminUser.id, teamId: teamRad.id } },
    create: { userId: adminUser.id, teamId: teamRad.id, teamRole: "ADMIN" },
    update: { teamRole: "ADMIN" },
  });

  const allTeamsPerm = await prisma.permission.findUniqueOrThrow({
    where: { code: PERMISSIONS.ACCESS_ALL_TEAMS },
  });

  await prisma.userSpecialPermission.upsert({
    where: {
      userId_permission: {
        userId: adminUser.id,
        permission: allTeamsPerm.code,
      },
    },
    create: {
      userId: adminUser.id,
      permission: allTeamsPerm.code,
      note: "Seeded super-admin — cross-team visibility",
    },
    update: {},
  });

  console.log("Seed complete.");
  console.log(`  Login: ${email}`);
  if (!process.env.SEED_ADMIN_PASSWORD?.trim()) {
    console.log("  Password (local default): rad-dash-local");
    console.log("  Override with SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD in .env");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
