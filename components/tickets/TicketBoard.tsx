"use client";

import type { CSSProperties, Dispatch, MutableRefObject, ReactNode, SetStateAction } from "react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  DndContext,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  ArrowUpDown,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  GitPullRequest,
  GripVertical,
  LayoutGrid,
  Lightbulb,
  List,
  ListPlus,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import type { TicketReport, TicketRow, TeamBoardStatus, TeamSwimlaneConfig, SwimlaneBy } from "@/components/tickets/ticket-types";
import type { TicketStatus } from "@/components/tickets/ticket-types";
import { CreateTicketDialog } from "@/components/tickets/CreateTicketDialog";
import { AddExistingTicketsToSprintDialog } from "@/components/tickets/AddExistingTicketsToSprintDialog";
import { TicketDetailView, TicketPriorityBadge, TicketStatusBadge } from "@/components/tickets/TicketDetailView";
import { StoryPointsInlineEdit } from "@/components/tickets/StoryPointsInlineEdit";
import {
  filterTicketInboxRows,
  type TicketInboxPriorityFilter,
  type TicketInboxTypeFilter,
  type TicketInboxView,
} from "@/lib/ticket-inbox-filters";
import { TicketTagFilterMultiSelect } from "@/components/tickets/TicketTagFilterMultiSelect";
import { BoardSettingsPanel } from "@/components/tickets/BoardSettingsPanel";
import { SwimlaneRow } from "@/components/tickets/SwimlaneRow";
import {
  applyCardOrder,
  mergeColumnTicketIds,
} from "@/lib/sprint-board-ticket-order";
import { DEFAULT_BOARD_STATUS_KEYS, DEFAULT_COLUMN_KEYS } from "@/lib/ticket-status";
import { cn } from "@/lib/utils";

const SELECT_CLASS =
  "min-h-(--input-height) min-w-[7.5rem] rounded-sm border border-border bg-card px-2 py-1.5 text-sm text-foreground shadow-(--shadow-1)";


interface ColumnDragSession {
  activeId: string;
  status: string;
  baselineIds: string[];
}

const SWIMLANE_OPTIONS: { value: SwimlaneBy; label: string }[] = [
  { value: "NONE", label: "No Swimlane" },
  { value: "ASSIGNEE", label: "By Assignee" },
  { value: "TYPE", label: "By Type" },
  { value: "PRIORITY", label: "By Priority" },
  { value: "PROJECT", label: "By Project" },
];

/** Stable when tag UI is hidden — avoids new `[]` each render breaking `filterCriteria` memo deps. */
const EMPTY_TAG_FILTER: string[] = [];

type ColumnSortOption =
  | "default"
  | "priority_high_low"
  | "priority_low_high"
  | "date_newest"
  | "date_oldest"
  | "title_az"
  | "title_za"
  | "story_points_high"
  | "story_points_low";

const COLUMN_SORT_OPTIONS: { value: ColumnSortOption; label: string }[] = [
  { value: "priority_high_low", label: "Priority: High → Low" },
  { value: "priority_low_high", label: "Priority: Low → High" },
  { value: "date_newest", label: "Date: Newest first" },
  { value: "date_oldest", label: "Date: Oldest first" },
  { value: "title_az", label: "Title: A → Z" },
  { value: "title_za", label: "Title: Z → A" },
  { value: "story_points_high", label: "Story points: High → Low" },
  { value: "story_points_low", label: "Story points: Low → High" },
];

const PRIORITY_RANK: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

function applyColumnSort(tickets: TicketRow[], sort: ColumnSortOption): TicketRow[] {
  if (sort === "default") return tickets;
  return [...tickets].sort((a, b) => {
    switch (sort) {
      case "priority_high_low":
        return (PRIORITY_RANK[b.priority ?? ""] ?? 0) - (PRIORITY_RANK[a.priority ?? ""] ?? 0);
      case "priority_low_high":
        return (PRIORITY_RANK[a.priority ?? ""] ?? 0) - (PRIORITY_RANK[b.priority ?? ""] ?? 0);
      case "date_newest":
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      case "date_oldest":
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      case "title_az":
        return a.title.localeCompare(b.title);
      case "title_za":
        return b.title.localeCompare(a.title);
      case "story_points_high":
        return (b.storyPoints ?? 0) - (a.storyPoints ?? 0);
      case "story_points_low":
        return (a.storyPoints ?? 0) - (b.storyPoints ?? 0);
      default:
        return 0;
    }
  });
}

/** Ellipsis dropdown menu on each kanban column header. */
function ColumnMenu({
  status,
  teamId,
  boardStatusId,
  tickets,
  activeStatuses,
  statusLabelMap,
  currentSort,
  onAddTicket,
  onMoveAll,
  onDisable,
  onDelete,
  onSort,
}: {
  status: string;
  teamId: string;
  boardStatusId: string;
  tickets: TicketRow[];
  activeStatuses: TeamBoardStatus[];
  statusLabelMap: Map<string, string>;
  currentSort: ColumnSortOption;
  onAddTicket: () => void;
  onMoveAll: (targetStatus: string) => void;
  onDisable: () => void;
  onDelete: () => void;
  onSort: (sort: ColumnSortOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<"move" | "sort" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSubmenu(null);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  const otherStatuses = activeStatuses.filter((s) => s.key !== status);
  const isSorted = currentSort !== "default";

  return (
    <div
      ref={menuRef}
      className="relative shrink-0"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setSubmenu(null); }}
        className={cn(
          "inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground group-hover/col-header:opacity-100",
          isSorted ? "opacity-100 text-primary" : "opacity-0"
        )}
        aria-label="Column actions"
      >
        {isSorted ? <ArrowUpDown size={12} aria-hidden /> : <MoreHorizontal size={14} aria-hidden />}
      </button>

      {open && (
        <div className="absolute right-0 top-7 z-50 min-w-[210px] rounded-md border border-border bg-popover py-1 shadow-lg">
          {submenu === null ? (
            <>
              <button
                type="button"
                onClick={() => { onAddTicket(); setOpen(false); }}
                className="flex w-full items-center px-3 py-2 text-xs text-foreground hover:bg-muted"
              >
                Add ticket
              </button>
              <button
                type="button"
                onClick={() => setSubmenu("sort")}
                className="flex w-full items-center justify-between px-3 py-2 text-xs text-foreground hover:bg-muted"
              >
                <span className="flex items-center gap-2">
                  <ArrowUpDown size={12} className={cn("shrink-0", isSorted && "text-primary")} aria-hidden />
                  Sort by
                  {isSorted && (
                    <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary leading-none">
                      active
                    </span>
                  )}
                </span>
                <ChevronRight size={12} className="text-muted-foreground" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setSubmenu("move")}
                className="flex w-full items-center justify-between px-3 py-2 text-xs text-foreground hover:bg-muted"
              >
                Move all cards in this list
                <ChevronRight size={12} className="text-muted-foreground" aria-hidden />
              </button>
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                onClick={() => { onDisable(); setOpen(false); }}
                className="flex w-full items-center px-3 py-2 text-xs text-foreground hover:bg-muted"
              >
                Disable this list
              </button>
              <button
                type="button"
                onClick={() => { onDelete(); setOpen(false); }}
                className="flex w-full items-center px-3 py-2 text-xs text-destructive hover:bg-muted"
              >
                Delete this list
              </button>
            </>
          ) : submenu === "sort" ? (
            <>
              <button
                type="button"
                onClick={() => setSubmenu(null)}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-foreground hover:bg-muted border-b border-border"
              >
                <ArrowLeft size={12} aria-hidden />
                Sort by
              </button>
              {COLUMN_SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onSort(opt.value); setOpen(false); setSubmenu(null); }}
                  className="flex w-full items-center justify-between px-3 py-2 text-xs text-foreground hover:bg-muted"
                >
                  {opt.label}
                  {currentSort === opt.value && (
                    <Check size={12} className="text-primary shrink-0" aria-hidden />
                  )}
                </button>
              ))}
              {isSorted && (
                <>
                  <div className="my-1 border-t border-border" />
                  <button
                    type="button"
                    onClick={() => { onSort("default"); setOpen(false); setSubmenu(null); }}
                    className="flex w-full items-center px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
                  >
                    Clear sort
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setSubmenu(null)}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-foreground hover:bg-muted border-b border-border"
              >
                <ArrowLeft size={12} aria-hidden />
                Move all cards in this list
              </button>
              {tickets.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">No tickets in this list</p>
              ) : otherStatuses.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">No other lists available</p>
              ) : (
                otherStatuses.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => { onMoveAll(s.key); setOpen(false); setSubmenu(null); }}
                    className="flex w-full items-center px-3 py-2 text-xs text-foreground hover:bg-muted"
                  >
                    {statusLabelMap.get(s.key) ?? s.label}
                  </button>
                ))
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface ColumnSortable {
  outerRef: (el: HTMLElement | null) => void;
  style: CSSProperties;
  isDragging: boolean;
  listeners: DraggableSyntheticListeners;
  attributes: DraggableAttributes;
}

function KanbanColumn({
  status,
  droppableId,
  title,
  color,
  children,
  columnSummary,
  sortable,
  menu,
}: {
  status: TicketStatus;
  /** Custom droppable ID — defaults to status (set to status:swimlaneKey in swimlane mode). */
  droppableId?: string;
  title: string;
  /** Optional hex color for the column accent dot. */
  color?: string | null;
  /** Localized line: ticket count and sum of story points in this column. */
  columnSummary: string;
  children: React.ReactNode;
  /** When provided, the column becomes sortable with a drag handle. */
  sortable?: ColumnSortable;
  /** Optional column action menu rendered in the header. */
  menu?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: droppableId ?? status });
  return (
    <div
      ref={sortable?.outerRef}
      style={sortable?.style}
      className={cn(
        "flex h-full min-h-0 w-[min(100vw-2rem,18rem)] shrink-0 flex-col rounded-md border border-border bg-muted/20 shadow-(--shadow-1) transition-opacity",
        sortable?.isDragging && "opacity-40"
      )}
    >
      <div
        className={cn(
          "group/col-header shrink-0 border-b border-border px-3 py-2 select-none",
          sortable && "cursor-grab active:cursor-grabbing"
        )}
        {...(sortable ? sortable.listeners : {})}
        {...(sortable ? sortable.attributes : {})}
        aria-label={sortable ? "Drag to reorder column" : undefined}
      >
        <div className="flex items-start justify-between gap-1">
          <h3 className="min-w-0 flex-1 text-xs font-semibold leading-snug text-foreground">
            <span className="flex items-center gap-1.5">
              {color && (
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                  aria-hidden
                />
              )}
              {title}
            </span>
            <span
              className="mt-0.5 block text-[11px] font-normal tabular-nums text-muted-foreground"
              title={columnSummary}
            >
              {columnSummary}
            </span>
          </h3>
          {menu}
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "ticket-board-scroll-y flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto overscroll-y-contain p-2",
          isOver && "bg-primary/5"
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Wraps KanbanColumn with horizontal sort capability. Columns are identified as `col:<status>`. */
function SortableColumn({
  status,
  children,
  ...columnProps
}: Omit<React.ComponentProps<typeof KanbanColumn>, "sortable"> & { children: React.ReactNode; }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: `col:${status}`,
    data: { type: "column", status },
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="w-[min(100vw-2rem,18rem)] shrink-0 self-stretch rounded-md border-2 border-dashed border-primary/40 bg-primary/5"
      />
    );
  }

  return (
    <KanbanColumn
      status={status}
      sortable={{ outerRef: setNodeRef, style, isDragging, listeners, attributes }}
      {...columnProps}
    >
      {children}
    </KanbanColumn>
  );
}

/** Inline "+ Add another list" button at the end of the board columns. */
function AddColumnButton({
  teamId,
  onAdded,
}: {
  teamId: string;
  onAdded: (status: TeamBoardStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const handleAdd = useCallback(async () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/teams/${encodeURIComponent(teamId)}/board-statuses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed, color }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Failed to add column");
        return;
      }
      const data = (await res.json()) as { boardStatus: TeamBoardStatus };
      onAdded(data.boardStatus);
      setLabel("");
      setColor("#6366f1");
      setOpen(false);
      toast.success(`"${data.boardStatus.label}" column added`);
    } catch {
      toast.error("Failed to add column");
    } finally {
      setSaving(false);
    }
  }, [teamId, label, color, onAdded]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-[min(100vw-2rem,18rem)] shrink-0 items-center gap-2 self-start rounded-md border border-dashed border-border bg-muted/10 px-3 py-2.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/30 hover:text-primary"
      >
        <Plus size={14} className="shrink-0" aria-hidden />
        Add another list
      </button>
    );
  }

  return (
    <div className="w-[min(100vw-2rem,18rem)] shrink-0 self-start rounded-md border border-border bg-card p-3 shadow-(--shadow-1)">
      <p className="mb-2 text-xs font-semibold text-foreground">New list</p>
      <input
        ref={inputRef}
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void handleAdd();
          if (e.key === "Escape") { setOpen(false); setLabel(""); }
        }}
        placeholder="e.g. Awaiting QA"
        className="mb-2 w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Color</span>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-6 w-6 cursor-pointer rounded border border-border"
          title="Column color"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={!label.trim() || saving}
          className="flex flex-1 items-center justify-center rounded-sm bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" aria-hidden /> : "Add list"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setLabel(""); }}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Cancel"
        >
          <X size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** Shared card chrome + body for board column and drag overlay (overlay uses non-interactive snapshot). */
function KanbanCardVisual({
  ticket,
  projectScoped,
  disabled,
  selected,
  onOpen,
  onToggleSelect,
  mode,
  statusColor,
  showReorderHandle = false,
  canEditStoryPoints,
  onStoryPointsPatched,
  teamId,
}: {
  ticket: TicketRow;
  projectScoped: boolean;
  disabled: boolean;
  selected: boolean;
  onOpen: (id: string) => void;
  onToggleSelect: (id: string) => void;
  mode: "board" | "dragOverlay";
  statusColor?: string | null;
  /** Highlights the grip affordance when manual column order is enabled (card still drags from anywhere). */
  showReorderHandle?: boolean;
  canEditStoryPoints?: boolean;
  onStoryPointsPatched?: (report: TicketReport) => void;
  teamId?: string;
}) {
  const t = useTranslations("tickets");
  const tGithub = useTranslations("tickets.github");
  const overlay = mode === "dragOverlay";
  const linkedPRs = ticket.linkedPRs ?? [];
  const singleLinkedPR = linkedPRs.length === 1 ? linkedPRs[0] : null;
  const singlePrStatusLabel =
    singleLinkedPR?.status === "OPEN"
      ? tGithub("prStatusOpen")
      : singleLinkedPR?.status === "MERGED"
        ? tGithub("prStatusMerged")
        : singleLinkedPR?.status === "CLOSED"
          ? tGithub("prStatusClosed")
          : null;
  const singlePrStatusClass =
    singleLinkedPR?.status === "OPEN"
      ? "bg-primary-100 text-primary-700"
      : singleLinkedPR?.status === "MERGED"
        ? "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-200"
        : "bg-muted text-muted-foreground";

  const body = (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 shrink-0">
        {ticket.type === "BUG" ? (
          <Bug size={14} className="text-error-600" />
        ) : ticket.type === "FEATURE_REQUEST" ? (
          <Lightbulb size={14} className="text-primary" />
        ) : ticket.type === "FEEDBACK" ? (
          <MessageSquare size={14} className="text-teal-600" />
        ) : ticket.type === "MINOR_ENHANCEMENT" ? (
          <Zap size={14} className="text-amber-600" />
        ) : ticket.type === "REGRESSION" ? (
          <RotateCcw size={14} className="text-orange-600" />
        ) : (
          <ShieldCheck size={14} className="text-violet-600" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="mb-1.5 min-w-0 break-all font-mono text-[10px] font-medium leading-tight text-muted-foreground">
          {ticket.ref}
        </p>
        <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-1">
          {!projectScoped && ticket.project ? (
            <span className="max-w-full rounded border border-border bg-muted/30 px-1 py-0.5 text-[10px] text-foreground">
              {ticket.project.name}
            </span>
          ) : null}
          <TicketStatusBadge status={ticket.status} color={statusColor} />
          {ticket.priority ? <TicketPriorityBadge priority={ticket.priority} /> : null}
        </div>
        <p className="line-clamp-2 text-left text-xs font-medium text-foreground">{ticket.title}</p>
        <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
          {mode === "board" ? (
            <StoryPointsInlineEdit
              ticketId={ticket.id}
              storyPoints={ticket.storyPoints}
              canEdit={Boolean(canEditStoryPoints)}
              size="card"
              teamId={teamId}
              onPatched={onStoryPointsPatched}
            />
          ) : ticket.storyPoints != null ? (
            <span className="rounded border border-border px-1 py-0.5 font-mono tabular-nums">
              {t("storyPointsShort", { n: ticket.storyPoints })}
            </span>
          ) : null}
          {ticket.tags?.slice(0, 3).map((tag) => (
            <span key={tag.id} className="max-w-full truncate rounded-full border border-border px-1 py-0.5">
              {tag.name}
            </span>
          ))}
        </div>
        {linkedPRs.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded border border-border px-1 py-0.5 font-medium">
              <GitPullRequest size={12} aria-hidden />
              {tGithub("linkedPrCount", { count: linkedPRs.length })}
            </span>
            {singlePrStatusLabel ? (
              <span className={cn("rounded-full px-2 py-0.5 font-medium", singlePrStatusClass)}>
                {singlePrStatusLabel}
              </span>
            ) : null}
          </div>
        ) : null}
        {ticket.assignee && (
          <p className="mt-1 text-[10px] text-muted-foreground">
            {t("assigneeCardTag", { name: ticket.assignee.name ?? ticket.assignee.email })}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <>
      {!disabled ? (
        <div className="flex shrink-0 flex-col items-center justify-between border-r border-border px-1.5 py-2.5">
          <GripVertical
            size={14}
            className={cn(
              "shrink-0",
              showReorderHandle ? "text-primary" : "text-muted-foreground"
            )}
            aria-hidden
          />
          {overlay ? (
            <span className="inline-flex h-4 w-4 rounded border border-border bg-muted/40 opacity-50" aria-hidden />
          ) : (
            <label
              className="flex cursor-pointer items-center"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelect(ticket.id)}
                className="rounded border-border"
                aria-label={t("boardSelectCardAria", { ref: ticket.ref })}
              />
            </label>
          )}
        </div>
      ) : null}
      {overlay ? (
        <div className="min-w-0 flex-1 p-2.5 text-left">{body}</div>
      ) : (
        <button
          type="button"
          className="min-w-0 flex-1 cursor-pointer p-2.5 text-left"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey) {
              e.preventDefault();
              onToggleSelect(ticket.id);
              return;
            }
            onOpen(ticket.id);
          }}
        >
          {body}
        </button>
      )}
    </>
  );
}

type KanbanCardProps = {
  ticket: TicketRow;
  disabled: boolean;
  onOpen: (id: string) => void;
  projectScoped: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  /** When dragging a multi-card group, dim non-leader cards in the column. */
  dragDisabledVisual: boolean;
  statusColor?: string | null;
  showReorderHandle?: boolean;
  /** Sprint manual-order columns: animate reorder via CSS transform instead of DOM reorder. */
  sortable?: boolean;
  canEditStoryPoints?: boolean;
  onStoryPointsPatched?: (report: TicketReport) => void;
  teamId?: string;
};

function KanbanCardShell({
  ticket,
  disabled,
  onOpen,
  projectScoped,
  selected,
  onToggleSelect,
  statusColor,
  showReorderHandle = false,
  canEditStoryPoints,
  onStoryPointsPatched,
  teamId,
  canDrag,
  showPlaceholder,
  setNodeRef,
  style,
  listeners,
  attributes,
}: KanbanCardProps & {
  canDrag: boolean;
  showPlaceholder: boolean;
  setNodeRef: (node: HTMLElement | null) => void;
  style: CSSProperties;
  listeners: DraggableSyntheticListeners;
  attributes: DraggableAttributes;
}) {
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(canDrag ? { ...listeners, ...attributes } : {})}
      className={cn(
        "flex w-full rounded-md border bg-card shadow-(--shadow-1) transition-[transform,box-shadow,background-color,border-color] duration-200",
        showPlaceholder
          ? "border-2 border-dashed border-primary/35 bg-primary/5"
          : "border-border hover:bg-muted",
        canDrag && "cursor-grab active:cursor-grabbing",
        selected && !showPlaceholder && "ring-2 ring-primary ring-offset-1 ring-offset-background"
      )}
    >
      {showPlaceholder ? (
        <span className="sr-only">Drop zone</span>
      ) : (
        <KanbanCardVisual
          ticket={ticket}
          projectScoped={projectScoped}
          disabled={disabled}
          selected={selected}
          onOpen={onOpen}
          onToggleSelect={onToggleSelect}
          mode="board"
          statusColor={statusColor}
          showReorderHandle={showReorderHandle && canDrag}
          canEditStoryPoints={canEditStoryPoints}
          onStoryPointsPatched={onStoryPointsPatched}
          teamId={teamId}
        />
      )}
    </div>
  );
}

function SortableKanbanCard(props: KanbanCardProps) {
  const {
    ticket,
    disabled,
    dragDisabledVisual,
    showReorderHandle = false,
    ...shellProps
  } = props;
  const cardDisabled = disabled || dragDisabledVisual;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ticket.id,
    disabled: cardDisabled,
    data: { type: "ticket", status: ticket.status },
  });

  const canDrag = !cardDisabled;
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition:
      transition ?? "transform 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
    minHeight: isDragging ? "5.25rem" : undefined,
  };

  return (
    <KanbanCardShell
      {...shellProps}
      ticket={ticket}
      disabled={disabled}
      dragDisabledVisual={dragDisabledVisual}
      showReorderHandle={showReorderHandle}
      canDrag={canDrag}
      showPlaceholder={isDragging}
      setNodeRef={setNodeRef}
      style={style}
      listeners={listeners}
      attributes={attributes}
    />
  );
}

function DraggableKanbanCard(props: KanbanCardProps) {
  const {
    ticket,
    disabled,
    dragDisabledVisual,
    showReorderHandle = false,
    ...shellProps
  } = props;
  const cardDisabled = disabled || dragDisabledVisual;
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: ticket.id,
    disabled: cardDisabled,
    data: { type: "ticket", status: ticket.status },
  });
  const { setNodeRef: setDropRef } = useDroppable({
    id: ticket.id,
    data: { type: "ticket", status: ticket.status },
  });
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef]
  );

  const canDrag = !cardDisabled;
  const style: CSSProperties = {
    minHeight: isDragging ? "5.25rem" : undefined,
  };

  return (
    <KanbanCardShell
      {...shellProps}
      ticket={ticket}
      disabled={disabled}
      dragDisabledVisual={dragDisabledVisual}
      showReorderHandle={showReorderHandle}
      canDrag={canDrag}
      showPlaceholder={isDragging}
      setNodeRef={setNodeRef}
      style={style}
      listeners={listeners}
      attributes={attributes}
    />
  );
}

function KanbanCard({ sortable = false, ...props }: KanbanCardProps) {
  if (sortable) {
    return <SortableKanbanCard {...props} />;
  }
  return <DraggableKanbanCard {...props} />;
}

/** Floating action bar that appears when one or more cards are selected. */
function BulkSelectionBar({
  selectedCount,
  activeStatuses,
  statusLabelMap,
  onMoveTo,
  onClear,
}: {
  selectedCount: number;
  activeStatuses: TeamBoardStatus[];
  statusLabelMap: Map<string, string>;
  onMoveTo: (targetStatus: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  return (
    <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs shadow-(--shadow-1)">
      <span className="font-semibold text-primary tabular-nums">
        {selectedCount}
      </span>
      <span className="text-foreground">
        {selectedCount === 1 ? "ticket selected" : "tickets selected"}
      </span>

      <div ref={menuRef} className="relative ml-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground shadow-(--shadow-1) hover:bg-muted"
        >
          Move to
          <ChevronDown size={12} aria-hidden />
        </button>
        {open && (
          <div className="absolute left-0 top-8 z-50 min-w-[180px] rounded-md border border-border bg-popover py-1 shadow-lg">
            {activeStatuses.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  onMoveTo(s.key);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-muted"
              >
                {s.color && (
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: s.color }}
                    aria-hidden
                  />
                )}
                {statusLabelMap.get(s.key) ?? s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onClear}
        className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-primary/10 hover:text-foreground"
        aria-label="Clear selection"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

export interface TicketBoardProps {
  locale: string;
  currentUserId: string;
  canTriage: boolean;
  isAdmin: boolean;
  tickets: TicketRow[];
  fetchTickets: (opts?: { soft?: boolean }) => Promise<void>;
  projectId?: string;
  /** Tag catalog shared from TicketsWorkspace — fetched once, passed to both list and board. */
  tagFilterOptions: Array<{ id: string; name: string }>;
  /** When true, hides tag filter controls (e.g. sprint board matching a minimal toolbar). */
  hideTagFilter?: boolean;
  /** When set (multi-project sprint), new ticket dialog limits project choice to these IDs. */
  allowedProjectIds?: string[];
  /** When set (e.g. sprint board), shows a link in the board toolbar back to the sprint list. */
  boardBackLink?: { href: string; label: string };
  /** When set, new tickets are linked to this sprint (explicit `sprint_tickets` sprints; triage only in dialog). */
  sprintId?: string;
  /** Hide List/Board toggle (sprint board is board-only). */
  hideListView?: boolean;
  /** When set (explicit sprint + triage), show “Add existing” next to New ticket. */
  addExistingSprintId?: string;
  /** Merge PATCH payloads into list state before refetch. */
  mergeTicketFromPatchReport?: (report: TicketReport) => void;
  /** After bulk status API success, update list rows so UI does not depend on a soft refetch alone. */
  applyStatusesToTickets?: (ids: string[], status: TicketStatus) => void;
  /** Per-team board status config. When empty, falls back to built-in defaults. */
  boardStatuses?: TeamBoardStatus[];
  /** Per-team swimlane grouping config. */
  swimlaneConfig?: TeamSwimlaneConfig | null;
  /** Team ID for board settings API calls. */
  teamId?: string;
  /** Called when board settings are saved so TicketsWorkspace can update shared state. */
  onBoardConfigChange?: (statuses: TeamBoardStatus[], swimlane?: TeamSwimlaneConfig | null) => void;
  /** When true (e.g. sprint formally completed), board is view-only for everyone. */
  sprintBoardReadOnly?: boolean;
  /** Sprint id for the current board view (enables persisted within-column card order). */
  boardSprintId?: string;
  /** Initial manual card order per status column (from sprint ticket-order API). */
  sprintTicketOrder?: Map<string, string[]>;
}

function computeBulkMoveIds(
  activeId: string,
  selected: Set<string>,
  rowsVisible: TicketRow[]
): string[] {
  const activeRow = rowsVisible.find((r) => r.id === activeId);
  if (!activeRow) return [activeId];
  const inColumn = new Set(
    rowsVisible.filter((r) => r.status === activeRow.status).map((r) => r.id)
  );
  if (!selected.has(activeId)) return [activeId];
  const intersect = [...selected].filter((id) => inColumn.has(id));
  return intersect.length > 0 ? intersect : [activeId];
}

/** Deep-link `?open=` on board (`?view=board&open=`). */
function TicketBoardOpenParamSync({
  tickets,
  selectedId,
  setSelectedId,
  router,
  pathname,
  closingModalRef,
}: {
  tickets: TicketRow[];
  selectedId: string | null;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
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
    void (async () => {
      try {
        const res = await fetch(`/api/tickets/${encodeURIComponent(openParam)}`);
        if (!res.ok) {
          if (res.status === 404) router.replace(`${pathname}?view=board`);
          return;
        }
        if (!cancelled) setSelectedId(openParam);
      } catch {
        /* silent */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openParam, tickets, selectedId, router, pathname, closingModalRef, setSelectedId]);

  return null;
}

/** Returns the i18n key for built-in statuses, or null for custom ones (use label directly). */
function builtInStatusTitleKey(status: string): string | null {
  const map: Record<string, string> = {
    BACKLOG: "statusBacklog",
    READY: "statusReady",
    IN_PROGRESS: "statusInProgress",
    FOR_REVIEW: "statusForReview",
    RESOLVED: "statusResolved",
    TO_BE_DEPLOYED: "statusToBeDeployed",
    DONE: "statusDone",
    ARCHIVED: "statusArchived",
  };
  return map[status] ?? null;
}

export function TicketBoard({
  locale,
  currentUserId,
  canTriage,
  isAdmin,
  tickets,
  fetchTickets,
  projectId,
  tagFilterOptions,
  hideTagFilter = false,
  allowedProjectIds,
  boardBackLink,
  sprintId: newTicketSprintId,
  hideListView = false,
  addExistingSprintId,
  mergeTicketFromPatchReport,
  applyStatusesToTickets,
  boardStatuses: boardStatusesProp,
  swimlaneConfig,
  teamId,
  onBoardConfigChange,
  sprintBoardReadOnly = false,
  boardSprintId,
  sprintTicketOrder,
}: TicketBoardProps): React.ReactElement {
  const projectScoped = Boolean(projectId);
  const dragDisabled = !canTriage || sprintBoardReadOnly;
  const canEditStoryPoints = canTriage && !sprintBoardReadOnly;
  const t = useTranslations("tickets");
  const router = useRouter();
  const pathname = usePathname();
  const [view, setView] = useState<TicketInboxView>("all");
  const [searchInput, setSearchInput] = useState("");
  const [typeFilter, setTypeFilter] = useState<TicketInboxTypeFilter>("ALL");
  const [priorityFilter, setPriorityFilter] = useState<TicketInboxPriorityFilter>("ALL");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const effectiveTagFilter = useMemo(
    () => (hideTagFilter ? EMPTY_TAG_FILTER : tagFilter),
    [hideTagFilter, tagFilter]
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createTicketOpen, setCreateTicketOpen] = useState(false);
  const [addExistingOpen, setAddExistingOpen] = useState(false);
  const closingModalRef = useRef(false);
  const [showArchivedColumn, setShowArchivedColumn] = useState(false);
  const [boardSettingsOpen, setBoardSettingsOpen] = useState(false);
  const [activeColumnStatus, setActiveColumnStatus] = useState<string | null>(null);
  const [newTicketDefaultStatus, setNewTicketDefaultStatus] = useState<string | undefined>(undefined);
  const [localSwimlaneBy, setLocalSwimlaneBy] = useState<SwimlaneBy>(
    () => swimlaneConfig?.swimlaneBy ?? "NONE"
  );
  const [columnSorts, setColumnSorts] = useState<Map<string, ColumnSortOption>>(() => new Map());
  const [cardOrder, setCardOrder] = useState<Map<string, string[]>>(() => new Map());
  const [columnDragSession, setColumnDragSession] = useState<ColumnDragSession | null>(null);
  const saveCardOrderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalSwimlaneBy(swimlaneConfig?.swimlaneBy ?? "NONE");
  }, [swimlaneConfig]);

  useEffect(() => {
    if (!sprintTicketOrder) {
      setCardOrder(new Map());
      return;
    }
    setCardOrder(new Map(sprintTicketOrder));
  }, [sprintTicketOrder]);

  const debouncedSaveOrder = useCallback(
    (statusKey: string, orderedTicketIds: string[]) => {
      if (!boardSprintId) return;
      if (saveCardOrderTimerRef.current) clearTimeout(saveCardOrderTimerRef.current);
      saveCardOrderTimerRef.current = setTimeout(() => {
        void fetch(`/api/sprints/${encodeURIComponent(boardSprintId)}/ticket-order`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ statusKey, orderedTicketIds }),
        }).catch(() => {
          toast.error("Failed to save card order");
        });
      }, 500);
    },
    [boardSprintId]
  );

  useEffect(() => {
    return () => {
      if (saveCardOrderTimerRef.current) clearTimeout(saveCardOrderTimerRef.current);
    };
  }, []);

  const handleColumnAdded = useCallback(
    (newStatus: TeamBoardStatus) => {
      const updated = [...(boardStatusesProp ?? []), newStatus];
      onBoardConfigChange?.(updated);
    },
    [boardStatusesProp, onBoardConfigChange]
  );

  const handleSwimlaneChange = useCallback(
    async (value: SwimlaneBy) => {
      setLocalSwimlaneBy(value);
      onBoardConfigChange?.(
        boardStatusesProp ?? [],
        swimlaneConfig
          ? { ...swimlaneConfig, swimlaneBy: value }
          : teamId
            ? { id: "", teamId, swimlaneBy: value }
            : null
      );
      if (!teamId) return;
      try {
        await fetch(`/api/teams/${encodeURIComponent(teamId)}/swimlane-config`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ swimlaneBy: value }),
        });
      } catch {
        toast.error("Failed to save swimlane setting");
      }
    },
    [teamId, boardStatusesProp, swimlaneConfig, onBoardConfigChange]
  );

  const saveColumnOrder = useCallback(
    async (reordered: TeamBoardStatus[]) => {
      if (!teamId) return;
      try {
        await Promise.all(
          reordered.map((s, index) =>
            fetch(
              `/api/teams/${encodeURIComponent(teamId)}/board-statuses/${encodeURIComponent(s.id)}`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sortOrder: index }),
              }
            )
          )
        );
      } catch {
        toast.error("Failed to save column order");
      }
    },
    [teamId]
  );

  const handleColumnReorder = useCallback(
    (activeColStatus: string, overColStatus: string) => {
      const statuses = boardStatusesProp ?? [];
      const oldIndex = statuses.findIndex((s) => s.key === activeColStatus);
      const newIndex = statuses.findIndex((s) => s.key === overColStatus);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
      const reordered = arrayMove(statuses, oldIndex, newIndex).map((s, i) => ({
        ...s,
        sortOrder: i,
      }));
      onBoardConfigChange?.(reordered);
      void saveColumnOrder(reordered);
    },
    [boardStatusesProp, onBoardConfigChange, saveColumnOrder]
  );

  const disableColumn = useCallback(
    async (statusId: string) => {
      if (!teamId) return;
      try {
        const res = await fetch(
          `/api/teams/${encodeURIComponent(teamId)}/board-statuses/${encodeURIComponent(statusId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isEnabled: false }),
          }
        );
        if (!res.ok) { toast.error("Failed to disable list"); return; }
        const updated = (boardStatusesProp ?? []).map((s) =>
          s.id === statusId ? { ...s, isEnabled: false } : s
        );
        onBoardConfigChange?.(updated);
        toast.success("List hidden from board");
      } catch {
        toast.error("Failed to disable list");
      }
    },
    [teamId, boardStatusesProp, onBoardConfigChange]
  );

  const deleteColumn = useCallback(
    async (statusId: string) => {
      if (!teamId) return;
      try {
        const res = await fetch(
          `/api/teams/${encodeURIComponent(teamId)}/board-statuses/${encodeURIComponent(statusId)}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          toast.error(err.error ?? "Failed to delete list");
          return;
        }
        const updated = (boardStatusesProp ?? []).filter((s) => s.id !== statusId);
        onBoardConfigChange?.(updated);
        toast.success("List deleted");
      } catch {
        toast.error("Failed to delete list");
      }
    },
    [teamId, boardStatusesProp, onBoardConfigChange]
  );
  const [statusOverrides, setStatusOverrides] = useState<Map<string, TicketStatus>>(new Map());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [dragBundle, setDragBundle] = useState<null | { leaderId: string; ids: string[] }>(null);

  const searchNormalized = useMemo(() => searchInput.trim().toLowerCase(), [searchInput]);

  const filterCriteria = useMemo(
    () => ({
      view,
      currentUserId,
      typeFilter,
      priorityFilter,
      tagFilter: effectiveTagFilter,
      search: searchNormalized,
    }),
    [view, currentUserId, typeFilter, priorityFilter, effectiveTagFilter, searchNormalized]
  );

  const filtered = useMemo(() => filterTicketInboxRows(tickets, filterCriteria), [tickets, filterCriteria]);

  const activeStatuses = useMemo((): TeamBoardStatus[] => {
    if (boardStatusesProp && boardStatusesProp.length > 0) {
      return boardStatusesProp
        .filter((s) => s.isEnabled || (s.key === "ARCHIVED" && showArchivedColumn))
        .sort((a, b) => a.sortOrder - b.sortOrder);
    }
    const fallback = DEFAULT_COLUMN_KEYS.map((key, i) => ({
      id: key,
      key,
      label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      color: null,
      isBuiltIn: true,
      isEnabled: true,
      sortOrder: i,
    }));
    if (showArchivedColumn) {
      fallback.push({ id: "ARCHIVED", key: "ARCHIVED", label: "Archived", color: null, isBuiltIn: true, isEnabled: true, sortOrder: 99 });
    }
    return fallback;
  }, [boardStatusesProp, showArchivedColumn]);

  const columnsToShow = useMemo((): TicketStatus[] => activeStatuses.map((s) => s.key), [activeStatuses]);

  const statusLabelMap = useMemo((): Map<string, string> => {
    const map = new Map<string, string>();
    for (const s of activeStatuses) map.set(s.key, s.label);
    return map;
  }, [activeStatuses]);

  const statusColorMap = useMemo((): Map<string, string | null> => {
    const map = new Map<string, string | null>();
    for (const s of activeStatuses) map.set(s.key, s.color ?? null);
    return map;
  }, [activeStatuses]);

  const allStatusKeys = useMemo((): readonly string[] => {
    if (boardStatusesProp && boardStatusesProp.length > 0) {
      return boardStatusesProp.map((s) => s.key);
    }
    return DEFAULT_BOARD_STATUS_KEYS;
  }, [boardStatusesProp]);

  const filteredWithOverrides = useMemo(() => {
    if (statusOverrides.size === 0) return filtered;
    return filtered.map((row) => {
      const override = statusOverrides.get(row.id);
      return override ? { ...row, status: override } : row;
    });
  }, [filtered, statusOverrides]);

  const activeSwimlaneBy = localSwimlaneBy;

  const swimlaneGroups = useMemo((): Array<{ key: string; label: string; tickets: TicketRow[] }> => {
    if (activeSwimlaneBy === "NONE") {
      return [{ key: "__all__", label: "All", tickets: filteredWithOverrides }];
    }
    const buckets = new Map<string, { label: string; tickets: TicketRow[] }>();
    for (const row of filteredWithOverrides) {
      let key: string;
      let label: string;
      if (activeSwimlaneBy === "ASSIGNEE") {
        key = row.assignee?.id ?? "__unassigned__";
        label = row.assignee ? (row.assignee.name ?? row.assignee.email) : "Unassigned";
      } else if (activeSwimlaneBy === "TYPE") {
        key = row.type;
        label = row.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      } else if (activeSwimlaneBy === "PRIORITY") {
        key = row.priority ?? "__none__";
        label = row.priority ? row.priority.charAt(0) + row.priority.slice(1).toLowerCase() + " Priority" : "No Priority";
      } else {
        key = row.projectId ?? "__none__";
        label = row.project?.name ?? "No Project";
      }
      if (!buckets.has(key)) {
        buckets.set(key, { label, tickets: [] });
      }
      buckets.get(key)!.tickets.push(row);
    }
    return [...buckets.entries()].map(([key, { label, tickets }]) => ({ key, label, tickets }));
  }, [filteredWithOverrides, activeSwimlaneBy]);

  const ticketsByStatus = useMemo(() => {
    const map = new Map<TicketStatus, TicketRow[]>();
    for (const s of allStatusKeys) {
      map.set(s, []);
    }
    for (const row of filteredWithOverrides) {
      const list = map.get(row.status);
      if (list) {
        list.push(row);
      } else {
        const unknownList = map.get("__unknown__") ?? [];
        unknownList.push(row);
        map.set("__unknown__", unknownList);
      }
    }
    return map;
  }, [filteredWithOverrides, allStatusKeys]);

  const getMergedColumnIds = useCallback(
    (status: string): string[] => {
      const rawCol = ticketsByStatus.get(status) ?? [];
      const colSort = columnSorts.get(status) ?? "default";
      const sorted = applyCardOrder(applyColumnSort(rawCol, colSort), cardOrder.get(status));
      return mergeColumnTicketIds(
        sorted.map((row) => row.id),
        cardOrder.get(status)
      );
    },
    [ticketsByStatus, columnSorts, cardOrder]
  );

  const clearColumnDrag = useCallback(() => {
    setColumnDragSession(null);
  }, []);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [filterCriteria]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedIds(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const ticketIdSet = useMemo(
    () => new Set(filteredWithOverrides.map((row) => row.id)),
    [filteredWithOverrides]
  );

  const boardCollisionDetection: CollisionDetection = useCallback(
    (args) => {
      const collisions = pointerWithin(args);
      if (collisions.length === 0) return collisions;

      const activeId = String(args.active.id);
      if (activeId.startsWith("col:")) return collisions;

      const cardHits = collisions.filter((collision) => {
        const id = String(collision.id);
        return id !== activeId && ticketIdSet.has(id);
      });
      return cardHits.length > 0 ? cardHits : collisions;
    },
    [ticketIdSet]
  );

  const goToListView = useCallback(() => {
    router.replace(`${pathname}?view=list`);
  }, [router, pathname]);

  const patchStatus = useCallback(
    async (ticketId: string, status: TicketStatus) => {
      setStatusOverrides((prev) => new Map(prev).set(ticketId, status));
      try {
        const ticketUrl = teamId
          ? `/api/tickets/${encodeURIComponent(ticketId)}?team=${encodeURIComponent(teamId)}`
          : `/api/tickets/${encodeURIComponent(ticketId)}`;
        const res = await fetch(ticketUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        if (!res.ok) throw new Error("patch");
        const data = (await res.json()) as TicketReport;
        await fetchTickets({ soft: true });
        mergeTicketFromPatchReport?.(data);
        toast.success(t("statusUpdated"));
      } catch {
        toast.error(t("statusUpdateFailed"));
        setStatusOverrides((prev) => {
          const next = new Map(prev);
          next.delete(ticketId);
          return next;
        });
        return;
      }
      setStatusOverrides((prev) => {
        const next = new Map(prev);
        next.delete(ticketId);
        return next;
      });
    },
    [fetchTickets, mergeTicketFromPatchReport, t, teamId]
  );

  const patchBulkStatuses = useCallback(
    async (ticketIds: string[], status: TicketStatus) => {
      setStatusOverrides((prev) => {
        const next = new Map(prev);
        for (const id of ticketIds) next.set(id, status);
        return next;
      });
      try {
        const bulkUrl = teamId
          ? `/api/tickets/bulk?team=${encodeURIComponent(teamId)}`
          : "/api/tickets/bulk";
        const res = await fetch(bulkUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "setStatus", ticketIds, status }),
        });
        if (!res.ok) throw new Error("bulk");
        const data = (await res.json()) as { results?: Array<{ id: string; ok: boolean }> };
        const results = data.results ?? [];
        const failed = results.filter((r) => !r.ok);
        const okCount = results.filter((r) => r.ok).length;
        if (failed.length > 0 && okCount > 0) {
          toast.error(t("bulkPartialSuccess", { ok: okCount, failed: failed.length }));
        } else if (failed.length > 0) {
          toast.error(t("bulkFailed"));
        } else {
          toast.success(t("bulkSuccess", { count: okCount || ticketIds.length }));
        }
        const okIds =
          results.length > 0
            ? results.filter((r) => r.ok).map((r) => r.id)
            : ticketIds;
        await fetchTickets({ soft: true });
        if (okIds.length > 0) {
          applyStatusesToTickets?.(okIds, status);
        }
        setSelectedIds(new Set());
      } catch {
        toast.error(t("bulkFailed"));
        setStatusOverrides((prev) => {
          const next = new Map(prev);
          for (const id of ticketIds) next.delete(id);
          return next;
        });
        return;
      }
      setStatusOverrides((prev) => {
        const next = new Map(prev);
        for (const id of ticketIds) next.delete(id);
        return next;
      });
    },
    [fetchTickets, t, teamId, applyStatusesToTickets]
  );

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      if (dragDisabled) return;
      const activeId = String(event.active.id);
      if (activeId.startsWith("col:")) {
        setActiveColumnStatus(activeId.slice(4));
        return;
      }
      if (!canTriage) return;
      const ids = computeBulkMoveIds(activeId, selectedIds, filteredWithOverrides);
      setDragBundle({ leaderId: activeId, ids });

      if (boardSprintId) {
        const activeTicket = filteredWithOverrides.find((row) => row.id === activeId);
        const colSort = activeTicket ? columnSorts.get(activeTicket.status) ?? "default" : "default";
        if (activeTicket && colSort === "default") {
          const baselineIds = getMergedColumnIds(activeTicket.status);
          setColumnDragSession({
            activeId,
            status: activeTicket.status,
            baselineIds,
          });
        }
      }
    },
    [
      dragDisabled,
      canTriage,
      selectedIds,
      filteredWithOverrides,
      boardSprintId,
      columnSorts,
      getMergedColumnIds,
    ]
  );

  const onDragCancel = useCallback(() => {
    setDragBundle(null);
    setActiveColumnStatus(null);
    clearColumnDrag();
  }, [clearColumnDrag]);

  const dragOverlayTicket = useMemo(() => {
    if (!dragBundle || dragBundle.ids.length !== 1) return null;
    return filteredWithOverrides.find((r) => r.id === dragBundle.leaderId) ?? null;
  }, [dragBundle, filteredWithOverrides]);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragBundle(null);
      setActiveColumnStatus(null);
      const session = columnDragSession;
      clearColumnDrag();

      if (dragDisabled) return;
      const { active, over } = event;
      if (!over) return;

      const activeId = String(active.id);
      const overId = String(over.id);

      // Column reorder
      if (activeId.startsWith("col:") && overId.startsWith("col:")) {
        handleColumnReorder(activeId.slice(4), overId.slice(4));
        return;
      }

      if (!canTriage) return;

      // Within-column card reorder (sprint board)
      if (session && session.activeId === activeId && boardSprintId) {
        const colSort = columnSorts.get(session.status) ?? "default";
        if (colSort === "default") {
          const overTicketRow = filteredWithOverrides.find((row) => row.id === overId);
          const dropStatus = (
            overTicketRow
              ? overTicketRow.status
              : overId.includes(":")
                ? overId.split(":")[0]
                : overId
          ) as TicketStatus;

          if (dropStatus === session.status) {
            const baseline = session.baselineIds;
            const sourceIdx = baseline.indexOf(activeId);
            const targetIdx = overTicketRow ? baseline.indexOf(overId) : -1;
            const final =
              sourceIdx !== -1 && targetIdx !== -1 && sourceIdx !== targetIdx
                ? arrayMove([...baseline], sourceIdx, targetIdx)
                : baseline;
            if (final.join("\u001f") !== baseline.join("\u001f")) {
              setCardOrder((prev) => new Map(prev).set(session.status, final));
              debouncedSaveOrder(session.status, final);
            }
            return;
          }
        }
      }

      // Ticket status change (free drag overlay across columns)
      const overTicketRow = filteredWithOverrides.find((r) => r.id === overId);
      const newStatus = (
        overTicketRow
          ? overTicketRow.status
          : overId.includes(":")
            ? overId.split(":")[0]
            : overId
      ) as TicketStatus;
      if (!allStatusKeys.includes(newStatus)) return;
      const ids = computeBulkMoveIds(activeId, selectedIds, filteredWithOverrides);
      const displayRow = filteredWithOverrides.find((r) => r.id === ids[0]);
      if (!displayRow) return;
      if (displayRow.status === newStatus) return;
      if (ids.length > 1) {
        void patchBulkStatuses(ids, newStatus);
      } else {
        void patchStatus(ids[0], newStatus);
      }
    },
    [
      dragDisabled,
      canTriage,
      selectedIds,
      filteredWithOverrides,
      allStatusKeys,
      handleColumnReorder,
      patchStatus,
      patchBulkStatuses,
      boardSprintId,
      columnSorts,
      columnDragSession,
      clearColumnDrag,
      debouncedSaveOrder,
    ]
  );

  const openModal = useCallback(
    (id: string) => {
      closingModalRef.current = false;
      setSelectedId(id);
      router.replace(`${pathname}?view=board&open=${encodeURIComponent(id)}`);
    },
    [router, pathname]
  );

  const closeModal = useCallback(() => {
    closingModalRef.current = true;
    setSelectedId(null);
    router.replace(`${pathname}?view=board`);
  }, [router, pathname]);

  const onTicketCreated = useCallback(
    (id: string) => {
      closingModalRef.current = false;
      setSelectedId(id);
      router.replace(`${pathname}?view=board&open=${encodeURIComponent(id)}`);
    },
    [router, pathname]
  );

  const renderColumnCards = useCallback(
    (
      colTickets: TicketRow[],
      status: string,
      columnColor: string | null | undefined,
      showReorderHandle: boolean
    ): ReactNode => {
      // Keep SortableContext items in committed DOM order so activeIndex/overIndex
      // match baseline positions — verticalListSortingStrategy then shifts cards
      // (insert) instead of swapping when preview order was passed here.
      const sortItems = colTickets.map((row) => row.id);

      const cards = colTickets.map((row) => {
        const selected = selectedIds.has(row.id);
        const dragDim =
          dragBundle !== null &&
          dragBundle.ids.length > 1 &&
          dragBundle.ids.includes(row.id) &&
          row.id !== dragBundle.leaderId;

        return (
          <KanbanCard
            key={row.id}
            ticket={row}
            disabled={dragDisabled}
            onOpen={openModal}
            projectScoped={projectScoped}
            selected={selected}
            onToggleSelect={toggleSelect}
            dragDisabledVisual={dragDim}
            statusColor={columnColor}
            showReorderHandle={showReorderHandle}
            sortable={showReorderHandle}
            canEditStoryPoints={canEditStoryPoints}
            onStoryPointsPatched={mergeTicketFromPatchReport}
            teamId={teamId}
          />
        );
      });

      if (!showReorderHandle) {
        return cards;
      }

      return (
        <SortableContext items={sortItems} strategy={verticalListSortingStrategy}>
          {cards}
        </SortableContext>
      );
    },
    [
      selectedIds,
      dragBundle,
      dragDisabled,
      projectScoped,
      toggleSelect,
      openModal,
      canEditStoryPoints,
      mergeTicketFromPatchReport,
      teamId,
    ]
  );

  const assignedToMeCount = useMemo(
    () => tickets.filter((r) => r.assignee?.id === currentUserId).length,
    [tickets, currentUserId]
  );

  return (
    <div
      className={cn(
        "w-full min-w-0 overflow-x-hidden gap-4 py-(--page-padding-y)",
        hideListView
          ? "flex min-h-0 flex-1 flex-col"
          : "grid min-h-[calc(100dvh-var(--top-bar-height)-2*var(--page-padding-y))] grid-rows-[auto_minmax(0,1fr)]"
      )}
      style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
    >
      <div className={cn("flex min-h-0 flex-col gap-4", hideListView && "shrink-0")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {boardBackLink ? (
              <Link
                href={boardBackLink.href}
                className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-(--shadow-1) hover:bg-muted"
              >
                <ArrowLeft size={14} aria-hidden />
                {boardBackLink.label}
              </Link>
            ) : null}
            {!hideListView ? (
              <div className="flex rounded-md border border-border p-1">
                <button
                  type="button"
                  onClick={goToListView}
                  className="inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                >
                  <List size={14} aria-hidden />
                  {t("viewList")}
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-sm bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-(--shadow-1)"
                >
                  <LayoutGrid size={14} aria-hidden />
                  {t("viewBoard")}
                </button>
              </div>
            ) : (
              <div
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-(--shadow-1)"
                title={t("viewBoard")}
              >
                <LayoutGrid size={14} aria-hidden />
                {t("viewBoard")}
              </div>
            )}
            {canTriage && addExistingSprintId && !sprintBoardReadOnly ? (
              <button
                type="button"
                onClick={() => setAddExistingOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-(--shadow-1) hover:bg-muted"
              >
                <ListPlus size={14} aria-hidden />
                {t("addExistingToSprintToolbar")}
              </button>
            ) : null}
            {(!hideListView || canTriage) && !sprintBoardReadOnly ? (
              <button
                type="button"
                onClick={() => setCreateTicketOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                <Plus size={14} aria-hidden />
                {t("newTicket")}
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hideListView ? (
              <button
                type="button"
                onClick={() => void fetchTickets({ soft: true })}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-border bg-card text-muted-foreground shadow-(--shadow-1) hover:bg-muted"
                aria-label={t("boardReloadAria")}
              >
                <RefreshCw size={14} aria-hidden />
              </button>
            ) : null}
            {hideListView && isAdmin && teamId ? (
              <select
                value={localSwimlaneBy}
                onChange={(e) => void handleSwimlaneChange(e.target.value as SwimlaneBy)}
                className="h-8 rounded-sm border border-border bg-card px-2 text-xs text-foreground shadow-(--shadow-1) focus:outline-none focus:ring-1 focus:ring-ring"
                aria-label="Swimlane grouping"
                title="Swimlane grouping"
              >
                {SWIMLANE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            ) : null}
            {isAdmin && teamId ? (
              <button
                type="button"
                onClick={() => setBoardSettingsOpen(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground shadow-(--shadow-1) hover:bg-muted"
                title={t("boardSettingsLabel")}
              >
                <Settings2 size={14} aria-hidden />
                {t("boardSettingsLabel")}
              </button>
            ) : null}
            {!(boardStatusesProp && boardStatusesProp.length > 0) ? (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showArchivedColumn}
                  onChange={(e) => setShowArchivedColumn(e.target.checked)}
                  className="rounded border-border"
                />
                {t("boardShowArchived")}
              </label>
            ) : null}
          </div>
        </div>

        <div className="flex max-w-full items-center justify-between gap-2 rounded-md p-1">
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
              {assignedToMeCount > 0 && <span className="ml-1 text-muted-foreground">({assignedToMeCount})</span>}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="ticket-board-search" className="text-xs text-muted-foreground">
              {t("searchLabel")}
            </label>
            <input
              id="ticket-board-search"
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
              <label htmlFor="ticket-board-type" className="text-xs text-muted-foreground">
                {t("filterTypeLabel")}
              </label>
              <select
                id="ticket-board-type"
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
              <label htmlFor="ticket-board-priority" className="text-xs text-muted-foreground">
                {t("filterPriorityLabel")}
              </label>
              <select
                id="ticket-board-priority"
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
                  id="ticket-board-tag"
                  options={tagFilterOptions}
                  selectedIds={tagFilter}
                  onSelectedIdsChange={setTagFilter}
                  triggerClassName={SELECT_CLASS}
                />
              </div>
            ) : null}
          </div>
        </div>
        {!canTriage && !sprintBoardReadOnly ? <p className="text-xs text-muted-foreground">{t("boardReadOnlyHint")}</p> : null}
        {sprintBoardReadOnly ? (
          <p className="text-xs text-amber-700 dark:text-amber-300">{t("sprintBoardCompletedHint")}</p>
        ) : null}
        {canTriage && !sprintBoardReadOnly && selectedIds.size > 0 && (
          <BulkSelectionBar
            selectedCount={selectedIds.size}
            activeStatuses={activeStatuses}
            statusLabelMap={statusLabelMap}
            onMoveTo={(targetStatus) => {
              void patchBulkStatuses([...selectedIds], targetStatus as TicketStatus);
            }}
            onClear={() => setSelectedIds(new Set())}
          />
        )}
      </div>

      <div className={cn("flex min-h-0 min-w-0 flex-col", hideListView && "min-h-0 flex-1")}>
        <DndContext
          sensors={sensors}
          collisionDetection={boardCollisionDetection}
          onDragStart={onDragStart}
          onDragCancel={onDragCancel}
          onDragEnd={onDragEnd}
        >
          <div className={cn("flex min-h-0 min-w-0 flex-col", hideListView ? "min-h-0 flex-1" : "h-full")}>
            {activeSwimlaneBy === "NONE" ? (
              <div
                className={cn(
                  "ticket-board-scroll-x flex min-h-0 min-w-0 items-stretch gap-3 overflow-x-auto overflow-y-hidden pb-2",
                  hideListView ? "flex-1" : "h-full"
                )}
              >
                <SortableContext
                  items={columnsToShow.map((s) => `col:${s}`)}
                  strategy={horizontalListSortingStrategy}
                >
                  {columnsToShow.map((status) => {
                    const rawColTickets = ticketsByStatus.get(status) ?? [];
                    const colSort = columnSorts.get(status) ?? "default";
                    const colTickets = applyCardOrder(
                      applyColumnSort(rawColTickets, colSort),
                      boardSprintId && colSort === "default" ? cardOrder.get(status) : undefined
                    );
                    const cardReorderEnabled = Boolean(boardSprintId) && !dragDisabled && colSort === "default";
                    const colPoints = colTickets.reduce((sum, row) => sum + (row.storyPoints ?? 0), 0);
                    const columnSummary = t("boardColumnCountPoints", {
                      count: colTickets.length,
                      points: colPoints,
                    });
                    const titleKey = builtInStatusTitleKey(status);
                    const columnTitle = statusLabelMap.get(status) ?? (titleKey ? t(titleKey) : status);
                    const columnColor = statusColorMap.get(status);
                    const colStatusObj = (boardStatusesProp ?? []).find((s) => s.key === status);
                    return (
                      <SortableColumn
                        key={status}
                        status={status}
                        title={columnTitle}
                        color={columnColor}
                        columnSummary={columnSummary}
                        menu={teamId && colStatusObj ? (
                          <ColumnMenu
                            status={status}
                            teamId={teamId}
                            boardStatusId={colStatusObj.id}
                            tickets={colTickets}
                            activeStatuses={activeStatuses}
                            statusLabelMap={statusLabelMap}
                            currentSort={colSort}
                            onAddTicket={() => {
                              setNewTicketDefaultStatus(status);
                              setCreateTicketOpen(true);
                            }}
                            onMoveAll={(targetStatus) => {
                              void patchBulkStatuses(colTickets.map((t) => t.id), targetStatus);
                            }}
                            onDisable={() => void disableColumn(colStatusObj.id)}
                            onDelete={() => void deleteColumn(colStatusObj.id)}
                            onSort={(sort) => {
                              setColumnSorts((prev) => {
                                const next = new Map(prev);
                                if (sort === "default") next.delete(status);
                                else next.set(status, sort);
                                return next;
                              });
                            }}
                          />
                        ) : undefined}
                      >
                        {renderColumnCards(colTickets, status, columnColor, cardReorderEnabled)}
                      </SortableColumn>
                    );
                  })}
                </SortableContext>
                {teamId ? (
                  <AddColumnButton teamId={teamId} onAdded={handleColumnAdded} />
                ) : null}
              </div>
            ) : (
              <div className={cn("min-h-0 overflow-y-auto", hideListView ? "flex-1" : "h-full")}>
                {swimlaneGroups.map((group, groupIndex) => (
                  <SwimlaneRow
                    key={group.key}
                    label={group.label}
                    ticketCount={group.tickets.length}
                    flex={groupIndex === swimlaneGroups.length - 1}
                  >
                    <div className="ticket-board-scroll-x flex min-h-0 min-w-0 flex-1 items-stretch gap-3 overflow-x-auto overflow-y-hidden p-2">
                      {columnsToShow.map((status) => {
                        const laneStatusMap = new Map<string, TicketRow[]>();
                        for (const row of group.tickets) {
                          const list = laneStatusMap.get(row.status) ?? [];
                          list.push(row);
                          laneStatusMap.set(row.status, list);
                        }
                        const colSort = columnSorts.get(status) ?? "default";
                        const colTickets = applyCardOrder(
                          applyColumnSort(laneStatusMap.get(status) ?? [], colSort),
                          boardSprintId && colSort === "default" ? cardOrder.get(status) : undefined
                        );
                        const cardReorderEnabled = Boolean(boardSprintId) && !dragDisabled && colSort === "default";
                        const colPoints = colTickets.reduce((sum, row) => sum + (row.storyPoints ?? 0), 0);
                        const columnSummary = t("boardColumnCountPoints", {
                          count: colTickets.length,
                          points: colPoints,
                        });
                        const titleKey = builtInStatusTitleKey(status);
                        const columnTitle = statusLabelMap.get(status) ?? (titleKey ? t(titleKey) : status);
                        const columnColor = statusColorMap.get(status);
                        const droppableId = `${status}:${group.key}`;
                        return (
                          <KanbanColumn
                            key={status}
                            status={status}
                            droppableId={droppableId}
                            title={columnTitle}
                            color={columnColor}
                            columnSummary={columnSummary}
                          >
                            {renderColumnCards(colTickets, status, columnColor, cardReorderEnabled)}
                          </KanbanColumn>
                        );
                      })}
                    </div>
                  </SwimlaneRow>
                ))}
              </div>
            )}
          </div>
          <DragOverlay dropAnimation={null}>
            {activeColumnStatus ? (() => {
              const titleKey = builtInStatusTitleKey(activeColumnStatus);
              const title = statusLabelMap.get(activeColumnStatus) ?? (titleKey ? t(titleKey) : activeColumnStatus);
              const color = statusColorMap.get(activeColumnStatus);
              const count = (ticketsByStatus.get(activeColumnStatus) ?? []).length;
              const summary = t("boardColumnCountPoints", { count, points: 0 });
              return (
                <div className="w-[min(100vw-2rem,18rem)] shrink-0 cursor-grabbing rounded-md border border-primary/30 bg-muted/20 shadow-2xl ring-2 ring-primary/20 opacity-95 rotate-1">
                  <div className="shrink-0 border-b border-border px-3 py-2">
                    <h3 className="text-xs font-semibold leading-snug text-foreground">
                      <span className="flex items-center gap-1.5">
                        {color && (
                          <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
                        )}
                        {title}
                      </span>
                      <span className="mt-0.5 block text-[11px] font-normal tabular-nums text-muted-foreground">
                        {summary}
                      </span>
                    </h3>
                  </div>
                  <div className="flex flex-col gap-2 p-2">
                    {(ticketsByStatus.get(activeColumnStatus) ?? []).slice(0, 3).map((row) => (
                      <div key={row.id} className="h-14 rounded border border-border bg-card px-2 py-1.5 opacity-60">
                        <p className="mb-1 font-mono text-[10px] text-muted-foreground">{row.ref}</p>
                        <p className="line-clamp-1 text-xs font-medium text-foreground">{row.title}</p>
                      </div>
                    ))}
                    {count > 3 && (
                      <p className="px-1 text-[11px] text-muted-foreground">+{count - 3} more</p>
                    )}
                  </div>
                </div>
              );
            })() : dragBundle && dragBundle.ids.length > 1 ? (
              <div className="rounded-md border border-border bg-card px-3 py-2 text-xs font-medium shadow-lg">
                {t("boardBulkDraggingOverlay", { count: dragBundle.ids.length })}
              </div>
            ) : dragOverlayTicket ? (
              <div className="pointer-events-none w-[min(100vw-2rem,18rem)] max-w-[min(100vw-2rem,18rem)] cursor-grabbing">
                <div className="flex w-full origin-center scale-[1.03] rotate-[1.5deg] rounded-md border border-primary/20 bg-card shadow-2xl ring-2 ring-primary/20">
                  <KanbanCardVisual
                    ticket={dragOverlayTicket}
                    projectScoped={projectScoped}
                    disabled={dragDisabled}
                    selected={selectedIds.has(dragOverlayTicket.id)}
                    onOpen={() => {}}
                    onToggleSelect={() => {}}
                    mode="dragOverlay"
                  />
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {(!hideListView || canTriage) && !sprintBoardReadOnly ? (
        <CreateTicketDialog
          open={createTicketOpen}
          onOpenChange={(o) => {
            setCreateTicketOpen(o);
            if (!o) setNewTicketDefaultStatus(undefined);
          }}
          projectId={projectId}
          allowedProjectIds={allowedProjectIds}
          sprintId={newTicketSprintId}
          canTriage={canTriage}
          fetchTickets={fetchTickets}
          onCreated={onTicketCreated}
          defaultStatus={newTicketDefaultStatus}
        />
      ) : null}

      {addExistingSprintId ? (
        <AddExistingTicketsToSprintDialog
          open={addExistingOpen}
          onOpenChange={setAddExistingOpen}
          sprintId={addExistingSprintId}
          fetchTickets={fetchTickets}
        />
      ) : null}

      {selectedId && (
        <TicketDetailView
          variant="modal"
          ticketId={selectedId}
          locale={locale}
          canTriage={canTriage}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          onUpdate={async () => {}}
          onListRowPatched={mergeTicketFromPatchReport}
          onRequestClose={closeModal}
        />
      )}

      <Suspense fallback={null}>
        <TicketBoardOpenParamSync
          tickets={tickets}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          router={router}
          pathname={pathname}
          closingModalRef={closingModalRef}
        />
      </Suspense>

      {isAdmin && teamId && boardSettingsOpen ? (
        <BoardSettingsPanel
          teamId={teamId}
          boardStatuses={boardStatusesProp ?? []}
          swimlaneConfig={swimlaneConfig ?? null}
          onClose={() => setBoardSettingsOpen(false)}
          onSaved={(statuses, swimlane) => {
            onBoardConfigChange?.(statuses, swimlane);
            setBoardSettingsOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
