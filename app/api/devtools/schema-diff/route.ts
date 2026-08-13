import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { isDevToolsAllowed, DEVTOOLS_BLOCKED_MESSAGE } from "@/lib/devtools-env";
import { requireDevToolsAdmin } from "@/lib/devtools-auth";
// DevTools endpoint — access is controlled by isDevToolsAllowed() (see lib/devtools-env).
export async function GET() {
  if (!isDevToolsAllowed()) {
    return NextResponse.json(
      { error: DEVTOOLS_BLOCKED_MESSAGE },
      { status: 403 }
    );
  }

  const authError = await requireDevToolsAdmin();
  if (authError) return authError;

  try {
    const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
    const raw = fs.readFileSync(schemaPath, "utf-8");
    const parsed = parsePrismaSchema(raw);
    return NextResponse.json(parsed);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to read schema: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}

// ── Lightweight Prisma schema parser ──────────────────────────────────────────

export interface PrismaField {
  name: string;
  type: string;
  isOptional: boolean;
  isArray: boolean;
  isRelation: boolean;
  attributes: string[];
}

export interface PrismaModel {
  name: string;
  fields: PrismaField[];
}

export interface PrismaEnum {
  name: string;
  values: string[];
}

export interface ParsedSchema {
  models: PrismaModel[];
  enums: PrismaEnum[];
}

function parsePrismaSchema(raw: string): ParsedSchema {
  const models: PrismaModel[] = [];
  const enums: PrismaEnum[] = [];

  // Strip line comments
  const cleaned = raw
    .split("\n")
    .map((line) => {
      const commentIdx = line.indexOf("//");
      return commentIdx >= 0 ? line.slice(0, commentIdx) : line;
    })
    .join("\n");

  // Extract model blocks
  const modelRegex = /\bmodel\s+(\w+)\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = modelRegex.exec(cleaned)) !== null) {
    const modelName = match[1];
    const body = match[2];
    const fields = parseFields(body);
    models.push({ name: modelName, fields });
  }

  // Extract enum blocks
  const enumRegex = /\benum\s+(\w+)\s*\{([^}]*)\}/g;

  while ((match = enumRegex.exec(cleaned)) !== null) {
    const enumName = match[1];
    const body = match[2];
    const values = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("@@"));
    enums.push({ name: enumName, values });
  }

  return { models, enums };
}

function parseFields(body: string): PrismaField[] {
  const fields: PrismaField[] = [];
  const lines = body.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  for (const line of lines) {
    // Skip directives like @@index, @@unique
    if (line.startsWith("@@")) continue;

    // Each field line: name  Type  attributes...
    // e.g. "id  String  @id @default(cuid())"
    //      "role  Role  @default(MEMBER)"
    //      "sessions  Session[]"
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;

    const [name, rawType, ...rest] = parts;

    // Skip if name looks like a directive
    if (name.startsWith("@")) continue;

    const isArray = rawType.endsWith("[]");
    const isOptional = rawType.endsWith("?");
    const type = rawType.replace(/[\[\]?]/g, "");

    // Primitive scalar types in Prisma
    const scalars = new Set([
      "String", "Boolean", "Int", "BigInt", "Float", "Decimal",
      "DateTime", "Json", "Bytes",
    ]);
    const isRelation = !scalars.has(type) && !line.includes("@default") && !line.includes("@unique") && !line.includes("@id");

    // Collect @attribute tokens from rest
    const attributes = rest.filter((t) => t.startsWith("@"));

    fields.push({ name, type, isOptional, isArray, isRelation, attributes });
  }

  return fields;
}
