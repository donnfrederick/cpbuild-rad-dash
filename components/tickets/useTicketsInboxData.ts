"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { TicketReport, TicketRow, TicketStatus } from "@/components/tickets/ticket-types";
import { TICKETS_INBOX_MERGE_EVENT, TICKETS_INBOX_REFRESH_EVENT } from "@/lib/ticket-inbox-events";
import { mergeTicketReportIntoRow } from "@/lib/ticket-row-merge";

export type GlobalProjectFilterQuery =
  | { mode: "all" }
  | { mode: "explicit"; pids: string[]; includeUnassigned: boolean };

export type GlobalSprintFilterQuery =
  | { mode: "all" }
  | { mode: "explicit"; sprintIds: string[] };

export interface UseTicketsInboxDataOptions {
  canTriage: boolean;
  /** When set, list and archived fetches are scoped to this project. */
  projectId?: string | null;
  /** When set, fetches tickets for all projects linked to this sprint (do not pass together with projectId). */
  sprintId?: string | null;
  /** All-tickets page: multi-project + unassigned filter. Omit for project/sprint views. */
  globalProjectFilterQuery?: GlobalProjectFilterQuery;
  /** All-tickets page: multi-sprint filter. Omit for project/sprint views. Combines with globalProjectFilterQuery as AND. */
  globalSprintFilterQuery?: GlobalSprintFilterQuery;
  /** Current team slug — scopes ticket results to this team's projects. */
  teamSlug?: string | null;
}

/** Serializable key: same meaning / same list URL → same value (stable across object identity). */
function globalProjectFilterKeyFromPrimitiveParts(
  modeKey: string,
  pidsKey: string,
  includeUnassigned: boolean | null
): string {
  if (modeKey === "") return "";
  if (modeKey === "all") return "all";
  return `e:${pidsKey}:${includeUnassigned ? "1" : "0"}`;
}

function globalSprintFilterKeyFromPrimitiveParts(modeKey: string, sIdsKey: string): string {
  if (modeKey === "") return "";
  if (modeKey === "all") return "all";
  return `e:${sIdsKey}`;
}

function ticketsListUrl(
  pathWithQuery: string,
  projectId?: string | null,
  sprintId?: string | null,
  globalQ?: GlobalProjectFilterQuery,
  globalSprintQ?: GlobalSprintFilterQuery,
  teamSlug?: string | null,
  listFresh?: boolean
): string {
  const q = pathWithQuery.includes("?") ? pathWithQuery.slice(pathWithQuery.indexOf("?") + 1) : "";
  const pathname = pathWithQuery.includes("?") ? pathWithQuery.slice(0, pathWithQuery.indexOf("?")) : pathWithQuery;
  const params = new URLSearchParams(q);
  if (sprintId) {
    params.set("sprintId", sprintId);
  } else if (projectId) {
    params.set("projectId", projectId);
  } else if (globalQ && globalQ.mode === "explicit") {
    const sorted = [...new Set(globalQ.pids)].filter(Boolean).sort();
    if (sorted.length) {
      params.set("pids", sorted.join(","));
    }
    params.set("gpf", "1");
    params.set("un", globalQ.includeUnassigned ? "1" : "0");
  }
  if (
    !sprintId &&
    !projectId &&
    globalSprintQ &&
    globalSprintQ.mode === "explicit"
  ) {
    const sortedSprints = [...new Set(globalSprintQ.sprintIds)].filter(Boolean).sort();
    if (sortedSprints.length) {
      params.set("sprintIds", sortedSprints.join(","));
    }
  }
  if (teamSlug) {
    params.set("team", teamSlug);
  }
  if (listFresh) {
    params.set("fresh", "1");
  }
  return params.toString() ? `${pathname}?${params.toString()}` : pathname;
}

export function useTicketsInboxData(options: UseTicketsInboxDataOptions): {
  tickets: TicketRow[];
  archivedTickets: TicketRow[];
  loading: boolean;
  refreshing: boolean;
  loadingArchived: boolean;
  fetchTickets: (opts?: { soft?: boolean }) => Promise<void>;
  fetchArchivedTickets: (opts?: { fresh?: boolean }) => Promise<void>;
  mergeTicketFromPatchReport: (report: TicketReport) => void;
  applyStatusesToTickets: (ids: string[], status: TicketStatus) => void;
} {
  const { canTriage, projectId, sprintId, globalProjectFilterQuery, globalSprintFilterQuery, teamSlug } = options;
  const t = useTranslations("tickets");
  /** `useTranslations` may return a new `t` each render; excluding it from fetchTickets deps avoids aborting in-flight list loads. */
  const tLoadFailedRef = useRef(t);
  useEffect(() => {
    tLoadFailedRef.current = t;
  }, [t]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [archivedTickets, setArchivedTickets] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const fetchGenRef = useRef(0);
  const gpfRef = useRef<GlobalProjectFilterQuery | undefined>(globalProjectFilterQuery);
  const gsfRef = useRef<GlobalSprintFilterQuery | undefined>(globalSprintFilterQuery);
  const teamSlugRef = useRef<string | null | undefined>(teamSlug);
  useEffect(() => {
    gpfRef.current = globalProjectFilterQuery;
  }, [globalProjectFilterQuery]);
  useEffect(() => {
    gsfRef.current = globalSprintFilterQuery;
  }, [globalSprintFilterQuery]);
  useEffect(() => {
    teamSlugRef.current = teamSlug;
  }, [teamSlug]);

  const gpfPidsKey =
    globalProjectFilterQuery && globalProjectFilterQuery.mode === "explicit"
      ? [...new Set(globalProjectFilterQuery.pids)].filter(Boolean).sort().join("\u0001")
      : "";
  const gpfUn: boolean | null =
    globalProjectFilterQuery && globalProjectFilterQuery.mode === "explicit"
      ? globalProjectFilterQuery.includeUnassigned
      : null;
  const gpfModeKey: "" | "all" | "explicit" =
    globalProjectFilterQuery === undefined ? "" : globalProjectFilterQuery.mode === "all" ? "all" : "explicit";

  const gpfKey = useMemo(
    () => globalProjectFilterKeyFromPrimitiveParts(gpfModeKey, gpfPidsKey, gpfUn),
    [gpfModeKey, gpfPidsKey, gpfUn]
  );

  const gsfSidsKey =
    globalSprintFilterQuery && globalSprintFilterQuery.mode === "explicit"
      ? [...new Set(globalSprintFilterQuery.sprintIds)].filter(Boolean).sort().join("\u0001")
      : "";
  const gsfModeKey: "" | "all" | "explicit" =
    globalSprintFilterQuery === undefined ? "" : globalSprintFilterQuery.mode === "all" ? "all" : "explicit";

  const gsfKey = useMemo(
    () => globalSprintFilterKeyFromPrimitiveParts(gsfModeKey, gsfSidsKey),
    [gsfModeKey, gsfSidsKey]
  );

  const fetchTickets = useCallback(
    async (opts?: { soft?: boolean }) => {
      fetchAbortRef.current?.abort();
      const controller = new AbortController();
      fetchAbortRef.current = controller;

      const gen = ++fetchGenRef.current;

      // Tie callback identity to filter keys; URL uses refs so in-flight reads stay current.
      void gpfKey;
      void gsfKey;

      const soft = opts?.soft === true;
      if (soft) setRefreshing(true);
      try {
        const res = await fetch(
          ticketsListUrl("/api/tickets", projectId, sprintId, gpfRef.current, gsfRef.current, teamSlugRef.current, soft),
          { signal: controller.signal, cache: "no-store" }
        );
        if (!res.ok) throw new Error("Failed to load");
        const data = (await res.json()) as { tickets: TicketRow[] | undefined };
        if (gen !== fetchGenRef.current) return;
        setTickets(data.tickets ?? []);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        toast.error(tLoadFailedRef.current("loadFailed"));
      } finally {
        if (gen === fetchGenRef.current) {
          if (!soft) setLoading(false);
          if (soft) setRefreshing(false);
        }
      }
    },
    [projectId, sprintId, gpfKey, gsfKey, teamSlug]
  );

  const fetchArchivedTickets = useCallback(async (opts?: { fresh?: boolean }) => {
    void gpfKey;
    void gsfKey;
    if (!canTriage) return;
    setLoadingArchived(true);
    try {
      const res = await fetch(
        ticketsListUrl(
          "/api/tickets?archived=true",
          projectId,
          sprintId,
          gpfRef.current,
          gsfRef.current,
          teamSlugRef.current,
          opts?.fresh === true
        ),
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = (await res.json()) as { tickets: TicketRow[] | undefined };
      setArchivedTickets(data.tickets ?? []);
    } catch {
      /* silent */
    } finally {
      setLoadingArchived(false);
    }
  }, [canTriage, projectId, sprintId, gpfKey, gsfKey, teamSlug]);

  useEffect(() => {
    void fetchTickets();
    return () => {
      fetchAbortRef.current?.abort();
    };
  }, [fetchTickets]);

  useEffect(() => {
    const onRefresh = () => {
      void fetchTickets({ soft: true });
      if (canTriage) void fetchArchivedTickets({ fresh: true });
    };
    window.addEventListener(TICKETS_INBOX_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(TICKETS_INBOX_REFRESH_EVENT, onRefresh);
  }, [fetchTickets, fetchArchivedTickets, canTriage]);

  const mergeTicketFromPatchReport = useCallback((report: TicketReport) => {
    setTickets((prev) => {
      const idx = prev.findIndex((r) => r.id === report.id);
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = mergeTicketReportIntoRow(next[idx], report);
      return next;
    });
    setArchivedTickets((prev) => {
      const idx = prev.findIndex((r) => r.id === report.id);
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = mergeTicketReportIntoRow(next[idx], report);
      return next;
    });
  }, []);

  const applyStatusesToTickets = useCallback((ids: string[], status: TicketStatus) => {
    const idSet = new Set(ids);
    const apply = (prev: TicketRow[]): TicketRow[] => {
      if (!prev.some((r) => idSet.has(r.id))) return prev;
      return prev.map((r) => (idSet.has(r.id) ? { ...r, status } : r));
    };
    setTickets(apply);
    setArchivedTickets(apply);
  }, []);

  useEffect(() => {
    const onMerge = (ev: Event) => {
      const ce = ev as CustomEvent<TicketReport>;
      const detail = ce.detail;
      if (detail?.id) mergeTicketFromPatchReport(detail);
    };
    window.addEventListener(TICKETS_INBOX_MERGE_EVENT, onMerge);
    return () => window.removeEventListener(TICKETS_INBOX_MERGE_EVENT, onMerge);
  }, [mergeTicketFromPatchReport]);

  return {
    tickets,
    archivedTickets,
    loading,
    refreshing,
    loadingArchived,
    fetchTickets,
    fetchArchivedTickets,
    mergeTicketFromPatchReport,
    applyStatusesToTickets,
  };
}
