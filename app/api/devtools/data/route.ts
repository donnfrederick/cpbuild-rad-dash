import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDevToolsAllowed, isRawSqlAllowed, DEVTOOLS_BLOCKED_MESSAGE } from "@/lib/devtools-env";
import { requireDevToolsAdmin } from "@/lib/devtools-auth";
import { unlinkLocalFieldMediaKeys } from "@/lib/field-media-local";

const WHITELIST = [
  // ── Auth & users ─────────────────────────────────────────────────────────
  "User", "Role", "Permission", "RolePermission", "UserSpecialPermission", "Invite",
  "Account", "Session", "VerificationToken",
  // ── Projects & tickets ───────────────────────────────────────────────────
  "Project", "Tag", "Ticket", "TicketComment", "TicketMention", "TicketDuplicate",
  // ── Notifications & media ─────────────────────────────────────────────────
  "Notification", "MediaAttachment",
  // ── Release system ───────────────────────────────────────────────────────
  "Release", "ReleaseVerification", "EnvironmentVisit",
] as const;
type WhitelistTable = (typeof WHITELIST)[number];

/** Maps display name to actual PostgreSQL table name. */
const TABLE_NAMES: Record<WhitelistTable, string> = {
  // Auth & users
  User: "User",
  Role: "roles",
  Permission: "permissions",
  RolePermission: "role_permissions",
  UserSpecialPermission: "user_special_permissions",
  Invite: "invites",
  Account: "Account",
  Session: "Session",
  VerificationToken: "VerificationToken",
  // Projects & tickets
  Project: "projects",
  Tag: "tags",
  Ticket: "tickets",
  TicketComment: "ticket_comments",
  TicketMention: "ticket_mentions",
  TicketDuplicate: "ticket_duplicates",
  // Notifications & media
  Notification: "notifications",
  MediaAttachment: "media_attachments",
  // Release system
  Release: "releases",
  ReleaseVerification: "release_verifications",
  EnvironmentVisit: "environment_visits",
};

/** Column config per table: default sort, searchable columns, exclude columns (e.g. sensitive fields). */
const TABLE_CONFIG: Record<
  WhitelistTable,
  { defaultSort: string; searchCols: string[]; excludeCols?: string[] }
> = {
  // id included in searchCols for all FK-target tables so navigating from a FK chip
  // (which sets search = the FK value) returns the exact referenced record.

  // ── Auth & users ──────────────────────────────────────────────────────────
  User: { defaultSort: "email", searchCols: ["id", "email", "name"], excludeCols: ["password"] },
  Role: { defaultSort: "code", searchCols: ["id", "code", "name"] },
  Permission: { defaultSort: "code", searchCols: ["id", "code", "name"] },
  RolePermission: { defaultSort: "roleId", searchCols: ["roleId", "permissionId"] },
  UserSpecialPermission: { defaultSort: "grantedAt", searchCols: ["id", "userId", "permission", "note"] },
  Invite: { defaultSort: "createdAt", searchCols: ["id", "email"], excludeCols: ["token"] },
  Account: { defaultSort: "createdAt", searchCols: ["id", "userId", "type", "provider"] },
  Session: { defaultSort: "expires", searchCols: ["id", "userId"] },
  VerificationToken: { defaultSort: "expires", searchCols: ["identifier"] },

  // ── Projects & tickets ────────────────────────────────────────────────────
  Project: { defaultSort: "createdAt", searchCols: ["id", "name", "key"] },
  Tag: { defaultSort: "name", searchCols: ["id", "name"] },
  Ticket: { defaultSort: "createdAt", searchCols: ["id", "title", "status", "projectId", "createdById"] },
  TicketComment: { defaultSort: "createdAt", searchCols: ["id", "ticketId", "authorId"] },
  TicketMention: { defaultSort: "createdAt", searchCols: ["id", "ticketId", "userId"] },
  TicketDuplicate: { defaultSort: "createdAt", searchCols: ["id", "ticketId", "duplicateOfId"] },

  // ── Notifications & media ─────────────────────────────────────────────────
  Notification: { defaultSort: "createdAt", searchCols: ["id", "userId", "ticketId"] },
  MediaAttachment: {
    defaultSort: "createdAt",
    searchCols: ["id", "ticketId", "uploadedById", "mimeType"],
  },

  // ── Release system ────────────────────────────────────────────────────────
  Release: {
    defaultSort: "mergedAt",
    searchCols: ["id", "title", "branch", "environment"],
    excludeCols: ["changes", "verificationSteps"],
  },
  ReleaseVerification: { defaultSort: "verifiedAt", searchCols: ["id", "releaseId", "userId", "environment"] },
  EnvironmentVisit: { defaultSort: "lastVisitedAt", searchCols: ["userId", "environment"] },
};

// ── Filter types ──────────────────────────────────────────────────────────────

export type FilterOp =
  | "=" | "!=" | ">" | ">=" | "<" | "<="
  | "contains" | "starts_with" | "ends_with"
  | "is_null" | "is_not_null";

export interface ColumnFilter {
  column: string;
  op: FilterOp;
  value: string;
}

// ── WHERE clause builder ───────────────────────────────────────────────────────

/**
 * Builds a parameterized SQL WHERE fragment from column filters.
 * Columns are double-quoted and stripped of quotes to prevent injection.
 * Returns { sql, params } — params are appended BEFORE the limit/offset params.
 */
function buildFilterSQL(
  filters: ColumnFilter[],
  startParam: number
): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  let n = startParam;

  for (const f of filters) {
    const col = `"${f.column.replace(/"/g, "")}"`;
    switch (f.op) {
      case "=":
        parts.push(`${col}::text = $${n++}`);
        params.push(f.value);
        break;
      case "!=":
        parts.push(`${col}::text != $${n++}`);
        params.push(f.value);
        break;
      case ">":
        parts.push(`${col}::numeric > $${n++}::numeric`);
        params.push(f.value);
        break;
      case ">=":
        parts.push(`${col}::numeric >= $${n++}::numeric`);
        params.push(f.value);
        break;
      case "<":
        parts.push(`${col}::numeric < $${n++}::numeric`);
        params.push(f.value);
        break;
      case "<=":
        parts.push(`${col}::numeric <= $${n++}::numeric`);
        params.push(f.value);
        break;
      case "contains":
        parts.push(`${col}::text ILIKE $${n++}`);
        params.push(`%${f.value}%`);
        break;
      case "starts_with":
        parts.push(`${col}::text ILIKE $${n++}`);
        params.push(`${f.value}%`);
        break;
      case "ends_with":
        parts.push(`${col}::text ILIKE $${n++}`);
        params.push(`%${f.value}`);
        break;
      case "is_null":
        parts.push(`${col} IS NULL`);
        break;
      case "is_not_null":
        parts.push(`${col} IS NOT NULL`);
        break;
    }
  }

  return { sql: parts.join(" AND "), params };
}

// ── API handler ────────────────────────────────────────────────────────────────

// Dev-only endpoint — blocked unless NODE_ENV !== production or APP_ENV=dev (Railway dev).
export async function GET(request: NextRequest) {
  if (!isDevToolsAllowed()) {
    return NextResponse.json(
      { error: DEVTOOLS_BLOCKED_MESSAGE },
      { status: 403 }
    );
  }

  const authError = await requireDevToolsAdmin();
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(1000, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)));
  const search = searchParams.get("search")?.trim();
  const sort = searchParams.get("sort");
  const order = searchParams.get("order") === "desc" ? "desc" : "asc";

  // Column filters — JSON array of { column, op, value }
  let columnFilters: ColumnFilter[] = [];
  const filtersParam = searchParams.get("filters");
  if (filtersParam) {
    try { columnFilters = JSON.parse(filtersParam) as ColumnFilter[]; } catch { /* ignore */ }
  }

  // Raw SQL WHERE clause — only permitted in non-prod environments.
  // isRawSqlAllowed() hard-blocks this in prod even when DEVTOOLS_ENABLED=true.
  const rawWhereParam = searchParams.get("rawWhere")?.trim() ?? "";
  const rawWhere = rawWhereParam && isRawSqlAllowed() ? rawWhereParam : "";

  // Table list (no table param)
  if (!table) {
    try {
      const tables = await Promise.all(
        WHITELIST.map(async (name) => {
          const count = await getCountRaw(name);
          return { name, count };
        })
      );
      return NextResponse.json({ tables, rawSqlAllowed: isRawSqlAllowed() });
    } catch (err) {
      return NextResponse.json(
        { error: `Failed to fetch tables: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 }
      );
    }
  }

  // Table data
  if (!WHITELIST.includes(table as WhitelistTable)) {
    return NextResponse.json({ error: "Invalid table name" }, { status: 400 });
  }

  try {
    const result = await getTableDataRaw(table as WhitelistTable, {
      page,
      limit,
      search: search || undefined,
      sort: sort || undefined,
      order,
      columnFilters,
      rawWhere: rawWhere || undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch data: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}

type TableDataParams = {
  page: number;
  limit: number;
  search?: string;
  sort?: string;
  order: "asc" | "desc";
  columnFilters: ColumnFilter[];
  rawWhere?: string;
};

async function getCountRaw(table: WhitelistTable): Promise<number> {
  try {
    const tableName = TABLE_NAMES[table];
    const result = await db.$queryRawUnsafe<[{ count: string }]>(
      `SELECT COUNT(*)::text as count FROM "${tableName}"`
    );
    return parseInt(result[0]?.count ?? "0", 10);
  } catch {
    return 0;
  }
}

async function getTableDataRaw(
  table: WhitelistTable,
  params: TableDataParams
): Promise<{
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  limit: number;
}> {
  const { page, limit, search, sort, order, columnFilters, rawWhere } = params;
  const skip = (page - 1) * limit;
  const tableName = TABLE_NAMES[table];
  const config = TABLE_CONFIG[table];

  const validSortCols = [
    ...config.searchCols,
    "id", "rowIndex", "createdAt", "updatedAt", "grantedAt",
    "startedAt", "lastVisitedAt", "mergedAt", "verifiedAt",
    "dateFor", "generatedAt", "order",
  ];
  const orderCol = sort && validSortCols.includes(sort) ? sort : config.defaultSort;
  const orderDir = order === "desc" ? "DESC" : "ASC";

  // ── Build WHERE clause from all conditions ──────────────────────────────
  const whereParts: string[] = [];
  const allParams: unknown[] = [];
  let nextParam = 1;

  // 1. Free-text search across searchCols
  if (search && config.searchCols.length > 0) {
    const pattern = `%${search}%`;
    const searchExpr = config.searchCols
      .map((c) => `"${c}"::text ILIKE $${nextParam}`)
      .join(" OR ");
    whereParts.push(`(${searchExpr})`);
    allParams.push(pattern);
    nextParam++;
  }

  // 2. Column-level filters
  if (columnFilters.length > 0) {
    const { sql, params: fParams } = buildFilterSQL(columnFilters, nextParam);
    if (sql) {
      whereParts.push(`(${sql})`);
      allParams.push(...fParams);
      nextParam += fParams.length;
    }
  }

  // 3. Raw WHERE clause (verbatim — admin-only dev tool, trusted input)
  if (rawWhere) {
    whereParts.push(`(${rawWhere})`);
  }

  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

  // Limit and offset are always the last two params
  const limitParam = nextParam;
  const offsetParam = nextParam + 1;
  const queryParams = [...allParams, limit, skip];
  const countParams = [...allParams];

  const [rows, countResult] = await Promise.all([
    db.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM "${tableName}" ${whereClause} ORDER BY "${orderCol}" ${orderDir} LIMIT $${limitParam} OFFSET $${offsetParam}`,
      ...queryParams
    ),
    db.$queryRawUnsafe<[{ count: string }]>(
      `SELECT COUNT(*)::text as count FROM "${tableName}" ${whereClause}`,
      ...countParams
    ),
  ]);

  const total = parseInt(countResult[0]?.count ?? "0", 10);

  const serialized = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (config.excludeCols?.includes(k)) continue;
      if (v instanceof Date) {
        out[k] = v.toISOString();
      } else if (
        v !== null &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        typeof (v as { toISOString?: () => string }).toISOString !== "function"
      ) {
        const str = JSON.stringify(v);
        out[k] = str.length > 200 ? str.slice(0, 200) + "…" : str;
      } else {
        out[k] = v;
      }
    }
    return out;
  });

  const columns =
    serialized.length > 0
      ? Object.keys(serialized[0])
      : table === "Project"
        ? ["id", "unifierPid", "createdAt"]
        : ["id"];

  return { table, columns, rows: serialized, total, page, limit };
}

// ── DELETE handler ─────────────────────────────────────────────────────────────

function getSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (url) return url.replace(/\/$/, "");
  const dbUrl = process.env.DATABASE_URL ?? "";
  const match = dbUrl.match(/postgres\.([a-z0-9]+):/);
  if (match) return `https://${match[1]}.supabase.co`;
  throw new Error("SUPABASE_URL not set");
}

async function purgeStorageKeys(keys: string[]): Promise<void> {
  if (!keys.length) return;
  await unlinkLocalFieldMediaKeys(keys);
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) return;
  let supabaseUrl: string;
  try {
    supabaseUrl = getSupabaseUrl();
  } catch {
    return;
  }
  // Supabase Storage batch delete
  await fetch(`${supabaseUrl}/storage/v1/object`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefixes: keys }),
  }).catch((err) => {
    console.error("[devtools/data DELETE] Storage purge failed:", err);
  });
}

/** Collects all storageKey values on MediaAttachment rows linked to a parent record. */
async function collectAttachmentKeys(table: WhitelistTable, id: string): Promise<string[]> {
  if (table === "Ticket") {
    const attachments = await db.mediaAttachment.findMany({
      where: { ticketId: id },
      select: { storageKey: true },
    });
    return attachments.map((a) => a.storageKey);
  }
  if (table === "TicketComment") {
    const attachments = await db.mediaAttachment.findMany({
      where: { ticketCommentId: id },
      select: { storageKey: true },
    });
    return attachments.map((a) => a.storageKey);
  }
  return [];
}

export async function DELETE(request: NextRequest) {
  if (!isDevToolsAllowed()) {
    return NextResponse.json({ error: DEVTOOLS_BLOCKED_MESSAGE }, { status: 403 });
  }
  const authError = await requireDevToolsAdmin();
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table");
  const id = searchParams.get("id");

  if (!table || !id) {
    return NextResponse.json({ error: "table and id are required" }, { status: 400 });
  }
  if (!WHITELIST.includes(table as WhitelistTable)) {
    return NextResponse.json({ error: "Invalid table name" }, { status: 400 });
  }

  const whitelistTable = table as WhitelistTable;

  try {
    // Purge Supabase Storage objects before DB delete for media-owning tables
    const storageKeys = await collectAttachmentKeys(whitelistTable, id);
    if (storageKeys.length) {
      await purgeStorageKeys(storageKeys);
    }

    // If deleting a MediaAttachment directly, purge its own storageKey too
    if (whitelistTable === "MediaAttachment") {
      const attachment = await db.mediaAttachment.findUnique({
        where: { id },
        select: { storageKey: true },
      });
      if (attachment) await purgeStorageKeys([attachment.storageKey]);
    }

    const tableName = TABLE_NAMES[whitelistTable];
    await db.$executeRawUnsafe(`DELETE FROM "${tableName}" WHERE "id" = $1`, id);

    return NextResponse.json({ deleted: true, table, id });
  } catch (err) {
    return NextResponse.json(
      { error: `Delete failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
