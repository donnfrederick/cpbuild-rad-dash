/**
 * One-time (or idempotent) seed: roles, tickets:triage permission, and an admin user.
 *
 * Usage: DATABASE_URL=... BOOTSTRAP_ADMIN_EMAIL=... BOOTSTRAP_ADMIN_PASSWORD=... npm run bootstrap:admin
 */

import "dotenv/config";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PERMISSIONS } from "../lib/permissions";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const rawEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
const rawPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (!rawEmail || rawPassword === undefined || rawPassword.length === 0) {
  console.error("Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD.");
  process.exit(1);
}
const adminEmail = rawEmail;
const adminPassword = rawPassword;

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  const adminRole = await prisma.role.upsert({
    where: { code: "ADMIN" },
    create: {
      id: randomUUID(),
      code: "ADMIN",
      name: "Administrator",
      description: "Full access including ticket triage",
    },
    update: {},
  });

  await prisma.role.upsert({
    where: { code: "MEMBER" },
    create: {
      id: randomUUID(),
      code: "MEMBER",
      name: "Member",
      description: "Standard user — submit and track own tickets",
    },
    update: {},
  });

  const triagePerm = await prisma.permission.upsert({
    where: { code: PERMISSIONS.TICKETS_TRIAGE },
    create: {
      id: randomUUID(),
      code: PERMISSIONS.TICKETS_TRIAGE,
      name: "Ticket triage",
      description: "View and manage all tickets",
    },
    update: {},
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

  const hash = await bcrypt.hash(adminPassword, 12);
  await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      id: randomUUID(),
      email: adminEmail,
      name: "Admin",
      passwordHash: hash,
      roleId: adminRole.id,
      status: "ACTIVE",
    },
    update: {
      passwordHash: hash,
      roleId: adminRole.id,
      status: "ACTIVE",
    },
  });

  console.log(`Bootstrap complete. Admin user: ${adminEmail}`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
