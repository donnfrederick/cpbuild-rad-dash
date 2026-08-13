"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  RefreshCw, Search, ChevronLeft, ChevronRight, Database,
  Link, ArrowLeft, Filter, Plus, X, Code, Check, Copy,
  ChevronDown,
} from "lucide-react";
import type { FilterOp, ColumnFilter } from "@/app/api/devtools/data/route";

// ── FK map ─────────────────────────────────────────────────────────────────

const FK_MAP: Record<string, Record<string, string>> = {
  User:                  { roleId: "Role" },
  Invite:                { roleId: "Role", invitedById: "User" },
  RolePermission:        { roleId: "Role", permissionId: "Permission" },
  UserSpecialPermission: { userId: "User" },
  Account:               { userId: "User" },
  Session:               { userId: "User" },
  Ticket:                { projectId: "Project", createdById: "User", assignedToId: "User" },
  TicketComment:         { ticketId: "Ticket", authorId: "User" },
  TicketMention:         { ticketId: "Ticket", userId: "User" },
  TicketDuplicate:       { ticketId: "Ticket", duplicateOfId: "Ticket" },
  Notification:          { userId: "User", ticketId: "Ticket" },
  MediaAttachment:       { ticketId: "Ticket", uploadedById: "User" },
  Tag:                   { projectId: "Project" },
};

// ── Filter operators ────────────────────────────────────────────────────────

const OPERATORS: { value: FilterOp; label: string; noValue?: boolean }[] = [
  { value: "=",           label: "=" },
  { value: "!=",          label: "≠" },
  { value: "contains",    label: "contains" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with",   label: "ends with" },
  { value: ">",           label: ">" },
  { value: ">=",          label: "≥" },
  { value: "<",           label: "<" },
  { value: "<=",          label: "≤" },
  { value: "is_null",     label: "is null",     noValue: true },
  { value: "is_not_null", label: "is not null", noValue: true },
];

// ── Types ───────────────────────────────────────────────────────────────────

interface TableInfo  { name: string; count: number }

interface TableDataResponse {
  table:   string;
  columns: string[];
  rows:    Record<string, unknown>[];
  total:   number;
  page:    number;
  limit:   number;
}

interface ActiveFilter extends ColumnFilter { id: string }

interface FKNavSource { fromTable: string; fromColumn: string; value: string }

// ── Helpers ─────────────────────────────────────────────────────────────────

const TRUNCATE_LEN = 80;
const PAGE_SIZES   = [25, 50, 100, 200];

function truncate(val: unknown): string {
  if (val == null || val === "") return "—";
  const s = String(val);
  return s.length > TRUNCATE_LEN ? s.slice(0, TRUNCATE_LEN) + "…" : s;
}

function uid(): string {
  return Math.random().toString(36).slice(2);
}

// ── Shared input / select style ─────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  height: 28,
  padding: "0 8px",
  border: "1px solid var(--neutral-300)",
  borderRadius: "var(--radius-sm)",
  fontSize: "var(--text-caption)",
  backgroundColor: "var(--neutral-0)",
  color: "var(--neutral-800)",
  outline: "none",
};

// ── Component ────────────────────────────────────────────────────────────────

export function DataVisualizer() {
  // ── Table list state ────────────────────────────────────────────────────
  const [tables,       setTables]       = useState<TableInfo[]>([]);
  const [loadingList,  setLoadingList]  = useState(true);
  const [listError,    setListError]    = useState<string | null>(null);

  // ── Selected table + grid state ─────────────────────────────────────────
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [data,          setData]          = useState<TableDataResponse | null>(null);
  const [loadingData,   setLoadingData]   = useState(false);
  const [dataError,     setDataError]     = useState<string | null>(null);

  // ── Search ──────────────────────────────────────────────────────────────
  const [search,         setSearch]         = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");

  // ── Pagination / sort ───────────────────────────────────────────────────
  const [page,  setPage]  = useState(1);
  const [limit, setLimit] = useState(50);
  const [sort,  setSort]  = useState<string | null>(null);
  const [order, setOrder] = useState<"asc" | "desc">("asc");

  // ── Column filters ──────────────────────────────────────────────────────
  const [filtersOpen,    setFiltersOpen]    = useState(false);
  const [activeFilters,  setActiveFilters]  = useState<ActiveFilter[]>([]);

  // ── SQL mode ────────────────────────────────────────────────────────────
  const [sqlMode,       setSqlMode]       = useState(false);
  const [rawWhere,      setRawWhere]      = useState("");
  const [sqlApplied,    setSqlApplied]    = useState("");     // last-run value
  const [rawSqlAllowed, setRawSqlAllowed] = useState(false);  // server-gated: never true in production deployments

  // ── FK navigation ───────────────────────────────────────────────────────
  const [fkNavSource, setFkNavSource] = useState<FKNavSource | null>(null);

  // ── Copy feedback ────────────────────────────────────────────────────────
  const [copiedCell, setCopiedCell] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch table list ────────────────────────────────────────────────────
  const fetchTables = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const res  = await fetch("/api/devtools/data", { credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
      setTables(json.tables ?? []);
      setRawSqlAllowed(json.rawSqlAllowed === true);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingList(false);
    }
  }, []);

  // ── Fetch table data ─────────────────────────────────────────────────────
  const fetchTableData = useCallback(async () => {
    if (!selectedTable) return;
    setLoadingData(true);
    setDataError(null);
    try {
      const params = new URLSearchParams({
        table: selectedTable,
        page:  String(page),
        limit: String(limit),
      });
      if (searchDebounced) params.set("search", searchDebounced);
      if (sort) { params.set("sort", sort); params.set("order", order); }

      // Column filters (skip incomplete ones)
      const validFilters = activeFilters.filter(
        (f) => f.column && (OPERATORS.find((o) => o.value === f.op)?.noValue || f.value !== "")
      );
      if (validFilters.length > 0) {
        params.set(
          "filters",
          JSON.stringify(
            validFilters.map((f) => ({ column: f.column, op: f.op, value: f.value })),
          ),
        );
      }

      // Raw WHERE (only send the applied value, not the draft)
      if (sqlApplied) params.set("rawWhere", sqlApplied);

      const res  = await fetch(`/api/devtools/data?${params}`, { credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
      setData(json);
    } catch (err) {
      setDataError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingData(false);
    }
  }, [selectedTable, page, limit, searchDebounced, sort, order, activeFilters, sqlApplied]);

  // ── Effects ──────────────────────────────────────────────────────────────
  useEffect(() => { fetchTables(); }, [fetchTables]);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(1); }, [searchDebounced]);

  useEffect(() => {
    if (!selectedTable) { setData(null); return; }
    fetchTableData();
  }, [selectedTable, page, limit, searchDebounced, sort, order, activeFilters, sqlApplied, fetchTableData]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleSort = (col: string) => {
    if (sort === col) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSort(col); setOrder("asc"); }
    setPage(1);
  };

  const selectTable = (name: string) => {
    setSelectedTable(name);
    setSearch("");
    setPage(1);
    setSort(null);
    setFkNavSource(null);
    setActiveFilters([]);
    setSqlApplied("");
    setRawWhere("");
  };

  const navigateToFK = (fromTable: string, fromColumn: string, targetTable: string, fkValue: string) => {
    setFkNavSource({ fromTable, fromColumn, value: fkValue });
    setSelectedTable(targetTable);
    setSearch(fkValue);
    setActiveFilters([]);
    setSqlApplied("");
    setRawWhere("");
    setPage(1);
    setSort(null);
  };

  const copyCell = (val: string, key: string) => {
    navigator.clipboard.writeText(val).catch(() => {});
    setCopiedCell(key);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedCell(null), 1200);
  };

  // ── Filter helpers ───────────────────────────────────────────────────────
  const addFilter = () => {
    const col = data?.columns[0] ?? "";
    setActiveFilters((f) => [...f, { id: uid(), column: col, op: "=", value: "" }]);
    setFiltersOpen(true);
  };

  const updateFilter = (id: string, patch: Partial<ActiveFilter>) =>
    setActiveFilters((f) => f.map((fi) => (fi.id === id ? { ...fi, ...patch } : fi)));

  const removeFilter = (id: string) =>
    setActiveFilters((f) => f.filter((fi) => fi.id !== id));

  const clearFilters = () => { setActiveFilters([]); setPage(1); };

  const applySQL = () => { setSqlApplied(rawWhere); setPage(1); };
  const clearSQL = () => { setSqlApplied(""); setRawWhere(""); setPage(1); };

  const activeCount = activeFilters.filter(
    (f) => f.column && (OPERATORS.find((o) => o.value === f.op)?.noValue || f.value !== "")
  ).length;

  const totalPages = data ? Math.ceil(data.total / data.limit) : 0;
  const availableCols = data?.columns ?? [];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 overflow-hidden">

      {/* ── Left sidebar: table list ── */}
      <div
        className="flex-shrink-0 flex flex-col"
        style={{ width: 200, borderRight: "1px solid var(--neutral-200)", backgroundColor: "var(--neutral-50)" }}
      >
        <div style={{ padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--neutral-200)" }}>
          <h3 style={{ fontSize: "var(--text-body)", fontWeight: 600, color: "var(--neutral-800)", margin: 0 }}>
            Tables
          </h3>
        </div>
        <div className="flex-1 overflow-auto" style={{ padding: "var(--space-2)" }}>
          {loadingList ? (
            <p style={{ padding: "var(--space-4)", color: "var(--neutral-500)", fontSize: "var(--text-caption)", margin: 0 }}>Loading…</p>
          ) : listError ? (
            <p style={{ padding: "var(--space-4)", color: "var(--error-600)", fontSize: "var(--text-caption)", margin: 0 }}>{listError}</p>
          ) : (
            tables.map((t) => (
              <button
                key={t.name}
                onClick={() => selectTable(t.name)}
                className="w-full text-left transition-colors"
                style={{
                  padding: "var(--space-2) var(--space-3)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "var(--text-caption)",
                  fontWeight: selectedTable === t.name ? 600 : 400,
                  color: selectedTable === t.name ? "var(--primary-600)" : "var(--neutral-700)",
                  backgroundColor: selectedTable === t.name ? "var(--primary-50)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                <span style={{ fontSize: 11, color: "var(--neutral-400)", flexShrink: 0, marginLeft: 6 }}>
                  {t.count.toLocaleString()}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Main panel ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* ── Toolbar ── */}
        <div
          style={{
            padding: "var(--space-3) var(--space-4)",
            borderBottom: "1px solid var(--neutral-200)",
            backgroundColor: "var(--neutral-0)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
          }}
        >
          {/* Row 1: title + controls */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Title + FK breadcrumb */}
              <h3 style={{ fontSize: "var(--text-body)", fontWeight: 600, color: "var(--neutral-800)", margin: 0, whiteSpace: "nowrap" }}>
                {selectedTable
                  ? `${selectedTable}${data ? ` (${data.total.toLocaleString()} rows)` : ""}`
                  : "Data Visualizer"}
              </h3>
              {fkNavSource && (
                <span
                  className="flex items-center gap-1"
                  style={{
                    padding: "2px 8px",
                    borderRadius: 100,
                    backgroundColor: "rgba(124,58,237,0.08)",
                    border: "1px solid rgba(124,58,237,0.2)",
                    fontSize: "var(--text-caption)",
                    color: "#7C3AED",
                    whiteSpace: "nowrap",
                  }}
                >
                  <ArrowLeft size={10} />
                  <span>{fkNavSource.fromTable}.{fkNavSource.fromColumn}</span>
                  <button
                    onClick={() => { setFkNavSource(null); setSearch(""); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#7C3AED", padding: 0, lineHeight: 1, fontSize: 13, opacity: 0.7, marginLeft: 2 }}
                  >×</button>
                </span>
              )}
            </div>

            {/* Right-side action buttons */}
            {selectedTable && (
              <div className="flex items-center gap-2 flex-wrap">
                {/* Search */}
                <div style={{ position: "relative" }}>
                  <Search size={13} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--neutral-400)" }} />
                  <input
                    type="text"
                    placeholder="Search…"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setFkNavSource(null); }}
                    style={{ ...inputStyle, width: 160, paddingLeft: 26 }}
                  />
                </div>

                {/* Filter toggle */}
                <button
                  onClick={() => setFiltersOpen((v) => !v)}
                  className="flex items-center gap-1 transition-colors"
                  title="Column filters"
                  style={{
                    height: 28,
                    padding: "0 10px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--neutral-300)",
                    backgroundColor: filtersOpen || activeCount > 0 ? "rgba(124,58,237,0.08)" : "var(--neutral-0)",
                    borderColor: filtersOpen || activeCount > 0 ? "rgba(124,58,237,0.3)" : "var(--neutral-300)",
                    color: activeCount > 0 ? "#7C3AED" : "var(--neutral-700)",
                    fontSize: "var(--text-caption)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <Filter size={12} />
                  <span>Filter</span>
                  {activeCount > 0 && (
                    <span style={{
                      minWidth: 16, height: 16, borderRadius: 8,
                      backgroundColor: "#7C3AED", color: "#fff",
                      fontSize: 10, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px",
                    }}>{activeCount}</span>
                  )}
                </button>

                {/* SQL toggle — hidden in prod (rawSqlAllowed is server-gated) */}
                {rawSqlAllowed && <button
                  onClick={() => setSqlMode((v) => !v)}
                  className="flex items-center gap-1 transition-colors"
                  title="Raw SQL WHERE mode (dev only)"
                  style={{
                    height: 28, padding: "0 10px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--neutral-300)",
                    backgroundColor: sqlMode ? "rgba(124,58,237,0.08)" : "var(--neutral-0)",
                    borderColor: sqlMode ? "rgba(124,58,237,0.3)" : "var(--neutral-300)",
                    color: sqlMode ? "#7C3AED" : "var(--neutral-700)",
                    fontSize: "var(--text-caption)",
                    cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 5,
                  }}
                >
                  <Code size={12} />
                  <span>SQL</span>
                  {sqlApplied && (
                    <span style={{
                      width: 7, height: 7, borderRadius: "50%",
                      backgroundColor: "#7C3AED", flexShrink: 0,
                    }} />
                  )}
                </button>}

                {/* Refresh */}
                <button
                  onClick={() => fetchTableData()}
                  disabled={loadingData}
                  className="flex items-center gap-1"
                  style={{
                    height: 28, padding: "0 10px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--neutral-300)",
                    backgroundColor: "var(--neutral-0)",
                    color: "var(--neutral-700)",
                    fontSize: "var(--text-caption)",
                    cursor: loadingData ? "not-allowed" : "pointer",
                    opacity: loadingData ? 0.6 : 1,
                  }}
                >
                  <RefreshCw size={12} className={loadingData ? "animate-spin" : ""} />
                </button>
              </div>
            )}
          </div>

          {/* Row 2: pagination (when table selected) */}
          {selectedTable && data && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span style={{ fontSize: "var(--text-caption)", color: "var(--neutral-500)" }}>Rows</span>
                <select
                  value={limit}
                  onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
                  style={{ ...inputStyle, paddingRight: 4 }}
                >
                  {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <span style={{ fontSize: "var(--text-caption)", color: "var(--neutral-500)", whiteSpace: "nowrap" }}>
                  {data.page} / {totalPages || 1}
                </span>
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loadingData}
                  style={{ padding: 4, border: "1px solid var(--neutral-300)", borderRadius: "var(--radius-sm)", backgroundColor: "var(--neutral-0)", cursor: page <= 1 || loadingData ? "not-allowed" : "pointer", opacity: page <= 1 || loadingData ? 0.5 : 1 }}
                  aria-label="Previous page"><ChevronLeft size={14} /></button>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loadingData}
                  style={{ padding: 4, border: "1px solid var(--neutral-300)", borderRadius: "var(--radius-sm)", backgroundColor: "var(--neutral-0)", cursor: page >= totalPages || loadingData ? "not-allowed" : "pointer", opacity: page >= totalPages || loadingData ? 0.5 : 1 }}
                  aria-label="Next page"><ChevronRight size={14} /></button>
              </div>
            </div>
          )}

          {/* ── Filter builder ── */}
          {filtersOpen && selectedTable && (
            <div
              style={{
                marginTop: "var(--space-1)",
                padding: "var(--space-3)",
                backgroundColor: "var(--neutral-50)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--neutral-200)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
              }}
            >
              {activeFilters.length === 0 ? (
                <p style={{ margin: 0, fontSize: "var(--text-caption)", color: "var(--neutral-500)" }}>
                  No filters. Add a filter to narrow results.
                </p>
              ) : (
                activeFilters.map((f) => {
                  const noValue = OPERATORS.find((o) => o.value === f.op)?.noValue ?? false;
                  return (
                    <div key={f.id} className="flex items-center gap-2 flex-wrap">
                      {/* Column picker */}
                      <div style={{ position: "relative", flexShrink: 0 }}>
                        <select
                          value={f.column}
                          onChange={(e) => updateFilter(f.id, { column: e.target.value })}
                          style={{ ...inputStyle, paddingRight: 20, maxWidth: 130, appearance: "none" }}
                        >
                          {availableCols.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <ChevronDown size={10} style={{ position: "absolute", right: 5, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--neutral-500)" }} />
                      </div>

                      {/* Operator picker */}
                      <div style={{ position: "relative", flexShrink: 0 }}>
                        <select
                          value={f.op}
                          onChange={(e) => updateFilter(f.id, { op: e.target.value as FilterOp })}
                          style={{ ...inputStyle, paddingRight: 20, maxWidth: 120, appearance: "none" }}
                        >
                          {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <ChevronDown size={10} style={{ position: "absolute", right: 5, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--neutral-500)" }} />
                      </div>

                      {/* Value input */}
                      {!noValue && (
                        <input
                          type="text"
                          placeholder="value…"
                          value={f.value}
                          onChange={(e) => { updateFilter(f.id, { value: e.target.value }); setPage(1); }}
                          style={{ ...inputStyle, flex: 1, minWidth: 80 }}
                        />
                      )}

                      {/* Remove */}
                      <button
                        onClick={() => removeFilter(f.id)}
                        style={{ padding: 3, background: "none", border: "none", cursor: "pointer", color: "var(--neutral-400)", borderRadius: "var(--radius-sm)", flexShrink: 0 }}
                        title="Remove filter"
                      ><X size={13} /></button>
                    </div>
                  );
                })
              )}

              {/* Add / Clear */}
              <div className="flex items-center gap-2">
                <button
                  onClick={addFilter}
                  className="flex items-center gap-1"
                  style={{
                    height: 26, padding: "0 10px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--neutral-300)",
                    backgroundColor: "var(--neutral-0)",
                    color: "var(--neutral-700)",
                    fontSize: "var(--text-caption)",
                    cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 5,
                  }}
                ><Plus size={11} /> Add filter</button>
                {activeFilters.length > 0 && (
                  <button
                    onClick={clearFilters}
                    style={{
                      height: 26, padding: "0 10px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--neutral-200)",
                      backgroundColor: "transparent",
                      color: "var(--neutral-500)",
                      fontSize: "var(--text-caption)",
                      cursor: "pointer",
                    }}
                  >Clear all</button>
                )}
              </div>
            </div>
          )}

          {/* ── SQL WHERE mode — only rendered when server confirms rawSqlAllowed ── */}
          {sqlMode && selectedTable && rawSqlAllowed && (
            <div
              style={{
                marginTop: "var(--space-1)",
                padding: "var(--space-3)",
                backgroundColor: "#0d1117",
                borderRadius: "var(--radius-sm)",
                border: "1px solid rgba(255,255,255,0.08)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
              }}
            >
              <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "ui-monospace,monospace" }}>
                WHERE&nbsp;
                <span style={{ color: "rgba(255,255,255,0.25)" }}>— custom SQL condition</span>
              </p>
              <div className="flex gap-2">
                <textarea
                  value={rawWhere}
                  onChange={(e) => setRawWhere(e.target.value)}
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); applySQL(); } }}
                  placeholder={`"status" = 'OPEN' AND "createdAt" > '2025-01-01'`}
                  rows={2}
                  style={{
                    flex: 1,
                    padding: "6px 10px",
                    backgroundColor: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: "var(--radius-sm)",
                    color: "#e6edf3",
                    fontSize: 12,
                    fontFamily: "ui-monospace,monospace",
                    resize: "vertical",
                    outline: "none",
                  }}
                />
                <div className="flex flex-col gap-2">
                  <button
                    onClick={applySQL}
                    title="Run (⌘↵)"
                    style={{
                      height: 28, padding: "0 12px",
                      borderRadius: "var(--radius-sm)",
                      border: "none",
                      backgroundColor: "#7C3AED",
                      color: "#fff",
                      fontSize: "var(--text-caption)",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >Run ⌘↵</button>
                  {sqlApplied && (
                    <button
                      onClick={clearSQL}
                      style={{
                        height: 28, padding: "0 12px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        backgroundColor: "transparent",
                        color: "rgba(255,255,255,0.5)",
                        fontSize: "var(--text-caption)",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >Clear</button>
                  )}
                </div>
              </div>
              {sqlApplied && (
                <p style={{ margin: 0, fontSize: 11, color: "#7ee787", fontFamily: "ui-monospace,monospace" }}>
                  ✓ Active: {sqlApplied.length > 60 ? sqlApplied.slice(0, 60) + "…" : sqlApplied}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Grid content ── */}
        <div className="flex-1 overflow-auto" style={{ padding: "var(--space-4)" }}>
          {!selectedTable ? (
            <div className="flex flex-col items-center justify-center gap-3"
              style={{ height: "100%", minHeight: 200, color: "var(--neutral-500)", fontSize: "var(--text-body)" }}>
              <Database size={40} style={{ opacity: 0.4 }} />
              <p style={{ margin: 0 }}>Select a table to view data</p>
            </div>
          ) : loadingData && !data ? (
            <p style={{ padding: "var(--space-6)", color: "var(--neutral-500)", fontSize: "var(--text-body)", margin: 0 }}>Loading…</p>
          ) : dataError ? (
            <div style={{ padding: "var(--space-4)", backgroundColor: "var(--error-50)", border: "1px solid var(--error-200)", borderRadius: "var(--radius-sm)", color: "var(--error-700)", fontSize: "var(--text-caption)", fontFamily: "ui-monospace,monospace" }}>
              <strong>Error:</strong> {dataError}
            </div>
          ) : data && data.rows.length === 0 ? (
            <p style={{ padding: "var(--space-6)", color: "var(--neutral-500)", fontSize: "var(--text-body)", margin: 0 }}>
              {searchDebounced || activeCount || sqlApplied ? "No rows match your query." : "No rows in this table."}
            </p>
          ) : data ? (
            <div style={{ border: "1px solid var(--neutral-200)", borderRadius: "var(--radius-md)", overflow: "auto", maxWidth: "100%" }}>
              <table style={{ width: "max-content", minWidth: "100%", borderCollapse: "collapse", fontSize: "var(--text-caption)" }}>
                <thead>
                  <tr style={{ backgroundColor: "var(--neutral-100)" }}>
                    {data.columns.map((col) => (
                      <th
                        key={col}
                        onClick={() => handleSort(col)}
                        style={{
                          padding: "6px var(--space-3)",
                          textAlign: "left",
                          fontWeight: 600,
                          color: sort === col ? "#7C3AED" : "var(--neutral-700)",
                          borderBottom: "1px solid var(--neutral-200)",
                          whiteSpace: "nowrap",
                          minWidth: 90,
                          cursor: "pointer",
                          userSelect: "none",
                          position: "sticky",
                          top: 0,
                          backgroundColor: "var(--neutral-100)",
                        }}
                      >
                        {col}
                        {sort === col && (
                          <span style={{ marginLeft: 3, color: "#7C3AED" }}>{order === "asc" ? "↑" : "↓"}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr
                      key={i}
                      style={{ borderBottom: "1px solid var(--neutral-100)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--neutral-50)")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
                    >
                      {data.columns.map((col) => {
                        const fkTarget   = selectedTable ? FK_MAP[selectedTable]?.[col] : undefined;
                        const rawVal     = row[col];
                        const isFk       = !!fkTarget && rawVal != null && rawVal !== "";
                        const isNull     = rawVal == null;
                        const cellKey    = `${i}-${col}`;
                        const isCopied   = copiedCell === cellKey;
                        const displayVal = truncate(rawVal);

                        return (
                          <td
                            key={col}
                            title={isFk ? `View in ${fkTarget}: ${String(rawVal)}` : String(rawVal ?? "")}
                            style={{
                              padding: "5px var(--space-3)",
                              maxWidth: 220,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              color: isNull ? "var(--neutral-400)" : "var(--neutral-800)",
                              fontStyle: isNull ? "italic" : "normal",
                              position: "relative",
                            }}
                          >
                            {isFk ? (
                              /* FK chip */
                              <button
                                onClick={() => navigateToFK(selectedTable!, col, fkTarget, String(rawVal))}
                                className="flex items-center gap-1 transition-colors"
                                style={{
                                  padding: "2px 7px",
                                  borderRadius: 100,
                                  border: "1px solid rgba(124,58,237,0.3)",
                                  backgroundColor: "rgba(124,58,237,0.07)",
                                  color: "#6D28D9",
                                  fontSize: "var(--text-caption)",
                                  fontFamily: "ui-monospace, monospace",
                                  cursor: "pointer",
                                  maxWidth: 190,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(124,58,237,0.15)"; e.currentTarget.style.borderColor = "rgba(124,58,237,0.5)"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "rgba(124,58,237,0.07)"; e.currentTarget.style.borderColor = "rgba(124,58,237,0.3)"; }}
                              >
                                <Link size={10} style={{ flexShrink: 0 }} />
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{displayVal}</span>
                              </button>
                            ) : (
                              /* Regular cell — click to copy */
                              <button
                                onClick={() => !isNull && copyCell(String(rawVal), cellKey)}
                                title={isNull ? "NULL" : `Click to copy: ${String(rawVal)}`}
                                style={{
                                  background: "none",
                                  border: "none",
                                  cursor: isNull ? "default" : "pointer",
                                  padding: 0,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                  color: "inherit",
                                  fontSize: "inherit",
                                  fontFamily: "inherit",
                                  maxWidth: "100%",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", fontStyle: isNull ? "italic" : "normal" }}>
                                  {isNull ? "NULL" : displayVal}
                                </span>
                                {isCopied ? (
                                  <Check size={10} style={{ flexShrink: 0, color: "#16a34a" }} />
                                ) : !isNull ? (
                                  <Copy size={9} style={{ flexShrink: 0, opacity: 0, color: "var(--neutral-400)" }}
                                    className="copy-icon" />
                                ) : null}
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
