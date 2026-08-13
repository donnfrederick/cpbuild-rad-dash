"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { TicketsRefreshingOverlay } from "@/components/tickets/TicketsRefreshingOverlay";
import { TicketBoard } from "@/components/tickets/TicketBoard";
import { TicketInbox } from "@/components/tickets/TicketInbox";
import { useTicketsInboxData } from "@/components/tickets/useTicketsInboxData";
import { useAppUser } from "@/contexts/AppUserContext";
import { useCurrentTeam } from "@/contexts/CurrentTeamContext";
import { hasTicketTriageAccess } from "@/lib/ticket-triage";
import { isSprintRunning } from "@/lib/sprint-active";
import type { SprintApiPayload } from "@/lib/sprint-map";
import {
  pickLatestActivePlanningSprint,
  pickPlanningSprintForProject,
  type PlanningSprintPick,
  sprintApiToPlanningPick,
} from "@/lib/project-planning-sprint";
import type {
  GlobalProjectFilterQuery,
  GlobalSprintFilterQuery,
} from "@/components/tickets/useTicketsInboxData";
import type { TeamBoardStatus, TeamSwimlaneConfig } from "@/components/tickets/ticket-types";

interface TicketsWorkspaceInnerProps {
  projectId?: string | null;
  sprintId?: string | null;
  defaultView?: "list" | "board";
  hideTagFilter?: boolean;
  /** When true, only the board is shown (no list view / no view toggle). */
  hideListView?: boolean;
  variant?: "default" | "globalAllTickets";
}

function TicketsWorkspaceInner({
  projectId,
  sprintId,
  defaultView = "list",
  hideTagFilter = false,
  hideListView = false,
  variant = "default",
}: TicketsWorkspaceInnerProps): React.ReactElement {
  const searchParams = useSearchParams();
  const explicit = searchParams.get("view");
  const view: "board" | "list" = hideListView
    ? "board"
    : variant === "globalAllTickets"
      ? "list"
      : explicit === "board"
        ? "board"
        : explicit === "list"
          ? "list"
          : defaultView === "board"
            ? "board"
            : "list";
  const locale = useLocale();
  const tSprints = useTranslations("sprints");
  const user = useAppUser();
  const { currentTeam } = useCurrentTeam();
  const teamSlug = currentTeam?.teamSlug ?? null;
  const canTriage = hasTicketTriageAccess(user.role, user.specialPermissions);
  const isAdmin = user.role === "ADMIN";
  const [globalProjectQuery, setGlobalProjectQuery] = useState<GlobalProjectFilterQuery>({ mode: "all" });
  const [globalSprintQuery, setGlobalSprintQuery] = useState<GlobalSprintFilterQuery>({ mode: "all" });
  const [allProjectsForFilter, setAllProjectsForFilter] = useState<Array<{ id: string; name: string }>>([]);
  const [allSprintsForFilter, setAllSprintsForFilter] = useState<SprintApiPayload[]>([]);
  const [globalFilterReady, setGlobalFilterReady] = useState(() => variant !== "globalAllTickets");
  const sprintDefaultAppliedRef = useRef(false);

  useEffect(() => {
    if (variant !== "globalAllTickets") {
      setGlobalFilterReady(true);
      return;
    }
    setGlobalFilterReady(false);
    sprintDefaultAppliedRef.current = false;
    setGlobalProjectQuery({ mode: "all" });
    setGlobalSprintQuery({ mode: "all" });
    let cancel = false;
    void (async () => {
      try {
        const teamParam = teamSlug ? `?team=${encodeURIComponent(teamSlug)}` : "";
        const [projRes, sprintRes] = await Promise.all([
          fetch(`/api/projects${teamParam}`),
          fetch(`/api/sprints${teamParam}`, { cache: "no-store" }),
        ]);
        const projData = (await projRes.json()) as { projects: Array<{ id: string; name: string }> };
        if (!cancel) {
          setAllProjectsForFilter((projData.projects ?? []).map((p) => ({ id: p.id, name: p.name })));
        }
        let sprintList: SprintApiPayload[] = [];
        if (sprintRes.ok) {
          try {
            const sprintData = (await sprintRes.json()) as { sprints?: SprintApiPayload[] };
            sprintList = Array.isArray(sprintData.sprints) ? sprintData.sprints : [];
          } catch {
            sprintList = [];
          }
        }
        if (!cancel) {
          setAllSprintsForFilter(sprintList);
        }
      } catch {
        if (!cancel) {
          setAllProjectsForFilter([]);
          setAllSprintsForFilter([]);
        }
      } finally {
        if (!cancel) setGlobalFilterReady(true);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [variant, teamSlug]);

  const inbox = useTicketsInboxData({
    canTriage,
    projectId: sprintId ? undefined : (projectId ?? undefined),
    sprintId: sprintId ?? undefined,
    globalProjectFilterQuery: variant === "globalAllTickets" ? globalProjectQuery : undefined,
    globalSprintFilterQuery: variant === "globalAllTickets" ? globalSprintQuery : undefined,
    teamSlug,
  });

  const [tagFilterOptions, setTagFilterOptions] = useState<Array<{ id: string; name: string }>>([]);
  const tagsPromiseRef = useRef<Promise<void> | null>(null);

  const [boardStatuses, setBoardStatuses] = useState<TeamBoardStatus[]>([]);
  const [swimlaneConfig, setSwimlaneConfig] = useState<TeamSwimlaneConfig | null>(null);
  const boardConfigPromiseRef = useRef<Promise<void> | null>(null);

  const [allowedProjectIds, setAllowedProjectIds] = useState<string[]>([]);
  const [sprintUsesExplicitTicketList, setSprintUsesExplicitTicketList] = useState(false);
  const [sprintBoardReadOnly, setSprintBoardReadOnly] = useState(false);
  const [sprintTicketOrder, setSprintTicketOrder] = useState<Map<string, string[]>>(new Map());
  const [sprintMetaReady, setSprintMetaReady] = useState(() => !sprintId);
  const [planningSprint, setPlanningSprint] = useState<PlanningSprintPick | null>(null);
  const [planningMetaReady, setPlanningMetaReady] = useState(
    () => !projectId || Boolean(sprintId) || variant === "globalAllTickets"
  );

  useEffect(() => {
    if (!projectId || sprintId || variant === "globalAllTickets") {
      setPlanningSprint(null);
      setPlanningMetaReady(true);
      return;
    }
    setPlanningMetaReady(false);
    let cancel = false;
    void (async () => {
      try {
        const res = await fetch("/api/sprints", { cache: "no-store" });
        const data = res.ok ? ((await res.json()) as { sprints?: SprintApiPayload[] }) : { sprints: [] };
        const list = Array.isArray(data.sprints) ? data.sprints : [];
        if (!cancel) {
          setPlanningSprint(pickPlanningSprintForProject(list, projectId));
        }
      } catch {
        if (!cancel) setPlanningSprint(null);
      } finally {
        if (!cancel) setPlanningMetaReady(true);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [projectId, sprintId, variant]);

  useEffect(() => {
    if (!sprintId) {
      setAllowedProjectIds([]);
      setSprintUsesExplicitTicketList(false);
      setSprintBoardReadOnly(false);
      setSprintMetaReady(true);
      return;
    }
    setSprintMetaReady(false);
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/sprints/${encodeURIComponent(sprintId)}`);
        if (!res.ok) {
          if (!cancelled) {
            setAllowedProjectIds([]);
            setSprintUsesExplicitTicketList(false);
            setSprintBoardReadOnly(false);
          }
        } else {
          const data = (await res.json()) as SprintApiPayload;
          if (!cancelled) {
            setAllowedProjectIds((data.projects ?? []).map((p) => p.id));
            setSprintUsesExplicitTicketList(data.usesExplicitTicketList === true);
            setSprintBoardReadOnly(Boolean(data.completedAt));
          }
        }
      } catch {
        if (!cancelled) {
          setAllowedProjectIds([]);
          setSprintUsesExplicitTicketList(false);
          setSprintBoardReadOnly(false);
        }
      } finally {
        if (!cancelled) setSprintMetaReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sprintId]);

  useEffect(() => {
    if (!sprintId) {
      setSprintTicketOrder(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/sprints/${encodeURIComponent(sprintId)}/ticket-order`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          orders: Array<{ statusKey: string; ticketId: string; position: number }>;
        };
        const map = new Map<string, string[]>();
        for (const row of data.orders ?? []) {
          const list = map.get(row.statusKey) ?? [];
          list.push(row.ticketId);
          map.set(row.statusKey, list);
        }
        if (!cancelled) setSprintTicketOrder(map);
      } catch {
        if (!cancelled) setSprintTicketOrder(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sprintId]);

  const globalProjectFilterForInbox = useMemo(
    () =>
      variant === "globalAllTickets"
        ? {
            projectOptions: allProjectsForFilter,
            query: globalProjectQuery,
            onQueryChange: setGlobalProjectQuery,
          }
        : undefined,
    [variant, allProjectsForFilter, globalProjectQuery]
  );

  const activeSprintsToday = useMemo(
    () => allSprintsForFilter.filter((s) => isSprintRunning(s)),
    [allSprintsForFilter]
  );

  const globalSprintFilterForInbox = useMemo(
    () =>
      variant === "globalAllTickets"
        ? {
            sprintOptions: allSprintsForFilter.map((s) => ({
              id: s.id,
              name: s.name,
              isActive: isSprintRunning(s),
            })),
            activeSprints: activeSprintsToday.map((s) => ({ id: s.id, name: s.name })),
            query: globalSprintQuery,
            onQueryChange: setGlobalSprintQuery,
          }
        : undefined,
    [variant, allSprintsForFilter, activeSprintsToday, globalSprintQuery]
  );

  type GlobalPlanningHint =
    | { kind: "fallback"; sprintName: string }
    | { kind: "multiSprint" };

  const globalPlanningResolution = useMemo((): {
    sprint: PlanningSprintPick | null;
    hint: GlobalPlanningHint | undefined;
  } => {
    if (variant !== "globalAllTickets") {
      return { sprint: null, hint: undefined };
    }

    if (globalSprintQuery.mode === "explicit") {
      const ids = [...new Set(globalSprintQuery.sprintIds)].filter(Boolean);
      if (ids.length > 1) {
        return { sprint: null, hint: { kind: "multiSprint" } };
      }
      if (ids.length === 1) {
        const row = allSprintsForFilter.find((s) => s.id === ids[0]);
        return {
          sprint: row ? sprintApiToPlanningPick(row) : null,
          hint: undefined,
        };
      }
      return { sprint: null, hint: undefined };
    }

    if (globalProjectQuery.mode === "explicit") {
      const pids = [...new Set(globalProjectQuery.pids)].filter(Boolean);
      if (pids.length === 1) {
        return {
          sprint: pickPlanningSprintForProject(allSprintsForFilter, pids[0]),
          hint: undefined,
        };
      }
    }

    const fb = pickLatestActivePlanningSprint(allSprintsForFilter);
    if (!fb) {
      return { sprint: null, hint: undefined };
    }
    return {
      sprint: fb,
      hint: { kind: "fallback", sprintName: fb.name },
    };
  }, [variant, globalSprintQuery, globalProjectQuery, allSprintsForFilter]);

  useEffect(() => {
    if (tagsPromiseRef.current) return;
    tagsPromiseRef.current = fetch("/api/tags?limit=500")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("tags"))))
      .then((data: { tags?: Array<{ id: string; name: string }> }) => {
        setTagFilterOptions(data.tags ?? []);
      })
      .catch(() => {
        setTagFilterOptions([]);
      });
  }, []);

  const currentTeamId = currentTeam?.teamId ?? null;

  useEffect(() => {
    if (!currentTeamId) return;
    boardConfigPromiseRef.current = null;
    if (boardConfigPromiseRef.current) return;
    boardConfigPromiseRef.current = Promise.all([
      fetch(`/api/teams/${encodeURIComponent(currentTeamId)}/board-statuses`),
      fetch(`/api/teams/${encodeURIComponent(currentTeamId)}/swimlane-config`),
    ])
      .then(async ([statusRes, swimRes]) => {
        if (statusRes.ok) {
          const data = (await statusRes.json()) as { boardStatuses?: TeamBoardStatus[] };
          setBoardStatuses(data.boardStatuses ?? []);
        }
        if (swimRes.ok) {
          const data = (await swimRes.json()) as { swimlaneConfig?: TeamSwimlaneConfig | null };
          setSwimlaneConfig(data.swimlaneConfig ?? null);
        }
      })
      .catch(() => {
        setBoardStatuses([]);
        setSwimlaneConfig(null);
      });
  }, [currentTeamId]);

  if (
    inbox.loading ||
    !sprintMetaReady ||
    !planningMetaReady ||
    (variant === "globalAllTickets" && !globalFilterReady)
  ) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const createSprintLinkId =
    sprintId && canTriage && sprintUsesExplicitTicketList && !sprintBoardReadOnly ? sprintId : undefined;

  if (view === "board") {
    const board = (
      <TicketBoard
        locale={locale}
        currentUserId={user.id}
        canTriage={canTriage}
        isAdmin={isAdmin}
        tickets={inbox.tickets}
        fetchTickets={inbox.fetchTickets}
        projectId={projectId ?? undefined}
        tagFilterOptions={tagFilterOptions}
        hideTagFilter={hideTagFilter}
        allowedProjectIds={sprintId ? allowedProjectIds : undefined}
        sprintId={createSprintLinkId}
        hideListView={hideListView}
        addExistingSprintId={
          sprintId && canTriage && sprintUsesExplicitTicketList && !sprintBoardReadOnly ? sprintId : undefined
        }
        boardBackLink={
          sprintId ? { href: "/sprints", label: tSprints("backToSprintList") } : undefined
        }
        mergeTicketFromPatchReport={inbox.mergeTicketFromPatchReport}
        applyStatusesToTickets={inbox.applyStatusesToTickets}
        boardStatuses={boardStatuses}
        swimlaneConfig={swimlaneConfig}
        teamId={currentTeamId ?? undefined}
        onBoardConfigChange={(statuses, swimlane) => {
          setBoardStatuses(statuses);
          if (swimlane !== undefined) setSwimlaneConfig(swimlane);
        }}
        sprintBoardReadOnly={sprintBoardReadOnly}
        boardSprintId={sprintId ?? undefined}
        sprintTicketOrder={sprintId ? sprintTicketOrder : undefined}
      />
    );
    return sprintId ? (
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {board}
        {inbox.refreshing ? <TicketsRefreshingOverlay /> : null}
      </div>
    ) : (
      <>
        {board}
        {inbox.refreshing ? <TicketsRefreshingOverlay /> : null}
      </>
    );
  }

  return (
    <>
      <TicketInbox
        locale={locale}
        currentUserId={user.id}
        canTriage={canTriage}
        isAdmin={isAdmin}
        tickets={inbox.tickets}
        archivedTickets={inbox.archivedTickets}
        loadingArchived={inbox.loadingArchived}
        refreshing={inbox.refreshing}
        fetchTickets={inbox.fetchTickets}
        fetchArchivedTickets={inbox.fetchArchivedTickets}
        projectId={projectId ?? undefined}
        tagFilterOptions={tagFilterOptions}
        hideTagFilter={hideTagFilter}
        allowedProjectIds={sprintId ? allowedProjectIds : undefined}
        sprintId={sprintId ?? undefined}
        sprintUsesExplicitTicketList={sprintId ? sprintUsesExplicitTicketList : false}
        hideBoardToggle={variant === "globalAllTickets"}
        hideInboxScopeTabs={variant === "globalAllTickets"}
        globalProjectFilter={globalProjectFilterForInbox}
        globalSprintFilter={globalSprintFilterForInbox}
        showPointsSummary={variant === "globalAllTickets"}
        inboxVariant={variant === "globalAllTickets" ? "globalAllTickets" : "default"}
        globalPlanningHint={
          variant === "globalAllTickets" ? globalPlanningResolution.hint : undefined
        }
        planningSprint={
          variant === "globalAllTickets"
            ? globalPlanningResolution.sprint
            : projectId && !sprintId
              ? planningSprint
              : undefined
        }
        mergeTicketFromPatchReport={inbox.mergeTicketFromPatchReport}
        teamId={currentTeamId ?? undefined}
      />
      {inbox.refreshing ? <TicketsRefreshingOverlay /> : null}
    </>
  );
}

export interface TicketsWorkspaceProps {
  projectId?: string | null;
  sprintId?: string | null;
  defaultView?: "list" | "board";
  hideTagFilter?: boolean;
  hideListView?: boolean;
  variant?: "default" | "globalAllTickets";
}

export function TicketsWorkspace({
  projectId,
  sprintId,
  defaultView = "list",
  hideTagFilter = false,
  hideListView = false,
  variant = "default",
}: TicketsWorkspaceProps): React.ReactElement {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <TicketsWorkspaceInner
        projectId={projectId}
        sprintId={sprintId}
        defaultView={defaultView}
        hideTagFilter={hideTagFilter}
        hideListView={hideListView}
        variant={variant}
      />
    </Suspense>
  );
}
