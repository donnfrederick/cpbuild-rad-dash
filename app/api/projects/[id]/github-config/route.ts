import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/encrypt";
import { getSessionContext } from "@/lib/session-context";

function normalizeRepoPart(value: string): string {
  return value.trim().toLowerCase();
}

const putBodySchema = z.object({
  repoOwner: z.string().min(1).max(200).transform(normalizeRepoPart),
  repoName: z.string().min(1).max(200).transform(normalizeRepoPart),
  webhookSecret: z.string().min(8).max(512).optional(),
});

async function canEditProjectSettings(
  userId: string,
  globalRole: string,
  projectId: string
): Promise<boolean> {
  if (globalRole === "ADMIN") return true;
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { teamId: true },
  });
  if (!project) return false;
  const membership = await db.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId: project.teamId } },
    select: { teamRole: true },
  });
  return membership?.teamRole === "ADMIN";
}

/** GET — connected repo (no secret). Any authenticated user. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const config = await db.projectGithubConfig.findUnique({
    where: { projectId },
    select: { repoOwner: true, repoName: true },
  });

  return NextResponse.json({ connected: config !== null, repo: config });
}

/** PUT — upsert GitHub connection (encrypt secret). Global ADMIN or team ADMIN only. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!(await canEditProjectSettings(ctx.user.id, ctx.user.role, projectId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = putBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const { repoOwner, repoName, webhookSecret } = parsed.data;

  const existing = await db.projectGithubConfig.findUnique({
    where: { projectId },
    select: { webhookSecretEncrypted: true },
  });

  let webhookSecretEncrypted: string | undefined;
  if (webhookSecret !== undefined && webhookSecret.length > 0) {
    try {
      webhookSecretEncrypted = encrypt(webhookSecret);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  } else if (existing?.webhookSecretEncrypted) {
    webhookSecretEncrypted = existing.webhookSecretEncrypted;
  }

  if (!webhookSecretEncrypted) {
    return NextResponse.json(
      { error: "webhookSecret is required when connecting for the first time" },
      { status: 400 }
    );
  }

  const conflict = await db.projectGithubConfig.findFirst({
    where: {
      repoOwner,
      repoName,
      NOT: { projectId },
    },
    select: { projectId: true },
  });
  if (conflict) {
    return NextResponse.json(
      { error: "This GitHub repository is already linked to another project" },
      { status: 409 }
    );
  }

  await db.projectGithubConfig.upsert({
    where: { projectId },
    create: {
      projectId,
      repoOwner,
      repoName,
      webhookSecretEncrypted,
    },
    update: {
      repoOwner,
      repoName,
      webhookSecretEncrypted,
    },
  });

  return NextResponse.json({ ok: true, repo: { repoOwner, repoName } });
}

/** DELETE — remove connection. Global ADMIN or team ADMIN only. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!(await canEditProjectSettings(ctx.user.id, ctx.user.role, projectId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.projectGithubConfig.deleteMany({ where: { projectId } });

  return NextResponse.json({ ok: true });
}
