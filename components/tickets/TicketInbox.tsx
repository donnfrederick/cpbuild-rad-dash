"use client";

import type { Dispatch, MutableRefObject, MouseEvent, SetStateAction } from "react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ChevronDown,
  LayoutGrid,
  List,
  Loader2,
  Inbox,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { usePathname, useRouter } from "@/i18n/navigation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  filterTicketInboxRows,
  type TicketInboxPriorityFilter,
  type TicketInboxTypeFilter,
  type TicketInboxView,
} from "@/lib/ticket-inbox-filters";
import { TicketTagFilterMultiSelect } from "@/components/tickets/TicketTagFilterMultiSelect";
import { parseDisplayTicketRef, parseTicketRefLabel } from "@/components/tickets/ticket-utils";
import { TicketProjectFilterMultiSelect } from "@/components/tickets/TicketProjectFilterMultiSelect";
import {
  TicketSprintFilterMultiSelect,
  type SprintFilterOption,
} from "@/components/tickets/TicketSprintFilterMultiSelect";
import { Link } from "@/i18n/navigation";
import type {
  GlobalProjectFilterQuery,
  GlobalSprintFilterQuery,
} from "@/components/tickets/useTicketsInboxData";
import { parseTagInput } from "@/lib/tag-normalize";
import { CreateTicketDialog } from "@/components/tickets/CreateTicketDialog";
import { TicketDetailView } from "@/components/tickets/TicketDetailView";
import { TicketInboxPlanningDropZone } from "@/components/tickets/TicketInboxPlanningDropZone";
import { TicketInboxPlanningOverlayCard } from "@/components/tickets/TicketInboxPlanningOverlayCard";
import {
  TicketInboxTicketRow,
  type TicketInboxRowZone,
} from "@/components/tickets/TicketInboxTicketRow";
import {
  TicketPlanningRowContextMenu,
  type PlanningRowContextZone,
} from "@/components/tickets/TicketPlanningRowContextMenu";
import type { TicketReport, TicketRow, TicketStatus } from "@/components/tickets/ticket-types";
import { TICKET_STATUS_ORDER } from "@/lib/ticket-status";
import {
  ticketInPlanningSprint,
  type PlanningSprintPick,
} from "@/lib/project-planning-sprint";

type TicketInboxBulkPanelScope = "all" | "planningSprint" | "planningBacklog";

interface BulkApiResultRow {
  id: string;
  ok: boolean;
  error?: string;
}

export type { TicketRow };

export interface TicketInboxProps {
  locale: string;
  currentUserId: string;
  canTriage: boolean;
  isAdmin: boolean;
  tickets: TicketRow[];
  archivedTickets: TicketRow[];
  loadingArchived: boolean;
  refreshing: boolean;
  fetchTickets: (opts?: { soft?: boolean }) => Promise<void>;
  fetchArchivedTickets: (opts?: { fresh?: boolean }) => Promise<void>;
  /** When set, inbox is scoped to this project (hides redundant project chip where applicable). */
  projectId?: string;
  /** Tag catalog shared from TicketsWorkspace — fetched once, passed to both list and board. */
  tagFilterOptions: Array<{ id: string; name: string }>;
  /** When true, hides tag filter controls (e.g. sprint workspace). */
  hideTagFilter?: boolean;
  /** When set (multi-project sprint), new ticket dialog limits project choice to these IDs. */
  allowedProjectIds?: string[];
  /** Global /tickets: hide list/board and All/Mine. */
  hideBoardToggle?: boolean;
  hideInboxScopeTabs?: boolean;
  /** All-tickets project filter; when set, shows Project in the filter row. */
  globalProjectFilter?: {
    projectOptions: Array<{ id: string; name: string }>;
    query: GlobalProjectFilterQuery;
    onQueryChange: (q: GlobalProjectFilterQuery) => void;
  };
  /** All-tickets sprint filter; when set, shows the active-sprint banner and Sprint multi-select. */
  globalSprintFilter?: {
    sprintOptions: ReadonlyArray<SprintFilterOption>;
    activeSprints: ReadonlyArray<{ id: string; name: string }>;
    query: GlobalSprintFilterQuery;
    onQueryChange: (q: GlobalSprintFilterQuery) => void;
  };
  /** When true, render a story-points summary pill near the list header. */
  showPointsSummary?: boolean;
  /**
   * Project tickets page: active sprint for this project, or `null` if none today.
   * Global `/tickets`: resolved sprint for backlog split, or `null` if none / multi-sprint filter.
   * When `undefined`, sprint planning UI is hidden (sprint-scoped route).
   */
  planningSprint?: PlanningSprintPick | null;
  /**
   * General tickets page: scope hint when the planning sprint is inferred (all filters) or planning
   * is disabled (multiple sprints selected).
   */
  globalPlanningHint?: { kind: "fallback"; sprintName: string } | { kind: "multiSprint" };
  /** `globalAllTickets` enables sprint/backlog split using `planningSprint` without a route `projectId`. */
  inboxVariant?: "default" | "globalAllTickets";
  /** Set when the inbox is scoped to a sprint route (`/sprints/.../tickets`). */
  sprintId?: string;
  /**
   * From GET `/api/sprints/[id]`. When true, the sprint board uses a picked list of tickets; triage
   * can add more via API. When false, all tickets from linked projects are included—no add-to-sprint step.
   */
  sprintUsesExplicitTicketList?: boolean;
  /** Merge PATCH payloads into list state before refetch. */
  mergeTicketFromPatchReport?: (report: TicketReport) => void;
  teamId?: string;
}

type FilterStatus = "ALL" | TicketStatus | "ARCHIVED_TAB";

const SELECT_CLASS =
  "min-h-(--input-height) min-w-[7.5rem] rounded-sm border border-border bg-card px-2 py-1.5 text-sm text-foreground shadow-(--shadow-1)";

function statusFilterLabel(t: (key: string) => string, status: TicketStatus): string {
  const keys: Partial<Record<string, string>> = {
    BACKLOG: "statusBacklog",
    READY: "statusReady",
    IN_PROGRESS: "statusInProgress",
    FOR_REVIEW: "statusForReview",
    RESOLVED: "statusResolved",
    TO_BE_DEPLOYED: "statusToBeDeployed",
    DONE: "statusDone",
    ARCHIVED: "statusArchived",
  };
  const i18nKey = keys[status];
  if (i18nKey) return t(i18nKey);
  return status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Reads `?open=` without forcing the whole inbox behind a route-level Suspense fallback. */
function TicketInboxOpenParamSync({
  tickets,
  selectedId,
  setSelectedId,
  setLoadingDetail,
  router,
  pathname,
  closingModalRef,
}: {
  tickets: TicketRow[];
  selectedId: string | null;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setLoadingDetail: Dispatch<SetStateAction<boolean>>;
  router: { replace: (href: string) => void };
  pathname: string;
  closingModalRef: MutableRefObject<boolean>;
}): null {
  const searchParams = useSearchParams();
  const openParam = searchParams.get("open");

  useEffect(() => {
    if (!openParam) {
      closingModalRef.current = false;
      return;
    }
    if (closingModalRef.current) return;

    if (selectedId === openParam) return;

    const fromList = tickets.find((r) => r.id === openParam);
    if (fromList) {
      setSelectedId(fromList.id);
      return;
    }

    let cancelled = false;
    setLoadingDetail(true);
    void (async () => {
      try {
        const res = await fetch(`/api/tickets/${encodeURIComponent(openParam)}`);
        if (!res.ok) {
          if (res.status === 404) router.replace(pathname);
          return;
        }
        if (!cancelled) setSelectedId(openParam);
      } catch {
        /* silent */
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openParam, tickets, selectedId, router, pathname, closingModalRef, setSelectedId, setLoadingDetail]);

  return null;
}

export function TicketInbox({
  locale,
  currentUserId,
  canTriage,
  isAdmin,
  tickets,
  archivedTickets,
  loadingArchived,
  refreshing: _refreshing,
  fetchTickets,
  fetchArchivedTickets,
  projectId: scopedProjectId,
  tagFilterOptions,
  hideTagFilter = false,
  allowedProjectIds,
  hideBoardToggle = false,
  hideInboxScopeTabs = false,
  globalProjectFilter,
  globalSprintFilter,
  showPointsSummary = false,
  planningSprint,
  globalPlanningHint,
  inboxVariant = "default",
  sprintId: sprintContextId,
  sprintUsesExplicitTicketList = false,
  mergeTicketFromPatchReport,
  teamId,
}: TicketInboxProps): React.ReactElement {
  const t = useTranslations("tickets");
  const router = useRouter();
  const pathname = usePathname();
  const closingModalRef = useRef(false);

  const [view, setView] = useState<TicketInboxView>("all");
  const effectiveInboxView: TicketInboxView = hideInboxScopeTabs ? "all" : view;
  const [filter, setFilter] = useState<FilterStatus>("ALL");
  const [searchInput, setSearchInput] = useState("");
  const [typeFilter, setTypeFilter] = useState<TicketInboxTypeFilter>("ALL");
  const [priorityFilter, setPriorityFilter] = useState<TicketInboxPriorityFilter>("ALL");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const [createTicketOpen, setCreateTicketOpen] = useState(false);
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
  const [bulkPanelScope, setBulkPanelScope] = useState<TicketInboxBulkPanelScope>("all");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [sprintMembershipSaving, setSprintMembershipSaving] = useState(false);
  const [planningMoveSaving, setPlanningMoveSaving] = useState(false);
  const [planningDragTicket, setPlanningDragTicket] = useState<TicketRow | null>(null);
  const [planningCtxMenu, setPlanningCtxMenu] = useState<{
    x: number;
    y: number;
    ticketId: string;
    rowZone: PlanningRowContextZone;
  } | null>(null);
  const [rowCtxUsersLoading, setRowCtxUsersLoading] = useState(false);
  const [backlogSectionCollapsed, setBacklogSectionCollapsed] = useState(false);
  const backlogSelectAllRef = useRef<HTMLInputElement>(null);
  const [draftStatus, setDraftStatus] = useState("");
  const [draftPriority, setDraftPriority] = useState("");
  const [draftAssignee, setDraftAssignee] = useState("");
  const [draftArchive, setDraftArchive] = useState(false);
  const [draftParentRef, setDraftParentRef] = useState("");
  const [draftProjectId, setDraftProjectId] = useState("");
  const [draftStoryPoints, setDraftStoryPoints] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [draftSprintId, setDraftSprintId] = useState("");
  const [tagMode, setTagMode] = useState<"replace" | "add" | "remove">("replace");
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [sprints, setSprints] = useState<Array<{ id: string; name: string }>>([]);
  const [assignees, setAssignees] = useState<Array<{ id: string; name: string | null; email: string }>>([]);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const searchNormalized = useMemo(() => searchInput.trim().toLowerCase(), [searchInput]);

  const filterCriteria = useMemo(
    () => ({
      view: effectiveInboxView,
      currentUserId,
      typeFilter,
      priorityFilter,
      tagFilter: hideTagFilter ? [] : tagFilter,
      search: searchNormalized,
    }),
    [effectiveInboxView, currentUserId, typeFilter, priorityFilter, hideTagFilter, tagFilter, searchNormalized]
  );

  const basePool = useMemo(
    () => filterTicketInboxRows(tickets, filterCriteria),
    [tickets, filterCriteria]
  );

  const filtered = useMemo(() => {
    if (filter === "ALL") return basePool;
    if (filter === "ARCHIVED_TAB") return [];
    return basePool.filter((r) => r.status === filter);
  }, [basePool, filter]);

  const listBusy = loadingDetail || (filter === "ARCHIVED_TAB" && loadingArchived);

  const planningSplitEnabled = Boolean(
    planningSprint &&
      filter !== "ARCHIVED_TAB" &&
      (Boolean(scopedProjectId) || inboxVariant === "globalAllTickets")
  );

  const sprintActiveList = useMemo(() => {
    if (!planningSplitEnabled || !planningSprint) return [];
    return filtered.filter((r) => ticketInPlanningSprint(r, planningSprint));
  }, [planningSplitEnabled, planningSprint, filtered]);

  const backlogActiveList = useMemo(() => {
    if (!planningSplitEnabled || !planningSprint) return filtered;
    return filtered.filter((r) => !ticketInPlanningSprint(r, planningSprint));
  }, [planningSplitEnabled, planningSprint, filtered]);

  const allBacklogVisibleSelected = useMemo(
    () => backlogActiveList.length > 0 && backlogActiveList.every((r) => selection.has(r.id)),
    [backlogActiveList, selection]
  );
  const someBacklogVisibleSelected = useMemo(
    () => backlogActiveList.some((r) => selection.has(r.id)),
    [backlogActiveList, selection]
  );

  const showProjectPlanningChrome = Boolean(
    inboxVariant !== "globalAllTickets" &&
      scopedProjectId &&
      planningSprint !== undefined &&
      filter !== "ARCHIVED_TAB"
  );

  const filterOptions: { value: FilterStatus; label: string; adminOnly?: boolean }[] = useMemo(
    () => [
      { value: "ALL", label: t("filterAll") },
      ...TICKET_STATUS_ORDER.filter((s) => s !== "ARCHIVED").map((s) => ({
        value: s,
        label: statusFilterLabel(t, s),
      })),
      { value: "ARCHIVED_TAB", label: t("archivedTabLabel"), adminOnly: true },
    ],
    [t]
  );

  const assignedToMeCount = useMemo(
    () => tickets.filter((r) => r.assignee?.id === currentUserId).length,
    [tickets, currentUserId]
  );

  const noMatchesForCountScope =
    !listBusy &&
    (filter === "ARCHIVED_TAB"
      ? archivedTickets.length === 0
      : tickets.length > 0 &&
        !(effectiveInboxView === "mine" && assignedToMeCount === 0) &&
        filtered.length === 0);

  const showPlanningCountScope =
    Boolean(planningSplitEnabled && planningSprint) &&
    !listBusy &&
    tickets.length > 0 &&
    (effectiveInboxView !== "mine" || assignedToMeCount > 0) &&
    !noMatchesForCountScope;

  const counts: Partial<Record<FilterStatus, number>> = useMemo(() => {
    const pool =
      showPlanningCountScope && planningSprint
        ? basePool.filter((r) => !ticketInPlanningSprint(r, planningSprint))
        : basePool;
    const c: Partial<Record<FilterStatus, number>> = {
      ALL: pool.length,
      ARCHIVED_TAB: archivedTickets.length,
    };
    for (const s of TICKET_STATUS_ORDER) {
      c[s] = pool.filter((r) => r.status === s).length;
    }
    return c;
  }, [basePool, archivedTickets, showPlanningCountScope, planningSprint]);

  const projectFilterActive =
    globalProjectFilter && globalProjectFilter.query.mode === "explicit";
  const sprintFilterActive =
    globalSprintFilter && globalSprintFilter.query.mode === "explicit";
  const hasActiveFilters =
    searchNormalized.length > 0 ||
    typeFilter !== "ALL" ||
    priorityFilter !== "ALL" ||
    (!hideTagFilter && tagFilter.length > 0) ||
    Boolean(projectFilterActive) ||
    Boolean(sprintFilterActive);

  const clearFilters = useCallback(() => {
    setSearchInput("");
    setTypeFilter("ALL");
    setPriorityFilter("ALL");
    setTagFilter([]);
    if (globalProjectFilter) {
      globalProjectFilter.onQueryChange({ mode: "all" });
    }
    if (globalSprintFilter) {
      globalSprintFilter.onQueryChange({ mode: "all" });
    }
  }, [globalProjectFilter, globalSprintFilter]);

  const summaryPool = useMemo(
    () => (filter === "ARCHIVED_TAB" ? archivedTickets : basePool),
    [filter, basePool, archivedTickets]
  );

  const pointsSummary = useMemo(() => {
    let total = 0;
    let withoutPoints = 0;
    for (const r of summaryPool) {
      const p = r.storyPoints;
      if (typeof p === "number" && p > 0) {
        total += p;
      } else if (p == null) {
        withoutPoints += 1;
      }
    }
    return { count: summaryPool.length, points: total, withoutPoints };
  }, [summaryPool]);

  useEffect(() => {
    if (filter === "ARCHIVED_TAB") void fetchArchivedTickets();
  }, [filter, fetchArchivedTickets]);

  useEffect(() => {
    setSelection(new Set());
  }, [effectiveInboxView, filter, typeFilter, priorityFilter, tagFilter, searchNormalized]);

  useEffect(() => {
    if (!bulkPanelOpen) return;
    if (assignees.length === 0) {
      void fetch("/api/tickets/assignees")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("assignees"))))
        .then((data: { data: Array<{ id: string; name: string | null; email: string }> }) => {
          setAssignees(data.data ?? []);
        })
        .catch(() => {});
    }
    if (canTriage && projects.length === 0) {
      void fetch("/api/projects")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("projects"))))
        .then((data: { projects?: Array<{ id: string; name: string }> }) => {
          setProjects(data.projects ?? []);
        })
        .catch(() => {});
    }
    if (canTriage && sprints.length === 0) {
      void fetch("/api/sprints", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("sprints"))))
        .then((data: { sprints?: Array<{ id: string; name: string }> }) => {
          setSprints((data.sprints ?? []).map((s) => ({ id: s.id, name: s.name })));
        })
        .catch(() => {});
    }
  }, [bulkPanelOpen, canTriage, assignees.length, projects.length, sprints.length]);

  const openModal = useCallback(
    (id: string) => {
      closingModalRef.current = false;
      setSelectedId(id);
      router.replace(`${pathname}?open=${encodeURIComponent(id)}`);
    },
    [router, pathname]
  );

  const onTicketCreated = useCallback(
    (id: string) => {
      openModal(id);
    },
    [openModal]
  );

  const closeModal = useCallback(() => {
    closingModalRef.current = true;
    setSelectedId(null);
    router.replace(pathname);
  }, [router, pathname]);

  const activeList = useMemo(() => {
    if (filter === "ARCHIVED_TAB") return archivedTickets;
    if (planningSplitEnabled && planningSprint) {
      return [...sprintActiveList, ...backlogActiveList];
    }
    return filtered;
  }, [
    filter,
    archivedTickets,
    planningSplitEnabled,
    planningSprint,
    sprintActiveList,
    backlogActiveList,
    filtered,
  ]);

  const findTicketRow = useCallback(
    (id: string): TicketRow | undefined =>
      activeList.find((r) => r.id === id) ??
      tickets.find((r) => r.id === id) ??
      archivedTickets.find((r) => r.id === id),
    [activeList, tickets, archivedTickets]
  );

  const selectedIds = useMemo(() => [...selection], [selection]);
  const selectionCount = selection.size;

  const selectedBacklogIds = useMemo(() => {
    if (!planningSplitEnabled || !planningSprint) return [];
    return selectedIds.filter((id) => {
      const row = findTicketRow(id);
      return Boolean(row && !ticketInPlanningSprint(row, planningSprint));
    });
  }, [planningSplitEnabled, planningSprint, selectedIds, findTicketRow]);

  const selectedSprintIds = useMemo(() => {
    if (!planningSplitEnabled || !planningSprint) return [];
    return selectedIds.filter((id) => {
      const row = findTicketRow(id);
      return Boolean(row && ticketInPlanningSprint(row, planningSprint));
    });
  }, [planningSplitEnabled, planningSprint, selectedIds, findTicketRow]);

  const bulkPanelEffectiveTargetIds = useMemo(() => {
    if (bulkPanelScope === "planningSprint") return selectedSprintIds;
    if (bulkPanelScope === "planningBacklog") return selectedBacklogIds;
    return selectedIds;
  }, [bulkPanelScope, selectedSprintIds, selectedBacklogIds, selectedIds]);

  const canAssignAllForBulkPanelTargets = useMemo(() => {
    const ids = bulkPanelEffectiveTargetIds;
    if (ids.length === 0) return false;
    for (const id of ids) {
      const row = findTicketRow(id);
      if (!row) return false;
      const isSubmitter = row.user.id === currentUserId;
      if (!isSubmitter && !canTriage) return false;
    }
    return true;
  }, [bulkPanelEffectiveTargetIds, findTicketRow, currentUserId, canTriage]);

  const allVisibleSelected =
    activeList.length > 0 && activeList.every((r) => selection.has(r.id));
  const someVisibleSelected = activeList.some((r) => selection.has(r.id));

  useEffect(() => {
    const el = selectAllRef.current;
    if (el) {
      el.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [someVisibleSelected, allVisibleSelected]);

  useEffect(() => {
    const el = backlogSelectAllRef.current;
    if (!el) return;
    el.indeterminate = someBacklogVisibleSelected && !allBacklogVisibleSelected;
  }, [someBacklogVisibleSelected, allBacklogVisibleSelected]);

  const toggleRowSelected = useCallback((id: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAllVisible = useCallback(() => {
    setSelection((prev) => {
      const next = new Set(prev);
      const allNow = activeList.length > 0 && activeList.every((r) => next.has(r.id));
      if (allNow) {
        for (const r of activeList) next.delete(r.id);
      } else {
        for (const r of activeList) next.add(r.id);
      }
      return next;
    });
  }, [activeList]);

  const toggleSelectAllBacklog = useCallback(() => {
    setSelection((prev) => {
      const next = new Set(prev);
      const allNow = backlogActiveList.length > 0 && backlogActiveList.every((r) => next.has(r.id));
      if (allNow) {
        for (const r of backlogActiveList) next.delete(r.id);
      } else {
        for (const r of backlogActiveList) next.add(r.id);
      }
      return next;
    });
  }, [backlogActiveList]);

  const clearSelection = useCallback(() => setSelection(new Set()), []);

  const moveTicketsToPlanningSprint = useCallback(
    async (ids: string[]) => {
      if (!planningSprint || !canTriage || ids.length === 0) return;
      setPlanningMoveSaving(true);
      try {
        const res = await fetch(`/api/sprints/${encodeURIComponent(planningSprint.id)}/tickets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketIds: ids }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          toast.error(data.error ?? t("addToSprintFailed"));
          return;
        }
        toast.success(t("addToSprintSuccess", { count: ids.length }));
        clearSelection();
        await fetchTickets({ soft: true });
      } catch {
        toast.error(t("addToSprintFailed"));
      } finally {
        setPlanningMoveSaving(false);
      }
    },
    [planningSprint, canTriage, fetchTickets, t, clearSelection]
  );

  const removeTicketsFromPlanningSprint = useCallback(
    async (ids: string[]) => {
      if (!planningSprint || !canTriage || ids.length === 0) return;
      setPlanningMoveSaving(true);
      try {
        const res = await fetch(`/api/sprints/${encodeURIComponent(planningSprint.id)}/tickets`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketIds: ids }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          toast.error(data.error ?? t("removeFromSprintFailed"));
          return;
        }
        toast.success(t("removeFromSprintSuccess", { count: ids.length }));
        clearSelection();
        await fetchTickets({ soft: true });
      } catch {
        toast.error(t("removeFromSprintFailed"));
      } finally {
        setPlanningMoveSaving(false);
      }
    },
    [planningSprint, canTriage, fetchTickets, t, clearSelection]
  );

  const planningSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handlePlanningDragStart = useCallback(
    (event: DragStartEvent) => {
      const raw = String(event.active.id);
      const m = /^planning-(sprint|backlog)-(.+)$/.exec(raw);
      if (!m) return;
      const tid = m[2];
      const row =
        tickets.find((r) => r.id === tid) ?? activeList.find((r) => r.id === tid);
      if (row) setPlanningDragTicket(row);
    },
    [tickets, activeList]
  );

  const handlePlanningDragEnd = useCallback(
    (event: DragEndEvent) => {
      setPlanningDragTicket(null);
      const { active, over } = event;
      if (!over || !planningSprint || !canTriage) return;
      const aid = String(active.id);
      const m = /^planning-(sprint|backlog)-(.+)$/.exec(aid);
      if (!m) return;
      const from = m[1];
      const ticketId = m[2];
      const overId = String(over.id);
      if (overId === "planning-drop-current" && from === "backlog") {
        void moveTicketsToPlanningSprint([ticketId]);
      } else if (overId === "planning-drop-backlog" && from === "sprint") {
        void removeTicketsFromPlanningSprint([ticketId]);
      }
    },
    [planningSprint, canTriage, moveTicketsToPlanningSprint, removeTicketsFromPlanningSprint]
  );

  useEffect(() => {
    if (!planningCtxMenu) return;
    const close = () => setPlanningCtxMenu(null);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") close();
    };
    const timer = window.setTimeout(() => {
      window.addEventListener("click", close);
      window.addEventListener("scroll", close, true);
      window.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [planningCtxMenu]);

  useEffect(() => {
    if (!planningCtxMenu) return;
    let cancelled = false;
    if (assignees.length === 0) {
      setRowCtxUsersLoading(true);
      void fetch("/api/tickets/assignees")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("assignees"))))
        .then((data: { data: Array<{ id: string; name: string | null; email: string }> }) => {
          if (!cancelled) setAssignees(data.data ?? []);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setRowCtxUsersLoading(false);
        });
    } else {
      setRowCtxUsersLoading(false);
    }
    if (canTriage && projects.length === 0) {
      void fetch("/api/projects")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("projects"))))
        .then((data: { projects?: Array<{ id: string; name: string }> }) => {
          if (!cancelled) setProjects(data.projects ?? []);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [planningCtxMenu, assignees.length, projects.length, canTriage]);

  const addSelectedToSprintPlan = useCallback(async () => {
    if (!sprintContextId || !canTriage || !sprintUsesExplicitTicketList || selectionCount === 0) return;
    setSprintMembershipSaving(true);
    try {
      const res = await fetch(
        `/api/sprints/${encodeURIComponent(sprintContextId)}/tickets`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketIds: selectedIds }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string; added?: number };
      if (!res.ok) {
        toast.error(data.error ?? t("addToSprintFailed"));
        return;
      }
      const n = typeof data.added === "number" ? data.added : selectionCount;
      toast.success(t("addToSprintSuccess", { count: n }));
      clearSelection();
      await fetchTickets({ soft: true });
    } catch {
      toast.error(t("addToSprintFailed"));
    } finally {
      setSprintMembershipSaving(false);
    }
  }, [
    sprintContextId,
    canTriage,
    sprintUsesExplicitTicketList,
    selectionCount,
    selectedIds,
    fetchTickets,
    t,
    clearSelection,
  ]);

  const resolveParentFromInput = useCallback(async (raw: string): Promise<{ id: string } | null> => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (parseDisplayTicketRef(trimmed) !== null) {
      const res = await fetch(`/api/tickets/lookup?ref=${encodeURIComponent(trimmed)}`);
      if (!res.ok) return null;
      const j = (await res.json()) as { id: string };
      return { id: j.id };
    }
    const short = parseTicketRefLabel(trimmed);
    if (short !== null) {
      const res = await fetch(`/api/tickets/lookup?shortId=${String(short)}`);
      if (!res.ok) return null;
      const j2 = (await res.json()) as { id: string };
      return { id: j2.id };
    }
    const res = await fetch(`/api/tickets/${encodeURIComponent(trimmed)}`);
    if (!res.ok) return null;
    const j = (await res.json()) as { id: string };
    return { id: j.id };
  }, []);

  const executeBulkRequest = useCallback(async (body: unknown): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch("/api/tickets/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string; results?: BulkApiResultRow[] };
      if (!res.ok) {
        return { ok: false, error: data.error ?? t("bulkFailed") };
      }
      const results = data.results ?? [];
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        return {
          ok: false,
          error: t("bulkPartialSuccess", { ok: results.length - failed.length, failed: failed.length }),
        };
      }
      return { ok: true };
    } catch {
      return { ok: false, error: t("bulkFailed") };
    }
  }, [t]);

  const resetBulkDrafts = useCallback(() => {
    setDraftStatus("");
    setDraftPriority("");
    setDraftAssignee("");
    setDraftArchive(false);
    setDraftParentRef("");
    setDraftProjectId("");
    setDraftStoryPoints("");
    setDraftTags("");
    setDraftSprintId("");
    setTagMode("replace");
  }, []);

  const openBulkPanel = useCallback(
    (scope: TicketInboxBulkPanelScope = "all") => {
      resetBulkDrafts();
      setBulkPanelScope(scope);
      setBulkPanelOpen(true);
    },
    [resetBulkDrafts]
  );

  const handleBulkPanelOpenChange = useCallback(
    (open: boolean) => {
      setBulkPanelOpen(open);
      if (!open) {
        setBulkPanelScope("all");
        resetBulkDrafts();
      }
    },
    [resetBulkDrafts]
  );

  const applyBulkFromPanel = useCallback(async () => {
    const ids = bulkPanelEffectiveTargetIds;
    if (ids.length === 0) return;
    setBulkSaving(true);
    try {
      const ops: unknown[] = [];
      if (draftStatus) {
        ops.push({ action: "setStatus", ticketIds: ids, status: draftStatus });
      }
      if (draftPriority) {
        const priority = draftPriority === "NONE" ? null : (draftPriority as "LOW" | "MEDIUM" | "HIGH");
        ops.push({ action: "setPriority", ticketIds: ids, priority });
      }
      if (draftAssignee) {
        const assigneeId = draftAssignee === "__unassign" ? null : draftAssignee;
        ops.push({ action: "setAssignee", ticketIds: ids, assigneeId });
      }
      if (canTriage && draftProjectId) {
        const projectId = draftProjectId === "__none" ? null : draftProjectId;
        ops.push({ action: "setProject", ticketIds: ids, projectId });
      }
      if (canTriage && draftStoryPoints && draftStoryPoints !== "__nochange") {
        let storyPoints: number | null;
        if (draftStoryPoints === "__clear") {
          storyPoints = null;
        } else {
          const n = Number.parseInt(draftStoryPoints, 10);
          if (Number.isNaN(n) || n < 0 || n > 99) {
            toast.error(t("bulkInvalidStoryPoints"));
            return;
          }
          storyPoints = n;
        }
        ops.push({ action: "setStoryPoints", ticketIds: ids, storyPoints });
      }
      if (canTriage) {
        const tagNames = parseTagInput(draftTags);
        if (tagMode === "replace" || tagNames.length > 0) {
          ops.push({ action: "setTags", ticketIds: ids, mode: tagMode, tagNames });
        }
      }
      if (canTriage && draftParentRef.trim()) {
        const resolved = await resolveParentFromInput(draftParentRef);
        if (!resolved) {
          toast.error(t("bulkParentNotFound"));
          return;
        }
        ops.push({ action: "setParent", ticketIds: ids, parentId: resolved.id });
      }
      if (draftArchive && canTriage) {
        ops.push({ action: "archive", ticketIds: ids });
      }

      const willAssignSprint = canTriage && Boolean(draftSprintId);

      if (ops.length === 0 && !willAssignSprint) {
        toast.info(t("bulkNothingToApply"));
        return;
      }

      for (const body of ops) {
        const r = await executeBulkRequest(body);
        if (!r.ok) {
          toast.error(r.error ?? t("bulkFailed"));
          return;
        }
      }

      if (willAssignSprint) {
        try {
          const sprintRes = await fetch(
            `/api/sprints/${encodeURIComponent(draftSprintId)}/tickets`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ticketIds: ids }),
            }
          );
          if (!sprintRes.ok) {
            const errData = await sprintRes.json().catch(() => ({}));
            toast.error((errData as { error?: string }).error ?? t("addToSprintFailed"));
            return;
          }
        } catch {
          toast.error(t("addToSprintFailed"));
          return;
        }
      }

      toast.success(t("bulkSuccess", { count: ids.length }));
      await fetchTickets({ soft: true });
      if (filter === "ARCHIVED_TAB") void fetchArchivedTickets();
      clearSelection();
      setBulkPanelOpen(false);
      setBulkPanelScope("all");
      resetBulkDrafts();
    } finally {
      setBulkSaving(false);
    }
  }, [
    bulkPanelEffectiveTargetIds,
    draftStatus,
    draftPriority,
    draftAssignee,
    draftArchive,
    draftParentRef,
    draftProjectId,
    draftStoryPoints,
    draftTags,
    draftSprintId,
    tagMode,
    canTriage,
    executeBulkRequest,
    resolveParentFromInput,
    t,
    fetchTickets,
    fetchArchivedTickets,
    filter,
    clearSelection,
    resetBulkDrafts,
  ]);

  const rowPlanningContextMenuHandler = useCallback(
    (report: TicketRow, uiZone: TicketInboxRowZone): ((e: MouseEvent) => void) | undefined => {
      if (filter === "ARCHIVED_TAB") return undefined;
      const canAssignRow = report.user.id === currentUserId || canTriage;
      if (!canTriage && !canAssignRow) return undefined;
      return (e) => {
        e.preventDefault();
        e.stopPropagation();
        const rowZone: PlanningRowContextZone =
          planningSprint &&
          (uiZone === "sprint" || (uiZone === "single" && ticketInPlanningSprint(report, planningSprint)))
            ? "sprint"
            : "backlog";
        setPlanningCtxMenu({
          x: e.clientX,
          y: e.clientY,
          ticketId: report.id,
          rowZone,
        });
      };
    },
    [filter, planningSprint, currentUserId, canTriage]
  );

  const handlePlanningCtxSetStatus = useCallback(
    async (status: TicketStatus) => {
      const menu = planningCtxMenu;
      if (!menu) return;
      const ticketId = menu.ticketId;
      setPlanningCtxMenu(null);
      const r = await executeBulkRequest({
        action: "setStatus",
        ticketIds: [ticketId],
        status,
      });
      if (!r.ok) {
        toast.error(r.error ?? t("bulkFailed"));
        return;
      }
      toast.success(t("bulkSuccess", { count: 1 }));
      await fetchTickets({ soft: true });
      if (filter === "ARCHIVED_TAB") void fetchArchivedTickets();
    },
    [planningCtxMenu, executeBulkRequest, t, fetchTickets, fetchArchivedTickets, filter]
  );

  const handlePlanningCtxSetPriority = useCallback(
    async (priority: "LOW" | "MEDIUM" | "HIGH" | null) => {
      const menu = planningCtxMenu;
      if (!menu) return;
      const ticketId = menu.ticketId;
      setPlanningCtxMenu(null);
      const r = await executeBulkRequest({
        action: "setPriority",
        ticketIds: [ticketId],
        priority,
      });
      if (!r.ok) {
        toast.error(r.error ?? t("bulkFailed"));
        return;
      }
      toast.success(t("bulkSuccess", { count: 1 }));
      await fetchTickets({ soft: true });
      if (filter === "ARCHIVED_TAB") void fetchArchivedTickets();
    },
    [planningCtxMenu, executeBulkRequest, t, fetchTickets, fetchArchivedTickets, filter]
  );

  const handlePlanningCtxSetAssignee = useCallback(
    async (assigneeId: string | null) => {
      const menu = planningCtxMenu;
      if (!menu) return;
      const ticketId = menu.ticketId;
      setPlanningCtxMenu(null);
      const r = await executeBulkRequest({
        action: "setAssignee",
        ticketIds: [ticketId],
        assigneeId,
      });
      if (!r.ok) {
        toast.error(r.error ?? t("bulkFailed"));
        return;
      }
      toast.success(t("bulkSuccess", { count: 1 }));
      await fetchTickets({ soft: true });
      if (filter === "ARCHIVED_TAB") void fetchArchivedTickets();
    },
    [planningCtxMenu, executeBulkRequest, t, fetchTickets, fetchArchivedTickets, filter]
  );

  const handlePlanningCtxSetProject = useCallback(
    async (projectId: string | null) => {
      const menu = planningCtxMenu;
      if (!menu || !canTriage) return;
      const ticketId = menu.ticketId;
      setPlanningCtxMenu(null);
      const r = await executeBulkRequest({
        action: "setProject",
        ticketIds: [ticketId],
        projectId,
      });
      if (!r.ok) {
        toast.error(r.error ?? t("bulkFailed"));
        return;
      }
      toast.success(t("bulkSuccess", { count: 1 }));
      await fetchTickets({ soft: true });
      if (filter === "ARCHIVED_TAB") void fetchArchivedTickets();
    },
    [planningCtxMenu, canTriage, executeBulkRequest, t, fetchTickets, fetchArchivedTickets, filter]
  );

  const emptyMessage = (() => {
    if (listBusy || tickets.length > 0) return null;
    return t("noTickets");
  })();

  const mineEmptyMessage = (() => {
    if (listBusy || tickets.length === 0) return null;
    if (effectiveInboxView !== "mine" || assignedToMeCount > 0) return null;
    return t("inboxMineEmpty");
  })();

  const noMatchesMessage = (() => {
    if (listBusy) return null;
    if (filter === "ARCHIVED_TAB") return archivedTickets.length === 0 ? t("inboxNoMatches") : null;
    if (tickets.length === 0) return null;
    if (effectiveInboxView === "mine" && assignedToMeCount === 0) return null;
    if (filtered.length > 0) return null;
    return t("inboxNoMatches");
  })();

  const goToBoard = useCallback(() => {
    router.replace(`${pathname}?view=board`);
  }, [router, pathname]);

  const showPlanningDnDLayout =
    planningSplitEnabled &&
    planningSprint &&
    !listBusy &&
    !emptyMessage &&
    !mineEmptyMessage &&
    !noMatchesMessage;

  const filterToolbar = (
    <div className="mb-4 flex flex-col gap-4">
        {!hideBoardToggle ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-md border border-border p-1">
                <span className="inline-flex items-center gap-1.5 rounded-sm bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-(--shadow-1)">
                  <List size={14} aria-hidden />
                  {t("viewList")}
                </span>
                <button
                  type="button"
                  onClick={goToBoard}
                  className="inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                >
                  <LayoutGrid size={14} aria-hidden />
                  {t("viewBoard")}
                </button>
              </div>
            </div>

            <div className="flex max-w-full items-center rounded-md p-1">
              {!hideInboxScopeTabs ? (
                <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto" role="tablist" aria-label={t("inboxScopeAria")}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={view === "all"}
                    onClick={() => setView("all")}
                    className={[
                      "relative min-h-[44px] shrink-0 rounded-sm px-3 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      view === "all"
                        ? "bg-background font-semibold text-foreground shadow-(--shadow-2) after:pointer-events-none after:absolute after:inset-x-2 after:bottom-1 after:h-0.5 after:rounded-full after:bg-primary"
                        : "font-medium text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                  >
                    {t("inboxScopeAll")}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={view === "mine"}
                    onClick={() => setView("mine")}
                    className={[
                      "relative min-h-[44px] shrink-0 rounded-sm px-3 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      view === "mine"
                        ? "bg-background font-semibold text-foreground shadow-(--shadow-2) after:pointer-events-none after:absolute after:inset-x-2 after:bottom-1 after:h-0.5 after:rounded-full after:bg-primary"
                        : "font-medium text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                  >
                    {t("inboxScopeMine")}
                    {assignedToMeCount > 0 && (
                      <span className="ml-1 text-muted-foreground">({assignedToMeCount})</span>
                    )}
                  </button>
                </div>
              ) : (
                <div className="min-w-0 flex-1" />
              )}
            </div>
          </>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="ticket-inbox-search" className="text-xs text-muted-foreground">
              {t("searchLabel")}
            </label>
            <input
              id="ticket-inbox-search"
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="min-h-(--input-height) w-full rounded-sm border border-border bg-card px-3 text-sm text-foreground shadow-(--shadow-1)"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="ticket-inbox-type" className="text-xs text-muted-foreground">
                {t("filterTypeLabel")}
              </label>
              <select
                id="ticket-inbox-type"
                className={SELECT_CLASS}
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as TicketInboxTypeFilter)}
              >
                <option value="ALL">{t("filterOptionAllTypes")}</option>
                <option value="BUG">{t("typeBug")}</option>
                <option value="FEATURE_REQUEST">{t("typeFeature")}</option>
                <option value="FEEDBACK">{t("typeFeedback")}</option>
                <option value="MINOR_ENHANCEMENT">{t("typeMinorEnhancement")}</option>
                <option value="REGRESSION">{t("typeRegression")}</option>
                <option value="SECURITY_IMPROVEMENT">{t("typeSecurityImprovement")}</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="ticket-inbox-priority" className="text-xs text-muted-foreground">
                {t("filterPriorityLabel")}
              </label>
              <select
                id="ticket-inbox-priority"
                className={SELECT_CLASS}
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value as TicketInboxPriorityFilter)}
              >
                <option value="ALL">{t("filterAll")}</option>
                <option value="NONE">{t("priorityNone")}</option>
                <option value="LOW">{t("priorityLow")}</option>
                <option value="MEDIUM">{t("priorityMedium")}</option>
                <option value="HIGH">{t("priorityHigh")}</option>
              </select>
            </div>
            {!hideTagFilter ? (
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{t("filterTagLabel")}</span>
                <TicketTagFilterMultiSelect
                  id="ticket-inbox-tag"
                  options={tagFilterOptions}
                  selectedIds={tagFilter}
                  onSelectedIdsChange={setTagFilter}
                  triggerClassName={SELECT_CLASS}
                />
              </div>
            ) : null}
            {globalProjectFilter ? (
              <div className="flex min-w-[8rem] flex-1 flex-col gap-1 sm:max-w-[20rem]">
                <span className="text-xs text-muted-foreground">{t("filterProjectLabel")}</span>
                <TicketProjectFilterMultiSelect
                  id="ticket-inbox-project"
                  projectOptions={globalProjectFilter.projectOptions}
                  query={globalProjectFilter.query}
                  onQueryChange={globalProjectFilter.onQueryChange}
                  triggerClassName={SELECT_CLASS}
                />
              </div>
            ) : null}
            {globalSprintFilter ? (
              <div className="flex min-w-[8rem] flex-1 flex-col gap-1 sm:max-w-[20rem]">
                <span className="text-xs text-muted-foreground">{t("filterSprintLabel")}</span>
                <TicketSprintFilterMultiSelect
                  id="ticket-inbox-sprint"
                  sprintOptions={globalSprintFilter.sprintOptions}
                  query={globalSprintFilter.query}
                  onQueryChange={globalSprintFilter.onQueryChange}
                  triggerClassName={SELECT_CLASS}
                />
              </div>
            ) : null}
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="min-h-[40px] self-end rounded-sm px-2 text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                {t("clearFilters")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex max-w-full flex-col gap-1">
          <div className="flex items-center gap-2">
            <div
              className="flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-md p-1"
              role="tablist"
              aria-label={
                showPlanningCountScope ? t("inboxStatusFilterAriaBacklogCounts") : t("inboxStatusFilterAria")
              }
            >
              {filterOptions
                .filter(({ adminOnly }) => !adminOnly || canTriage)
                .map(({ value, label }) => {
                  const count = counts[value] ?? 0;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={filter === value}
                      onClick={() => setFilter(value)}
                      className={[
                        "min-h-[44px] shrink-0 rounded-sm px-3 py-2 text-xs font-medium transition-colors",
                        filter === value ? "bg-card text-foreground shadow-(--shadow-1)" : "text-muted-foreground hover:text-foreground",
                        value === "ARCHIVED_TAB" ? "border border-dashed border-border" : "",
                      ].join(" ")}
                    >
                      {label}
                      {count > 0 ? <span className="ml-1 text-muted-foreground">({count})</span> : null}
                    </button>
                  );
                })}
            </div>
            {selectionCount > 0 ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
              {sprintContextId && sprintUsesExplicitTicketList && canTriage ? (
                <button
                  type="button"
                  onClick={() => void addSelectedToSprintPlan()}
                  disabled={sprintMembershipSaving}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground shadow-(--shadow-1) hover:bg-muted disabled:opacity-50"
                >
                  {sprintMembershipSaving ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                  ) : null}
                  {t("addToSprintPlan")}
                </button>
              ) : null}
              {!showPlanningDnDLayout && planningSplitEnabled && canTriage && selectedBacklogIds.length > 0 ? (
                <button
                  type="button"
                  onClick={() => void moveTicketsToPlanningSprint(selectedBacklogIds)}
                  disabled={planningMoveSaving}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground shadow-(--shadow-1) hover:bg-muted disabled:opacity-50"
                >
                  {planningMoveSaving ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                  ) : null}
                  {t("planningBulkMoveToSprint")}
                </button>
              ) : null}
              {!showPlanningDnDLayout && planningSplitEnabled && canTriage && selectedSprintIds.length > 0 ? (
                <button
                  type="button"
                  onClick={() => void removeTicketsFromPlanningSprint(selectedSprintIds)}
                  disabled={planningMoveSaving}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground shadow-(--shadow-1) hover:bg-muted disabled:opacity-50"
                >
                  {planningMoveSaving ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                  ) : null}
                  {t("planningBulkRemoveFromSprint")}
                </button>
              ) : null}
              {!showPlanningDnDLayout ? (
                <button
                  type="button"
                  onClick={() => openBulkPanel("all")}
                  className="shrink-0 rounded-sm bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-(--shadow-1) hover:opacity-90"
                >
                  {t("bulkSetAction")}
                </button>
              ) : null}
            </div>
          ) : null}
          </div>
          {showPlanningCountScope ? (
            <p className="px-1 text-[11px] leading-snug text-muted-foreground">
              {t("inboxStatusFilterBacklogCountsVisibleHint")}
            </p>
          ) : null}
        </div>
    </div>
  );

  return (
    <div
      className="w-full min-w-0 py-(--page-padding-y)"
      style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
    >
      {showPlanningDnDLayout ? (
        <DndContext
          sensors={planningSensors}
          collisionDetection={pointerWithin}
          onDragStart={handlePlanningDragStart}
          onDragEnd={handlePlanningDragEnd}
        >
          <div className="flex flex-col gap-5">
            {!planningSprint.usesExplicitTicketList ? (
              <div className="rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
                {t("planningImplicitSprintBanner")}
              </div>
            ) : null}
            <div className="overflow-hidden rounded-lg border border-border border-l-4 border-l-primary bg-card shadow-(--shadow-1)">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/50 px-3 py-2.5">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("planningSprintListLabel")}
                  </span>
                  <div className="flex min-w-0 items-baseline gap-2">
                    <h2 className="truncate text-sm font-semibold text-foreground">{planningSprint.name}</h2>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {t("planningZoneCount", { count: sprintActiveList.length })}
                    </span>
                  </div>
                </div>
                <Link
                  href={`/sprints/${planningSprint.id}/overview`}
                  className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline"
                >
                  {t("planningSprintBoardHint")}
                </Link>
              </div>
              {canTriage && planningSplitEnabled && selectedSprintIds.length > 0 ? (
                <div className="flex flex-wrap items-center justify-end gap-2 border-b border-border bg-muted/25 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => void removeTicketsFromPlanningSprint(selectedSprintIds)}
                    disabled={planningMoveSaving}
                    className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground shadow-(--shadow-1) hover:bg-muted disabled:opacity-50"
                  >
                    {planningMoveSaving ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden />
                    ) : null}
                    {t("planningBulkRemoveFromSprint")}
                  </button>
                  <button
                    type="button"
                    onClick={() => openBulkPanel("planningSprint")}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-sm bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-(--shadow-1) hover:opacity-90"
                    aria-label={t("bulkPanelTitleSprint")}
                  >
                    {t("bulkSetAction")}
                  </button>
                </div>
              ) : null}
              <TicketInboxPlanningDropZone id="planning-drop-current" variant="stacked">
                {sprintActiveList.length === 0 ? (
                  <p className="px-3 py-10 text-center text-xs text-muted-foreground">
                    {t("planningCurrentSprintEmpty")}
                  </p>
                ) : (
                  sprintActiveList.map((report) => (
                    <TicketInboxTicketRow
                      key={report.id}
                      report={report}
                      zone="sprint"
                      planningSprint={planningSprint}
                      planningSplitEnabled={planningSplitEnabled}
                      sprintContextId={sprintContextId}
                      scopedProjectId={scopedProjectId}
                      canTriage={canTriage}
                      selected={selection.has(report.id)}
                      onToggleSelect={() => toggleRowSelected(report.id)}
                      onOpen={() => openModal(report.id)}
                      compactPlanningRow
                      onRowContextMenu={rowPlanningContextMenuHandler(report, "sprint")}
                      teamId={teamId}
                      onStoryPointsPatched={mergeTicketFromPatchReport}
                    />
                  ))
                )}
              </TicketInboxPlanningDropZone>
            </div>
            {filterToolbar}
            {inboxVariant === "globalAllTickets" && globalPlanningHint?.kind === "multiSprint" ? (
              <div className="mb-2 rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                {t("planningGlobalMultiSprintHint")}
              </div>
            ) : null}
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-(--shadow-1)">
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/70 px-2 py-2 sm:gap-3 sm:px-3">
                <button
                  type="button"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
                  aria-expanded={!backlogSectionCollapsed}
                  aria-label={t("planningBacklogToggleAria")}
                  onClick={() => setBacklogSectionCollapsed((c) => !c)}
                >
                  <ChevronDown
                    size={18}
                    className={cn("transition-transform", backlogSectionCollapsed && "-rotate-90")}
                    aria-hidden
                  />
                </button>
                <input
                  ref={backlogSelectAllRef}
                  type="checkbox"
                  checked={allBacklogVisibleSelected}
                  onChange={() => toggleSelectAllBacklog()}
                  disabled={backlogActiveList.length === 0}
                  className="h-4 w-4 shrink-0 rounded border-border"
                  aria-label={t("planningBacklogSelectAllAria")}
                />
                <span className="flex min-w-0 flex-1 text-sm font-semibold leading-snug text-foreground">
                  {t("planningBacklogBarTitle", { count: backlogActiveList.length })}
                </span>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {canTriage && selectedBacklogIds.length > 0 ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void moveTicketsToPlanningSprint(selectedBacklogIds)}
                        disabled={planningMoveSaving}
                        className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-(--shadow-1) hover:bg-muted disabled:opacity-50"
                      >
                        {planningMoveSaving ? (
                          <Loader2 size={14} className="animate-spin" aria-hidden />
                        ) : null}
                        {t("planningBulkMoveToSprint")}
                      </button>
                      <button
                        type="button"
                        onClick={() => openBulkPanel("planningBacklog")}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-(--shadow-1) hover:opacity-90"
                        aria-label={t("bulkPanelTitleBacklog")}
                      >
                        {t("bulkSetAction")}
                      </button>
                    </>
                  ) : null}
                  {selectedBacklogIds.length > 0 ? (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {t("bulkSelectedCountInline", { count: selectedBacklogIds.length })}
                    </span>
                  ) : null}
                </div>
              </div>
              <TicketInboxPlanningDropZone id="planning-drop-backlog" variant="stacked">
                {backlogSectionCollapsed ? (
                  <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                    {t("planningBacklogCollapsedHint")}
                  </p>
                ) : backlogActiveList.length === 0 ? (
                  <p className="px-3 py-10 text-center text-xs text-muted-foreground">{t("planningBacklogEmpty")}</p>
                ) : (
                  backlogActiveList.map((report) => (
                    <TicketInboxTicketRow
                      key={report.id}
                      report={report}
                      zone="backlog"
                      planningSprint={planningSprint}
                      planningSplitEnabled={planningSplitEnabled}
                      sprintContextId={sprintContextId}
                      scopedProjectId={scopedProjectId}
                      canTriage={canTriage}
                      selected={selection.has(report.id)}
                      onToggleSelect={() => toggleRowSelected(report.id)}
                      onOpen={() => openModal(report.id)}
                      compactPlanningRow
                      onRowContextMenu={rowPlanningContextMenuHandler(report, "backlog")}
                      teamId={teamId}
                      onStoryPointsPatched={mergeTicketFromPatchReport}
                    />
                  ))
                )}
              </TicketInboxPlanningDropZone>
            </div>
          </div>
          <DragOverlay dropAnimation={null}>
            {planningDragTicket ? <TicketInboxPlanningOverlayCard ticket={planningDragTicket} /> : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <>
          {filterToolbar}

      {showPointsSummary && !listBusy && (emptyMessage || mineEmptyMessage || noMatchesMessage) ? (
        <div className="mb-2 flex justify-start">
          <div
            className="inline-flex min-h-[40px] items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-foreground tabular-nums"
            aria-live="polite"
          >
            <span className="font-medium">
              {t("pointsSummary", { count: pointsSummary.count, pts: pointsSummary.points })}
            </span>
            {pointsSummary.withoutPoints > 0 ? (
              <span className="text-muted-foreground">
                · {t("pointsSummaryNoPoints", { n: pointsSummary.withoutPoints })}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {inboxVariant === "globalAllTickets" && globalPlanningHint?.kind === "multiSprint" ? (
        <div className="mb-2 rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {t("planningGlobalMultiSprintHint")}
        </div>
      ) : null}

      {listBusy ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      ) : emptyMessage ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
          <Inbox size={32} />
          <p className="text-sm">{emptyMessage}</p>
        </div>
      ) : mineEmptyMessage ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
          <Inbox size={32} />
          <p className="text-sm">{mineEmptyMessage}</p>
        </div>
      ) : noMatchesMessage ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
          <Inbox size={32} />
          <p className="text-sm">{noMatchesMessage}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {showProjectPlanningChrome ? (
            <>
              {planningSprint === null ? (
                <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  {t("planningNoActiveSprintBanner")}
                </div>
              ) : null}
              <h2 className="text-sm font-semibold text-foreground">{t("planningBacklogHeading")}</h2>
            </>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {showPointsSummary ? (
              <div
                className="inline-flex min-h-[40px] items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-foreground tabular-nums"
                title={
                  pointsSummary.withoutPoints > 0
                    ? t("pointsSummaryNoPoints", { n: pointsSummary.withoutPoints })
                    : undefined
                }
                aria-live="polite"
              >
                <span className="font-medium">
                  {t("pointsSummary", { count: pointsSummary.count, pts: pointsSummary.points })}
                </span>
                {pointsSummary.withoutPoints > 0 ? (
                  <span className="text-muted-foreground">
                    · {t("pointsSummaryNoPoints", { n: pointsSummary.withoutPoints })}
                  </span>
                ) : null}
              </div>
            ) : (
              <div />
            )}
            <div className="flex min-h-[40px] max-w-full items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAllVisible}
                disabled={activeList.length === 0}
                className="h-4 w-4 shrink-0 rounded border-border"
                aria-label={t("bulkSelectVisibleAria")}
              />
              <span className="text-xs text-muted-foreground">{t("bulkSelectVisible")}</span>
              <span className="text-xs font-medium text-foreground tabular-nums" aria-live="polite">
                {t("bulkSelectedCountInline", { count: selectionCount })}
              </span>
            </div>
          </div>
          {activeList.map((report) => (
            <TicketInboxTicketRow
              key={report.id}
              report={report}
              zone="single"
              planningSprint={planningSprint}
              planningSplitEnabled={planningSplitEnabled}
              sprintContextId={sprintContextId}
              scopedProjectId={scopedProjectId}
              canTriage={canTriage}
              selected={selection.has(report.id)}
              onToggleSelect={() => toggleRowSelected(report.id)}
              onOpen={() => openModal(report.id)}
              onRowContextMenu={rowPlanningContextMenuHandler(report, "single")}
              teamId={teamId}
              onStoryPointsPatched={mergeTicketFromPatchReport}
            />
          ))}
        </div>
      )}
      </>
      )}

      {typeof document !== "undefined" && planningCtxMenu
        ? createPortal(
            <TicketPlanningRowContextMenu
              key={`${planningCtxMenu.ticketId}-${planningCtxMenu.x}-${planningCtxMenu.y}`}
              x={planningCtxMenu.x}
              y={planningCtxMenu.y}
              rowZone={planningCtxMenu.rowZone}
              canTriage={canTriage}
              showSprintMembershipActions={planningSprint?.usesExplicitTicketList === true}
              assigneesLoading={assignees.length === 0 && rowCtxUsersLoading}
              assignees={assignees}
              projects={projects}
              statusLabel={(s) => statusFilterLabel(t, s)}
              onClose={() => setPlanningCtxMenu(null)}
              onMoveToSprint={() => {
                const m = planningCtxMenu;
                setPlanningCtxMenu(null);
                if (m) void moveTicketsToPlanningSprint([m.ticketId]);
              }}
              onRemoveFromSprint={() => {
                const m = planningCtxMenu;
                setPlanningCtxMenu(null);
                if (m) void removeTicketsFromPlanningSprint([m.ticketId]);
              }}
              onSetStatus={(status) => void handlePlanningCtxSetStatus(status)}
              onSetPriority={(priority) => void handlePlanningCtxSetPriority(priority)}
              onSetAssignee={(assigneeId) => void handlePlanningCtxSetAssignee(assigneeId)}
              onSetProject={(projectId) => void handlePlanningCtxSetProject(projectId)}
            />,
            document.body
          )
        : null}

      <Dialog open={bulkPanelOpen} onOpenChange={handleBulkPanelOpenChange}>
        <DialogContent
          showCloseButton={false}
          className={cn(
            "fixed! inset-y-0! top-0! right-0! bottom-0! left-auto! h-full! max-h-none! w-full! max-w-md! translate-x-0! translate-y-0! rounded-none! border-l p-0! shadow-xl! sm:max-w-md!"
          )}
        >
          <div className="flex h-full max-h-dvh flex-col">
            <DialogHeader className="shrink-0 border-b border-border px-4 py-3 text-left">
              <DialogTitle>
                {bulkPanelScope === "planningSprint"
                  ? t("bulkPanelTitleSprint")
                  : bulkPanelScope === "planningBacklog"
                    ? t("bulkPanelTitleBacklog")
                    : t("bulkPanelTitle")}
              </DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <details className="mb-4 rounded-md border border-border bg-muted/20 p-2">
                <summary className="cursor-pointer text-sm font-medium text-foreground">
                  {t("bulkPanelSelectedTickets", { count: bulkPanelEffectiveTargetIds.length })}
                </summary>
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                  {bulkPanelEffectiveTargetIds.map((id) => {
                    const row = findTicketRow(id);
                    return (
                      <li key={id} className="truncate font-mono">
                        {row ? (
                          <>
                            {row.ref} — {row.title}
                          </>
                        ) : (
                          t("bulkPanelTicketMissing")
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>

              <div className="flex flex-col gap-3 text-sm">
                {canTriage ? (
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{t("bulkActionStatus")}</span>
                    <select
                      className={SELECT_CLASS}
                      value={draftStatus}
                      onChange={(e) => setDraftStatus(e.target.value)}
                    >
                      <option value="">{t("bulkNoChange")}</option>
                      {TICKET_STATUS_ORDER.map((s) => (
                        <option key={s} value={s}>
                          {statusFilterLabel(t, s)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {canTriage ? (
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{t("bulkActionPriority")}</span>
                    <select
                      className={SELECT_CLASS}
                      value={draftPriority}
                      onChange={(e) => setDraftPriority(e.target.value)}
                    >
                      <option value="">{t("bulkNoChange")}</option>
                      <option value="NONE">{t("priorityNone")}</option>
                      <option value="LOW">{t("priorityLow")}</option>
                      <option value="MEDIUM">{t("priorityMedium")}</option>
                      <option value="HIGH">{t("priorityHigh")}</option>
                    </select>
                  </label>
                ) : null}
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{t("bulkActionAssign")}</span>
                  <select
                    className={SELECT_CLASS}
                    disabled={!canAssignAllForBulkPanelTargets}
                    value={draftAssignee}
                    title={!canAssignAllForBulkPanelTargets ? t("bulkAssignDisabledHint") : undefined}
                    onChange={(e) => setDraftAssignee(e.target.value)}
                  >
                    <option value="">{t("bulkNoChange")}</option>
                    <option value="__unassign">{t("assigneeUnassigned")}</option>
                    {assignees.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name ?? u.email}
                      </option>
                    ))}
                  </select>
                </label>
                {canTriage ? (
                  <>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">{t("projectLabel")}</span>
                      <select
                        className={SELECT_CLASS}
                        value={draftProjectId}
                        onChange={(e) => setDraftProjectId(e.target.value)}
                      >
                        <option value="">{t("bulkNoChange")}</option>
                        <option value="__none">{t("projectNone")}</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">{t("bulkSprintLabel")}</span>
                      <select
                        className={SELECT_CLASS}
                        value={draftSprintId}
                        onChange={(e) => setDraftSprintId(e.target.value)}
                      >
                        <option value="">{t("bulkNoChange")}</option>
                        {sprints.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex flex-col gap-1">
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground">{t("storyPointsLabel")}</span>
                        <input
                          type="number"
                          min={0}
                          max={99}
                          step={1}
                          inputMode="numeric"
                          className={SELECT_CLASS}
                          placeholder={t("bulkNoChange")}
                          disabled={draftStoryPoints === "__clear"}
                          value={draftStoryPoints === "__clear" ? "" : draftStoryPoints}
                          onChange={(e) => setDraftStoryPoints(e.target.value)}
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={draftStoryPoints === "__clear"}
                          onChange={(e) =>
                            setDraftStoryPoints(e.target.checked ? "__clear" : "")
                          }
                          className="rounded border-border"
                        />
                        {t("bulkStoryPointsClearLabel")}
                      </label>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">{t("tagsLabel")}</span>
                      <select
                        className={`${SELECT_CLASS} mb-1`}
                        value={tagMode}
                        onChange={(e) => setTagMode(e.target.value as "replace" | "add" | "remove")}
                      >
                        <option value="replace">{t("bulkTagsModeReplace")}</option>
                        <option value="add">{t("bulkTagsModeAdd")}</option>
                        <option value="remove">{t("bulkTagsModeRemove")}</option>
                      </select>
                      <textarea
                        value={draftTags}
                        onChange={(e) => setDraftTags(e.target.value)}
                        placeholder={t("tagsPlaceholder")}
                        rows={2}
                        className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground"
                      />
                    </div>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">{t("bulkSetParentLabel")}</span>
                      <input
                        type="text"
                        value={draftParentRef}
                        onChange={(e) => setDraftParentRef(e.target.value)}
                        placeholder={t("bulkSetParentPlaceholder")}
                        className="min-h-(--input-height) w-full rounded-sm border border-border bg-card px-2 text-xs"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={draftArchive}
                        onChange={(e) => setDraftArchive(e.target.checked)}
                        className="rounded border-border"
                      />
                      {t("bulkArchive")}
                    </label>
                  </>
                ) : null}
              </div>
            </div>
            <DialogFooter className="shrink-0 gap-2 border-t border-border px-4 py-3 sm:justify-between">
              <button
                type="button"
                className="rounded-sm border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
                disabled={bulkSaving}
                onClick={() => handleBulkPanelOpenChange(false)}
              >
                {t("bulkCancel")}
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-sm border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
                  disabled={bulkSaving}
                  onClick={() => clearSelection()}
                >
                  {t("bulkClearSelection")}
                </button>
                <button
                  type="button"
                  className="rounded-sm bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  disabled={bulkSaving}
                  onClick={() => void applyBulkFromPanel()}
                >
                  {bulkSaving ? t("bulkApplying") : t("bulkSave")}
                </button>
              </div>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <CreateTicketDialog
        open={createTicketOpen}
        onOpenChange={setCreateTicketOpen}
        projectId={scopedProjectId}
        allowedProjectIds={allowedProjectIds}
        sprintId={
          canTriage && sprintContextId && sprintUsesExplicitTicketList ? sprintContextId : undefined
        }
        canTriage={canTriage}
        fetchTickets={fetchTickets}
        onCreated={onTicketCreated}
      />

      {selectedId && (
        <TicketDetailView
          variant="modal"
          ticketId={selectedId}
          locale={locale}
          canTriage={canTriage}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          onUpdate={async () => {
            if (filter === "ARCHIVED_TAB") void fetchArchivedTickets();
          }}
          onRequestClose={closeModal}
        />
      )}

      <Suspense fallback={null}>
        <TicketInboxOpenParamSync
          tickets={tickets}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          setLoadingDetail={setLoadingDetail}
          router={router}
          pathname={pathname}
          closingModalRef={closingModalRef}
        />
      </Suspense>
    </div>
  );
}
