import "dotenv/config";
import { defineConfig } from "prisma/config";

const PLACEHOLDER_URL = "postgresql://localhost:5432/placeholder";
const argv = process.argv;
const isMigrateDiff = argv.includes("migrate") && argv.includes("diff");
const usePlaceholderUrl =
  argv.includes("generate") ||
  argv.includes("validate") ||
  argv.includes("format") ||
  isMigrateDiff;

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    if (usePlaceholderUrl) {
      return PLACEHOLDER_URL;
    }
    throw new Error(
      "DATABASE_URL is not set. Add it to .env (e.g. Supabase or local Postgres)."
    );
  }
  return url;
}

function getDirectUrl(): string | undefined {
  return process.env.DIRECT_URL ?? undefined;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: getDatabaseUrl(),
    ...((directUrl) => (directUrl ? { directUrl } : {}))(getDirectUrl()),
  },
});
