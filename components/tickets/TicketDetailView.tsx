"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  X,
  ZoomIn,
  Video,
  ExternalLink,
  Copy,
  Link2,
  Link2Off,
  AlertTriangle,
  Search,
  Bug,
  Lightbulb,
  MessageSquare,
  ChevronRight,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { buildTicketDetailAbsoluteUrl, ticketDetailPageHref } from "@/lib/ticket-urls";
import { buildTicketAgentPromptMarkdown } from "@/lib/ticket-agent-prompt";
import type { TicketCommentData } from "@/components/tickets/TicketCommentThread";
import { TicketCommentThread } from "@/components/tickets/TicketCommentThread";
import { TicketAttachmentsSection } from "@/components/tickets/TicketAttachmentsSection";
import { LinkedPRsSection } from "@/components/tickets/LinkedPRsSection";
import { filterMembersForTicketAssignee } from "@/lib/ticket-assignment";
import {
  TICKET_TYPE_KIND_VALUES,
  ticketTypeKindLabelKey,
  formatCustomTypeKey,
  type TicketHierarchyRow,
  type TicketReport,
  type TicketStatus,
  type TicketTypeKind,
  type TeamTicketType,
} from "@/components/tickets/ticket-types";
import { useCurrentTeam } from "@/contexts/CurrentTeamContext";
import { TICKET_STATUS_ORDER } from "@/lib/ticket-status";
import { TICKETS_INBOX_REFRESH_EVENT } from "@/lib/ticket-inbox-events";
import { toast } from "sonner";
import { useOptionalPageHeader } from "@/contexts/PageHeaderContext";
import { cn } from "@/lib/utils";
import { getClipboardImageFiles } from "@/lib/clipboard-image-paste";
import { renderRichText } from "@/lib/mention-render";
import { normalizeTagName, parseTagInput, TAG_NAME_MAX_LENGTH } from "@/lib/tag-normalize";
import { TagSuggestInput } from "@/components/tickets/TagSuggestInput";

let ticketModalBodyLockCount = 0;

function ticketModalLockBodyScroll(): () => void {
  ticketModalBodyLockCount += 1;
  if (ticketModalBodyLockCount === 1) {
    document.body.style.overflow = "hidden";
  }
  return () => {
    ticketModalBodyLockCount -= 1;
    if (ticketModalBodyLockCount <= 0) {
      ticketModalBodyLockCount = 0;
      document.body.style.overflow = "";
    }
  };
}

function ticketStatusLabel(t: (key: string) => string, status: TicketStatus): string {
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
  // Custom status: format the raw key into a readable label
  return status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const BUILT_IN_STATUS_STYLES: Partial<Record<string, string>> = {
  BACKLOG: "bg-muted text-muted-foreground",
  READY: "bg-warning-100 text-warning-700",
  IN_PROGRESS: "bg-primary-100 text-primary-700",
  FOR_REVIEW: "bg-primary-100 text-primary-700",
  RESOLVED: "bg-success-100 text-success-600",
  TO_BE_DEPLOYED: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
  DONE: "bg-success-100 text-success-700",
  ARCHIVED: "border border-dashed border-border bg-muted text-muted-foreground",
};
const FALLBACK_STATUS_STYLE = "bg-secondary text-secondary-foreground";

export function TicketStatusBadge({
  status,
  color,
}: {
  status: TicketStatus;
  /** Optional hex color from team board config — used as badge background for custom statuses. */
  color?: string | null;
}) {
  const t = useTranslations("tickets");

  if (color) {
    return (
      <span
        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
        style={{ backgroundColor: `${color}22`, color }}
      >
        {ticketStatusLabel(t, status)}
      </span>
    );
  }

  const cls = BUILT_IN_STATUS_STYLES[status] ?? FALLBACK_STATUS_STYLE;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${cls}`}
    >
      {ticketStatusLabel(t, status)}
    </span>
  );
}

export function TicketPriorityBadge({ priority }: { priority: "LOW" | "MEDIUM" | "HIGH" }) {
  const t = useTranslations("tickets");
  const styles: Record<typeof priority, string> = {
    LOW: "border-border bg-muted text-muted-foreground",
    MEDIUM: "border-warning-600 bg-warning-100 text-warning-700",
    HIGH: "border-error-600 bg-error-100 text-error-700",
  };
  const labels = { LOW: t("priorityLow"), MEDIUM: t("priorityMedium"), HIGH: t("priorityHigh") };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${styles[priority]}`}
    >
      {labels[priority]}
    </span>
  );
}

function TicketSectionHeading({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="mb-2 block text-[13px] font-bold uppercase tracking-wide text-muted-foreground">{children}</span>
  );
}

function ScreenshotLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const t = useTranslations("tickets");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("screenshotPreview")}
      className="fixed inset-0 z-330 flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
    >
      <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <button
          ref={closeRef}
          type="button"
          aria-label={t("screenshotClose")}
          onClick={onClose}
          className="absolute -right-3 -top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-card shadow-md text-foreground"
        >
          <X size={14} />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={t("screenshotPreview")} className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl" />
      </div>
    </div>
  );
}

function VideoPlayer({ url, onClose }: { url: string; onClose: () => void }) {
  const t = useTranslations("tickets");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("watchRecording")}
      className="fixed inset-0 z-330 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div className="relative w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
        <button
          ref={closeRef}
          type="button"
          aria-label={t("videoClose")}
          onClick={onClose}
          className="absolute -right-3 -top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-card shadow-md"
        >
          <X size={14} />
        </button>
        <video src={url} controls autoPlay className="w-full rounded-lg bg-black shadow-2xl" style={{ maxHeight: "80vh" }} />
      </div>
    </div>
  );
}

interface SprintSearchablePickerProps {
  value: { id: string; name: string } | null | undefined;
  options: ReadonlyArray<{ id: string; name: string }>;
  saving: boolean;
  disabled: boolean;
  isModal: boolean;
  onPick: (sprintId: string | null) => void;
}

function SprintSearchablePicker({
  value,
  options,
  saving,
  disabled,
  isModal,
  onPick,
}: SprintSearchablePickerProps): React.ReactElement {
  const t = useTranslations("tickets");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return [...options];
    return options.filter((o) => o.name.toLowerCase().includes(n));
  }, [options, q]);

  const triggerClass = cn(
    "flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-border bg-card text-left text-xs text-foreground",
    isModal ? "h-7 px-2 py-0" : "h-8 px-2 py-0",
    (disabled || saving) && "cursor-not-allowed opacity-60"
  );

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <button
        type="button"
        className={triggerClass}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={t("sprintChangeAria")}
        disabled={disabled || saving}
        onClick={() => {
          if (disabled || saving) return;
          setOpen((o) => !o);
        }}
      >
        <span className="min-w-0 flex-1 truncate">{value?.name ?? t("sprintNone")}</span>
        {saving ? <Loader2 size={12} className="shrink-0 animate-spin text-muted-foreground" aria-hidden /> : null}
        <ChevronRight
          className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
          aria-hidden
        />
      </button>
      {open ? (
        <div
          className="absolute z-50 mt-1 w-full min-w-[12rem] max-w-[min(100vw-2rem,20rem)] rounded-md border border-border bg-card py-1 shadow-md"
          role="listbox"
        >
          <div className="border-b border-border px-2 py-1.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("sprintSearchPlaceholder")}
                className={cn(
                  "w-full rounded border border-border bg-muted/30 py-1 pl-7 pr-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  isModal ? "h-7" : "h-8"
                )}
                autoComplete="off"
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto py-0.5">
            <button
              type="button"
              className="flex w-full px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/60"
              onClick={() => {
                onPick(null);
                setOpen(false);
                setQ("");
              }}
            >
              {t("sprintNone")}
            </button>
            {filtered.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">{t("filterSprintEmpty")}</p>
            ) : (
              filtered.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="option"
                  aria-selected={value?.id === s.id}
                  className={cn(
                    "flex w-full px-2 py-1.5 text-left text-xs hover:bg-muted/60",
                    value?.id === s.id && "bg-muted/50 font-medium"
                  )}
                  onClick={() => {
                    onPick(s.id);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  {s.name}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export interface TicketDetailViewProps {
  variant: "modal" | "page";
  ticketId: string;
  locale: string;
  canTriage: boolean;
  /** ADMIN-only actions (e.g. link GitHub PR). */
  isAdmin: boolean;
  currentUserId: string;
  onUpdate: () => void | Promise<void>;
  /** When set (e.g. sprint board), merge PATCH response into list rows before refetch. */
  onListRowPatched?: (report: TicketReport) => void;
  onRequestClose: () => void;
  /** From `/projects/[projectId]/tickets/.../details`; used for URLs and layout. */
  routeProjectId?: string | null;
  /** Stacked related-ticket modals: higher values render above (z-index). */
  modalStackDepth?: number;
}

type AssigneeRow = NonNullable<TicketReport["assignee"]>;

export function TicketDetailView({
  variant,
  ticketId,
  locale,
  canTriage,
  isAdmin,
  currentUserId,
  onUpdate,
  onListRowPatched,
  onRequestClose,
  routeProjectId = null,
  modalStackDepth = 0,
}: TicketDetailViewProps) {
  const t = useTranslations("tickets");
  const tc = useTranslations("common");
  const tNav = useTranslations("nav");
  const tProjects = useTranslations("projects");
  const router = useRouter();
  const pageHeader = useOptionalPageHeader();
  const { currentTeam } = useCurrentTeam();
  const [teamTicketTypes, setTeamTicketTypes] = useState<TeamTicketType[]>([]);
  /** Stable ref — do not put whole `pageHeader` in effect deps (context value changes when `leading` updates). */
  const setShellLeading = pageHeader?.setLeading ?? null;

  const panelRef = useRef<HTMLDivElement>(null);
  const pageRootRef = useRef<HTMLElement>(null);
  const [ticket, setTicket] = useState<TicketReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [videoPlayerUrl, setVideoPlayerUrl] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [teamMembers, setTeamMembers] = useState<Array<{ id: string; name: string | null; email: string; role: string }>>(
    []
  );
  const [teamLoading, setTeamLoading] = useState(false);
  const [assigneeSaving, setAssigneeSaving] = useState(false);
  const [prioritySaving, setPrioritySaving] = useState(false);
  const [copyingAgentPrompt, setCopyingAgentPrompt] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [linkingMode, setLinkingMode] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkResults, setLinkResults] = useState<
    Array<{ id: string; ref: string; shortId: number; title: string }>
  >([]);
  const [linkSearching, setLinkSearching] = useState(false);
  const [linkSaving, setLinkSaving] = useState(false);
  const [unlinkSaving, setUnlinkSaving] = useState(false);
  const [unlinkingCanonicalId, setUnlinkingCanonicalId] = useState<string | null>(null);
  const [activeDupTab, setActiveDupTab] = useState(0);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [descriptionSaving, setDescriptionSaving] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);
  const [pendingDescImages, setPendingDescImages] = useState<Array<{ file: File; localUrl: string }>>([]);
  const [attachmentsRefreshKey, setAttachmentsRefreshKey] = useState(0);
  const [assigneeOverride, setAssigneeOverride] = useState<"useProp" | AssigneeRow | null>("useProp");
  const [priorityOverride, setPriorityOverride] = useState<"useProp" | "LOW" | "MEDIUM" | "HIGH" | null>("useProp");
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [sprints, setSprints] = useState<Array<{ id: string; name: string }>>([]);
  const [sprintSaving, setSprintSaving] = useState(false);
  const [metaSaving, setMetaSaving] = useState(false);
  const [newTagInput, setNewTagInput] = useState("");
  const [relatedDetailTicketId, setRelatedDetailTicketId] = useState<string | null>(null);
  const [modalConfigOpen, setModalConfigOpen] = useState(false);
  const [modalModerationOpen, setModalModerationOpen] = useState(false);
  const [modalHierarchyOpen, setModalHierarchyOpen] = useState(false);
  const [modalPossibleDupOpen, setModalPossibleDupOpen] = useState(false);
  const [similarCandidates, setSimilarCandidates] = useState<
    Array<{
      id: string;
      ref: string;
      shortId: number;
      title: string;
      status: TicketStatus;
      priority: "LOW" | "MEDIUM" | "HIGH" | null;
      similarity: number;
    }>
  >([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [linkingFromSimilarId, setLinkingFromSimilarId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/tickets/${ticketId}`);
    if (!res.ok) {
      toast.error(t("ticketNotFound"));
      setTicket(null);
      setLoading(false);
      return;
    }
    const data = (await res.json()) as TicketReport & { commentsCount?: number };
    setTicket(data);
    setLoading(false);
  }, [ticketId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!currentTeam?.teamId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/teams/${encodeURIComponent(currentTeam.teamId)}/ticket-types`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { ticketTypes: TeamTicketType[] };
        if (!cancelled) setTeamTicketTypes(data.ticketTypes.filter((tt) => tt.isEnabled));
      } catch {
        // non-fatal — hardcoded fallback used in render
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentTeam?.teamId]);

  const enabledTicketTypes: TeamTicketType[] = teamTicketTypes.length > 0
    ? teamTicketTypes
    : TICKET_TYPE_KIND_VALUES.map((k, i) => ({
        id: k,
        name: k.charAt(0) + k.slice(1).toLowerCase().replace(/_/g, " "),
        key: k,
        isBuiltIn: true,
        isEnabled: true,
        sortOrder: i,
      }));

  function getTicketTypeLabel(key: string): string {
    const fromTeam = teamTicketTypes.find((tt) => tt.key === key);
    if (fromTeam) return fromTeam.name;
    const i18nKey = ticketTypeKindLabelKey(key);
    if (i18nKey) return t(i18nKey);
    return formatCustomTypeKey(key);
  }

  useEffect(() => {
    setRelatedDetailTicketId(null);
  }, [ticketId]);

  useEffect(() => {
    setModalConfigOpen(false);
    setModalModerationOpen(false);
    setModalHierarchyOpen(false);
    setModalPossibleDupOpen(false);
  }, [ticketId]);

  /**
   * Fetch semantic-duplicate candidates for this ticket. We only request
   * suggestions when the ticket is a viable triage target: not itself a
   * duplicate, not archived, and known to load. The endpoint already filters
   * out already-linked pairs and dismissed pairs.
   */
  const loadSimilar = useCallback(async () => {
    if (!ticket) return;
    if (ticket.duplicateOf || ticket.status === "ARCHIVED") {
      setSimilarCandidates([]);
      return;
    }
    setSimilarLoading(true);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/similar`);
      if (!res.ok) {
        setSimilarCandidates([]);
        return;
      }
      const data = (await res.json()) as {
        candidates: Array<{
          id: string;
          ref: string;
          shortId: number;
          title: string;
          status: TicketStatus;
          priority: "LOW" | "MEDIUM" | "HIGH" | null;
          similarity: number;
        }>;
      };
      setSimilarCandidates(data.candidates ?? []);
    } catch {
      setSimilarCandidates([]);
    } finally {
      setSimilarLoading(false);
    }
  }, [ticket, ticketId]);

  useEffect(() => {
    void loadSimilar();
  }, [loadSimilar]);

  useEffect(() => {
    setAssigneeOverride("useProp");
  }, [ticketId, ticket?.assignee?.id]);

  useEffect(() => {
    setPriorityOverride("useProp");
  }, [ticketId, ticket?.priority]);

  useEffect(() => {
    setNewTagInput("");
  }, [ticketId]);

  useEffect(() => {
    setIsEditingDescription(false);
    setDescriptionDraft("");
    setIsEditingTitle(false);
    setTitleDraft("");
  }, [ticketId]);

  useEffect(() => {
    if (!canTriage) return;
    let cancelled = false;
    void fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("projects"))))
      .then((data: { projects?: Array<{ id: string; name: string }> }) => {
        if (!cancelled) setProjects(data.projects ?? []);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canTriage]);

  useEffect(() => {
    if (!canTriage) return;
    let cancelled = false;
    void fetch("/api/sprints")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("sprints"))))
      .then((data: { sprints?: Array<{ id: string; name: string }> }) => {
        if (!cancelled) setSprints((data.sprints ?? []).map((s) => ({ id: s.id, name: s.name })));
      })
      .catch(() => {
        if (!cancelled) setSprints([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canTriage]);

  const displayAssignee: AssigneeRow | null =
    assigneeOverride === "useProp" ? (ticket?.assignee ?? null) : assigneeOverride;

  const displayPriority: "LOW" | "MEDIUM" | "HIGH" | null =
    priorityOverride === "useProp" ? (ticket?.priority ?? null) : priorityOverride;

  const showPrioritySection = canTriage || displayPriority !== null;
  const canAssign = canTriage || ticket?.user.id === currentUserId;
  const showAssigneeSection = canAssign || !!displayAssignee;

  const existingTagNamesNormalized = useMemo(
    () => new Set((ticket?.tags ?? []).map((x) => normalizeTagName(x.name))),
    [ticket?.tags]
  );

  const handleClose = useCallback(() => {
    if (lightboxOpen) {
      setLightboxOpen(false);
      return;
    }
    if (videoPlayerUrl) {
      setVideoPlayerUrl(null);
      return;
    }
    if (relatedDetailTicketId) {
      setRelatedDetailTicketId(null);
      return;
    }
    setIsEditingTitle(false);
    setTitleDraft("");
    setIsEditingDescription(false);
    setDescriptionDraft("");
    setPendingDescImages((prev) => {
      for (const p of prev) URL.revokeObjectURL(p.localUrl);
      return [];
    });
    onRequestClose();
  }, [lightboxOpen, videoPlayerUrl, relatedDetailTicketId, onRequestClose]);

  useEffect(() => {
    if (variant !== "modal") return;
    return ticketModalLockBodyScroll();
  }, [variant]);

  useEffect(() => {
    const el = variant === "page" ? pageRootRef.current : panelRef.current;
    if (variant === "modal") {
      el?.focus();
    }
    if (variant !== "modal") {
      return;
    }
    if (relatedDetailTicketId) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      handleClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [handleClose, variant, relatedDetailTicketId]);

  useEffect(() => {
    if (variant !== "page" || !ticket?.project?.id || !routeProjectId) return;
    if (routeProjectId !== ticket.project.id) {
      router.replace(`/projects/${ticket.project.id}/tickets/${ticket.id}/details`);
    }
  }, [variant, ticket, routeProjectId, router]);

  const copyPromptForAgent = useCallback(async () => {
    if (!ticket) return;
    setCopyingAgentPrompt(true);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/comments`);
      if (!res.ok) throw new Error("comments");
      const data = (await res.json()) as { comments: TicketCommentData[] };
      const appDeepLink = buildTicketDetailAbsoluteUrl(
        window.location.origin,
        locale,
        ticket.id,
        ticket.project?.id ?? routeProjectId ?? null
      );
      const markdown = buildTicketAgentPromptMarkdown(
        {
          id: ticket.id,
          shortId: ticket.shortId,
          ref: ticket.ref,
          title: ticket.title,
          description: ticket.description,
          pageUrl: ticket.pageUrl,
          status: ticket.status,
          priority: ticket.priority ?? null,
          type: ticket.type,
          source: ticket.source,
          createdAt: ticket.createdAt,
          user: ticket.user,
          assignee: ticket.assignee ?? null,
          adminNote: ticket.adminNote,
          screenshot: ticket.screenshot,
          videoUrl: ticket.videoUrl,
        },
        (data.comments ?? []).map((c) => ({
          body: c.body,
          createdAt: c.createdAt,
          author: c.author,
          attachments: c.attachments.map((a) => ({
            storageUrl: a.storageUrl,
            caption: a.caption,
            mimeType: a.mimeType,
          })),
        })),
        { appDeepLink }
      );
      await navigator.clipboard.writeText(markdown);
      toast.success(t("copyAgentPromptSuccess"));
    } catch {
      toast.error(t("copyAgentPromptFailed"));
    } finally {
      setCopyingAgentPrompt(false);
    }
  }, [ticket, ticketId, locale, routeProjectId, t]);

  useEffect(() => {
    if (!setShellLeading) return;
    if (variant !== "page" || loading || !ticket) {
      setShellLeading(null);
      return;
    }
    const effectiveProjectId = ticket.project?.id ?? routeProjectId ?? null;
    setShellLeading(
      <div className="flex min-w-0 max-w-full items-center justify-between gap-3">
        <Breadcrumb className="min-w-0 flex-1 text-xs">
          <BreadcrumbList>
            {effectiveProjectId ? (
              <>
                <BreadcrumbItem>
                  <Link href="/projects" className="hover:text-foreground">
                    {tNav("projects")}
                  </Link>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <Link
                    href={`/projects/${effectiveProjectId}/overview`}
                    className="max-w-40 truncate hover:text-foreground"
                  >
                    {ticket.project?.name ?? "…"}
                  </Link>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <Link href={`/projects/${effectiveProjectId}/tickets`} className="hover:text-foreground">
                    {tProjects("navTickets")}
                  </Link>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <span className="font-mono text-[11px] font-medium text-foreground" aria-current="page">
                    {ticket.ref}
                  </span>
                </BreadcrumbItem>
              </>
            ) : (
              <>
                <BreadcrumbItem>
                  <Link href="/tickets" className="hover:text-foreground">
                    {t("title")}
                  </Link>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <span className="font-mono text-[11px] font-medium text-foreground" aria-current="page">
                    {ticket.ref}
                  </span>
                </BreadcrumbItem>
              </>
            )}
          </BreadcrumbList>
        </Breadcrumb>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={copyingAgentPrompt}
          title={t("copyAgentPromptTitle")}
          aria-label={t("copyAgentPromptAria")}
          onClick={() => void copyPromptForAgent()}
        >
          {copyingAgentPrompt ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Copy size={14} aria-hidden />}
          {t("copyAgentPrompt")}
        </Button>
      </div>
    );
    return () => setShellLeading(null);
  }, [
    setShellLeading,
    variant,
    loading,
    ticket,
    routeProjectId,
    copyingAgentPrompt,
    copyPromptForAgent,
    t,
    tNav,
    tProjects,
  ]);

  useEffect(() => {
    if (!canAssign) return;
    let cancelled = false;
    setTeamLoading(true);
    void fetch("/api/tickets/assignees")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("team"))))
      .then((data: { data?: typeof teamMembers }) => {
        if (cancelled) return;
        setTeamMembers(data.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setTeamMembers([]);
      })
      .finally(() => {
        if (!cancelled) setTeamLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canAssign]);

  /** Parent hooks (e.g. overview) + global inbox list refresh via GET /api/tickets. */
  const refreshTicketLists = useCallback(async () => {
    await onUpdate();
    window.dispatchEvent(new Event(TICKETS_INBOX_REFRESH_EVENT));
  }, [onUpdate]);

  async function updateAssignee(assigneeId: string | null) {
    setAssigneeSaving(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId }),
      });
      if (!res.ok) throw new Error("assignee");
      const data = (await res.json()) as TicketReport;
      setAssigneeOverride(data.assignee ?? null);
      onListRowPatched?.(data);
      await refreshTicketLists();
      toast.success(t("assigneeUpdated"));
      void load();
    } catch {
      toast.error(t("assigneeUpdateFailed"));
    } finally {
      setAssigneeSaving(false);
    }
  }

  async function updateProject(projectId: string | null) {
    setMetaSaving(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error("project");
      const data = (await res.json()) as TicketReport;
      onListRowPatched?.(data);
      await refreshTicketLists();
      toast.success(t("projectUpdated"));
      void load();
    } catch {
      toast.error(t("projectUpdateFailed"));
    } finally {
      setMetaSaving(false);
    }
  }

  async function updateStoryPoints(raw: string) {
    let storyPoints: number | null;
    if (raw === "") {
      storyPoints = null;
    } else {
      const n = Number.parseInt(raw, 10);
      if (Number.isNaN(n) || n < 0 || n > 99) return;
      storyPoints = n;
    }

    setMetaSaving(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyPoints }),
      });
      if (!res.ok) throw new Error("sp");
      const data = (await res.json()) as TicketReport;
      onListRowPatched?.(data);
      await refreshTicketLists();
      toast.success(t("storyPointsUpdated"));
      void load();
    } catch {
      toast.error(t("storyPointsUpdateFailed"));
    } finally {
      setMetaSaving(false);
    }
  }

  async function setTicketTagNames(names: string[]): Promise<void> {
    setMetaSaving(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagNames: names }),
      });
      if (!res.ok) throw new Error("tags");
      const data = (await res.json()) as TicketReport;
      onListRowPatched?.(data);
      await refreshTicketLists();
      toast.success(t("tagsUpdated"));
      void load();
    } catch {
      toast.error(t("tagsUpdateFailed"));
    } finally {
      setMetaSaving(false);
    }
  }

  async function commitNewTagsFromInput(): Promise<void> {
    if (!ticket || metaSaving) return;
    const incoming = parseTagInput(newTagInput);
    if (incoming.length === 0) return;
    const existingNames = (ticket.tags ?? []).map((x) => x.name);
    const existingSet = new Set(existingNames);
    let added = false;
    for (const n of incoming) {
      if (!existingSet.has(n)) {
        existingSet.add(n);
        added = true;
      }
    }
    if (!added) return;
    const next = [...existingSet].sort((a, b) => a.localeCompare(b));
    await setTicketTagNames(next);
    setNewTagInput("");
  }

  async function removeTicketTag(tagName: string): Promise<void> {
    if (!ticket || metaSaving) return;
    const next = (ticket.tags ?? []).map((x) => x.name).filter((n) => n !== tagName);
    await setTicketTagNames(next);
  }

  function startEditingDescription() {
    if (!ticket) return;
    setIsEditingTitle(false);
    setTitleDraft("");
    setPendingDescImages((prev) => {
      for (const p of prev) URL.revokeObjectURL(p.localUrl);
      return [];
    });
    setDescriptionDraft(ticket.description ?? "");
    setIsEditingDescription(true);
  }

  function startEditingTitle() {
    if (!ticket) return;
    setIsEditingDescription(false);
    setDescriptionDraft("");
    setPendingDescImages((prev) => {
      for (const p of prev) URL.revokeObjectURL(p.localUrl);
      return [];
    });
    setTitleDraft(ticket.title);
    setIsEditingTitle(true);
  }

  function cancelEditingTitle() {
    setIsEditingTitle(false);
    setTitleDraft("");
  }

  function cancelEditingDescription() {
    setIsEditingDescription(false);
    setDescriptionDraft("");
    setPendingDescImages((prev) => {
      for (const p of prev) URL.revokeObjectURL(p.localUrl);
      return [];
    });
  }

  async function saveTitle() {
    if (!ticket) return;
    const trimmed = titleDraft.trim();
    if (trimmed.length === 0) {
      toast.error(t("titleRequired"));
      return;
    }
    if (trimmed === ticket.title.trim()) {
      setIsEditingTitle(false);
      setTitleDraft("");
      return;
    }
    setTitleSaving(true);
    const prevTitle = ticket.title;
    setTicket((prev) => (prev ? { ...prev, title: trimmed } : prev));
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) throw new Error("title");
      const data = (await res.json()) as TicketReport;
      onListRowPatched?.(data);
      await refreshTicketLists();
      toast.success(t("titleSaved"));
      setIsEditingTitle(false);
      setTitleDraft("");
      void load();
    } catch {
      setTicket((prev) => (prev ? { ...prev, title: prevTitle } : prev));
      toast.error(t("titleSaveFailed"));
    } finally {
      setTitleSaving(false);
    }
  }

  async function saveDescription() {
    if (!ticket) return;
    const trimmed = descriptionDraft.trim();
    if (trimmed.length === 0) {
      toast.error(t("descriptionRequired"));
      return;
    }
    const descUnchanged = trimmed === (ticket.description ?? "").trim();
    if (descUnchanged && pendingDescImages.length === 0) {
      setIsEditingDescription(false);
      return;
    }
    setDescriptionSaving(true);
    const prevDescription = ticket.description;
    if (!descUnchanged) {
      setTicket((prev) => (prev ? { ...prev, description: trimmed } : prev));
    }
    try {
      if (!descUnchanged) {
        const res = await fetch(`/api/tickets/${ticketId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: trimmed }),
        });
        if (!res.ok) throw new Error("description");
        const data = (await res.json()) as TicketReport;
        onListRowPatched?.(data);
        await refreshTicketLists();
      }

      if (pendingDescImages.length > 0) {
        const uploadedKeys: string[] = [];
        const uploadedUrls: string[] = [];
        const uploadedMimes: string[] = [];
        const uploadedSizes: number[] = [];
        const uploadedCaptions: string[] = [];
        for (let i = 0; i < pendingDescImages.length; i++) {
          const { file } = pendingDescImages[i]!;
          const form = new FormData();
          form.append("file", file);
          form.append("type", "tickets");
          const up = await fetch("/api/upload/field-media", { method: "POST", body: form });
          if (!up.ok) throw new Error("desc-image-upload");
          const row = (await up.json()) as {
            storageKey: string;
            storageUrl: string;
            mimeType: string;
            fileSizeBytes: number;
          };
          uploadedKeys.push(row.storageKey);
          uploadedUrls.push(row.storageUrl);
          uploadedMimes.push(row.mimeType);
          uploadedSizes.push(row.fileSizeBytes);
          uploadedCaptions.push("");
        }
        if (uploadedKeys.length > 0) {
          const attRes = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/attachments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              attachmentKeys: uploadedKeys,
              attachmentUrls: uploadedUrls,
              attachmentMimeTypes: uploadedMimes,
              attachmentFileSizeBytes: uploadedSizes,
              attachmentCaptions: uploadedCaptions,
            }),
          });
          if (!attRes.ok) throw new Error("desc-image-attach");
        }
        setPendingDescImages((prev) => {
          for (const p of prev) URL.revokeObjectURL(p.localUrl);
          return [];
        });
        setAttachmentsRefreshKey((k) => k + 1);
      }
      toast.success(t("descriptionSaved"));
      setIsEditingDescription(false);
      setDescriptionDraft("");
      void load();
    } catch {
      if (!descUnchanged) {
        setTicket((prev) => (prev ? { ...prev, description: prevDescription } : prev));
      }
      toast.error(t("descriptionSaveFailed"));
    } finally {
      setDescriptionSaving(false);
    }
  }

  function handleDescriptionPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = getClipboardImageFiles(e);
    if (files.length === 0) return;
    e.preventDefault();
    setPendingDescImages((prev) => {
      const next = [...prev];
      for (const file of files) {
        if (next.length >= 10) break;
        next.push({ file, localUrl: URL.createObjectURL(file) });
      }
      return next;
    });
  }

  async function updatePriority(raw: string) {
    const next: "LOW" | "MEDIUM" | "HIGH" | null = raw === "" ? null : (raw as "LOW" | "MEDIUM" | "HIGH");
    if (raw !== "" && raw !== "LOW" && raw !== "MEDIUM" && raw !== "HIGH") return;

    setPrioritySaving(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: next }),
      });
      if (!res.ok) throw new Error("priority");
      const data = (await res.json()) as TicketReport;
      setPriorityOverride(data.priority ?? null);
      onListRowPatched?.(data);
      await refreshTicketLists();
      toast.success(t("priorityUpdated"));
      void load();
    } catch {
      toast.error(t("priorityUpdateFailed"));
    } finally {
      setPrioritySaving(false);
    }
  }

  function openInNewTab() {
    if (!ticket) return;
    const pid = ticket.project?.id ?? routeProjectId ?? null;
    const url = buildTicketDetailAbsoluteUrl(window.location.origin, locale, ticket.id, pid);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function searchTicketsForLink(q: string) {
    setLinkSearching(true);
    try {
      const res = await fetch("/api/tickets");
      if (!res.ok) return;
      const data = (await res.json()) as {
        tickets: Array<{
          id: string;
          ref: string;
          shortId: number;
          title: string;
          duplicateOf?: { canonicalId: string } | null;
        }>;
      };
      const term = q.toLowerCase();
      setLinkResults(
        (data.tickets ?? [])
          .filter(
            (r) =>
              r.id !== ticketId &&
              !r.duplicateOf &&
              (r.title.toLowerCase().includes(term) || r.ref.toLowerCase().includes(term))
          )
          .slice(0, 8)
          .map((r) => ({ id: r.id, ref: r.ref, shortId: r.shortId, title: r.title }))
      );
    } catch {
      setLinkResults([]);
    } finally {
      setLinkSearching(false);
    }
  }

  async function linkAsDuplicate(canonicalId: string, similarity?: number) {
    setLinkSaving(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/link-duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          similarity !== undefined ? { canonicalId, similarity } : { canonicalId }
        ),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? t("linkDuplicateFailed"));
        return;
      }
      toast.success(t("linkDuplicateSuccess"));
      setLinkingMode(false);
      setLinkSearch("");
      setLinkResults([]);
      await refreshTicketLists();
      void load();
      void loadSimilar();
    } catch {
      toast.error(t("linkDuplicateFailed"));
    } finally {
      setLinkSaving(false);
    }
  }

  /**
   * "Keep separate" for a suggested duplicate pair. Persists a TicketDuplicateDismissal
   * scoped to the ticket's project so the pair never resurfaces as a suggestion.
   */
  async function dismissSimilarCandidate(otherTicketId: string) {
    const projectId = ticket?.project?.id ?? routeProjectId;
    if (!projectId) {
      toast.error(t("keepSeparateFailed"));
      return;
    }
    setDismissingId(otherTicketId);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/duplicates/dismiss`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketAId: ticketId, ticketBId: otherTicketId }),
        }
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(err?.error ?? t("keepSeparateFailed"));
        return;
      }
      toast.success(t("keepSeparateSuccess"));
      setSimilarCandidates((prev) => prev.filter((c) => c.id !== otherTicketId));
    } catch {
      toast.error(t("keepSeparateFailed"));
    } finally {
      setDismissingId(null);
    }
  }

  /**
   * Mark the current ticket as a duplicate of a suggested candidate. This is a
   * thin wrapper around `linkAsDuplicate` that also tracks which row is saving
   * (so we can show a loading indicator per-row in the suggestions list).
   */
  async function linkFromSimilarCandidate(canonicalId: string, similarity: number) {
    setLinkingFromSimilarId(canonicalId);
    try {
      await linkAsDuplicate(canonicalId, similarity);
    } finally {
      setLinkingFromSimilarId(null);
    }
  }

  async function unlinkDuplicate() {
    setUnlinkSaving(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/link-duplicate`, { method: "DELETE" });
      if (!res.ok) throw new Error("unlink");
      toast.success(t("unlinkDuplicateSuccess"));
      await refreshTicketLists();
      void load();
    } catch {
      toast.error(t("unlinkDuplicateFailed"));
    } finally {
      setUnlinkSaving(false);
    }
  }

  async function unlinkDuplicateFromCanonical(duplicateId: string) {
    if (!ticket) return;
    setUnlinkingCanonicalId(duplicateId);
    try {
      const res = await fetch(
        `/api/tickets/${ticket.id}/link-duplicate?duplicateId=${encodeURIComponent(duplicateId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("unlink");
      setActiveDupTab(0);
      toast.success(t("unlinkDuplicateSuccess"));
      await refreshTicketLists();
      void load();
    } catch {
      toast.error(t("unlinkDuplicateFailed"));
    } finally {
      setUnlinkingCanonicalId(null);
    }
  }

  async function updateStatus(status: TicketStatus) {
    const prevStatus = ticket?.status;
    setTicket((prev) => (prev ? { ...prev, status } : prev));
    setUpdatingStatus(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update");
      const data = (await res.json()) as TicketReport;
      onListRowPatched?.(data);
      await refreshTicketLists();
      toast.success(t("statusUpdated"));
      void load();
    } catch {
      setTicket((prev) => (prev && prevStatus ? { ...prev, status: prevStatus } : prev));
      toast.error(t("statusUpdateFailed"));
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function updateType(next: TicketTypeKind) {
    if (!ticket || next === ticket.type) return;
    setMetaSaving(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: next }),
      });
      if (!res.ok) throw new Error("type");
      const data = (await res.json()) as TicketReport;
      onListRowPatched?.(data);
      await refreshTicketLists();
      toast.success(t("typeUpdated"));
      void load();
    } catch {
      toast.error(t("typeUpdateFailed"));
    } finally {
      setMetaSaving(false);
    }
  }

  async function updateSprint(sprintId: string | null) {
    setSprintSaving(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sprintId }),
      });
      const body: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof body === "object" && body !== null && "error" in body && typeof (body as { error: unknown }).error === "string"
          ? (body as { error: string }).error
          : t("sprintUpdateFailed");
        toast.error(msg);
        return;
      }
      const data = body as TicketReport;
      onListRowPatched?.(data);
      await refreshTicketLists();
      toast.success(t("sprintUpdated"));
      void load();
    } catch {
      toast.error(t("sprintUpdateFailed"));
    } finally {
      setSprintSaving(false);
    }
  }

  if (loading || !ticket) {
    if (variant === "modal") {
      const modalLayerZ = 310 + modalStackDepth * 10;
      return (
        <div
          className="fixed inset-0 flex items-center justify-center sm:p-4"
          role="presentation"
          style={{ zIndex: modalLayerZ }}
          onClick={handleClose}
        >
          <div className="absolute inset-0 bg-black/50" aria-hidden />
          <div
            className="relative flex items-center justify-center rounded-2xl bg-card px-10 py-8 shadow-xl"
            role="status"
            aria-label={tc("loading")}
            onClick={(e) => e.stopPropagation()}
          >
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
          </div>
        </div>
      );
    }

    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const submittedWhen = new Date(ticket.createdAt).toLocaleString(locale === "es" ? "es" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const eligibleAssignees = filterMembersForTicketAssignee(teamMembers);
  const orphanAssignee =
    displayAssignee && !eligibleAssignees.some((m) => m.id === displayAssignee.id) ? displayAssignee : null;

  const dups = ticket.canonicalDuplicates ?? [];
  const activeDup = activeDupTab > 0 ? dups[activeDupTab - 1] : null;

  function renderContextStrip(isModal: boolean) {
    if (!ticket) return null;
    const txt = isModal ? "text-xs text-muted-foreground" : "text-sm text-muted-foreground";
    const sep = <span className="text-muted-foreground/50">·</span>;
    return (
      <div className={`flex flex-wrap items-baseline gap-x-2 gap-y-1.5 ${txt}`}>
        <span>
          <span className="font-medium text-foreground">{t("submittedBy")}</span> {ticket.user.name ?? ticket.user.email}
        </span>
        {sep}
        <time dateTime={ticket.createdAt}>{submittedWhen}</time>
        {sep}
        <span className="inline-flex items-center gap-1 font-medium text-foreground">
          {ticket.type === "BUG" ? (
            <Bug size={12} className="text-error-600" aria-hidden />
          ) : ticket.type === "FEATURE_REQUEST" ? (
            <Lightbulb size={12} className="text-primary" aria-hidden />
          ) : ticket.type === "FEEDBACK" ? (
            <MessageSquare size={12} className="text-teal-600" aria-hidden />
          ) : ticket.type === "MINOR_ENHANCEMENT" ? (
            <Zap size={12} className="text-amber-600" aria-hidden />
          ) : ticket.type === "REGRESSION" ? (
            <RotateCcw size={12} className="text-orange-600" aria-hidden />
          ) : (
            <ShieldCheck size={12} className="text-violet-600" aria-hidden />
          )}
          {getTicketTypeLabel(ticket.type)}
        </span>
        {ticket.source === "MARKER_IO" && (
          <>
            {sep}
            <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-foreground">{t("sourceMarkerIo")}</span>
          </>
        )}
        {ticket.source === "FIELD_TRACKER" && (
          <>
            {sep}
            <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-foreground">{t("sourceFieldTracker")}</span>
          </>
        )}
        {ticket.source === "FIELD_TRACKER" && ticket.environment && (
          <>
            {sep}
            <span
              className={[
                "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                ticket.environment === "prod"
                  ? "border-error-300 bg-error-50 text-error-700"
                  : "border-primary-300 bg-primary-50 text-primary-700",
              ].join(" ")}
            >
              {ticket.environment === "prod" ? t("environmentProd") : t("environmentDev")}
            </span>
          </>
        )}
        {ticket.parent && (
          <>
            {sep}
            <Link
              href={ticketDetailPageHref(ticket.parent.id, ticket.project?.id ?? null)}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {t("parentBadge", { ref: (ticket.parent?.ref ?? "") })}
            </Link>
          </>
        )}
        {ticket.viewerContext === "mentioned" && (
          <>
            {sep}
            <span className="rounded-full border border-primary px-2 py-0.5 text-[11px] text-primary">{t("mentionedBadge")}</span>
          </>
        )}
      </div>
    );
  }

  function renderTicketPropertiesCard(
    surface: "modal" | "pageSidebar",
    options?: { bareModalBody?: boolean }
  ) {
    if (!ticket) return null;
    const isModal = surface === "modal";
    const lbl = "text-xs font-medium text-muted-foreground";
    const sel = isModal
      ? "h-7 w-full min-w-0 cursor-pointer rounded-md border border-border bg-card py-0 pl-2 pr-6 text-xs text-foreground"
      : "h-8 w-full min-w-0 cursor-pointer rounded-md border border-border bg-card py-0 pl-2 pr-7 text-xs text-foreground";
    const spinSm = 12;
    const spInputClass = isModal
      ? "h-7 w-full max-w-[8rem] rounded-md border border-border bg-card px-2 text-xs text-foreground"
      : "h-8 w-full max-w-full rounded-md border border-border bg-card px-2 text-xs text-foreground";
    const tagInputClass = isModal
      ? "h-7 w-full min-w-0 rounded-md border border-border bg-card px-2 text-xs text-foreground"
      : "h-8 w-full min-w-0 rounded-md border border-border bg-card px-2 text-xs text-foreground";
    const tagPillClass =
      "inline-flex rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-foreground";
    const tagPillEditableClass =
      "group inline-flex max-w-full items-center gap-0.5 rounded-full border border-border bg-muted/40 py-0.5 pl-2 pr-0.5 text-[11px] text-foreground";
    const roText = "text-xs text-foreground";
    const roMuted = "text-xs text-muted-foreground";
    const gridClass = isModal ? "grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-x-4 sm:gap-y-3" : "grid grid-cols-1 gap-3";

    const body = (
      <>
        <div className={gridClass}>
          <div className="flex min-w-0 flex-col gap-0.5 sm:gap-1">
            <span className={lbl}>{t("filterStatus")}</span>
            {canTriage ? (
              <select
                className={sel}
                value={ticket.status}
                onChange={(e) => void updateStatus(e.target.value as TicketStatus)}
                disabled={updatingStatus}
                aria-label={t("statusChangeAria")}
              >
                {TICKET_STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {ticketStatusLabel(t, s)}
                  </option>
                ))}
              </select>
            ) : (
              <TicketStatusBadge status={ticket.status} />
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-0.5 sm:gap-1">
            <span className={lbl}>{t("createTicketTypeLabel")}</span>
            {canTriage ? (
              <select
                className={sel}
                disabled={metaSaving}
                value={ticket.type}
                onChange={(e) => void updateType(e.target.value as TicketTypeKind)}
                aria-label={t("createTicketTypeLabel")}
              >
                {enabledTicketTypes.map((tt) => (
                  <option key={tt.key} value={tt.key}>
                    {tt.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className={`inline-flex items-center gap-1.5 ${roText}`}>
                {ticket.type === "BUG" ? (
                  <Bug size={14} className="shrink-0 text-error-600" aria-hidden />
                ) : ticket.type === "FEATURE_REQUEST" ? (
                  <Lightbulb size={14} className="shrink-0 text-primary" aria-hidden />
                ) : ticket.type === "FEEDBACK" ? (
                  <MessageSquare size={14} className="shrink-0 text-teal-600" aria-hidden />
                ) : ticket.type === "MINOR_ENHANCEMENT" ? (
                  <Zap size={14} className="shrink-0 text-amber-600" aria-hidden />
                ) : ticket.type === "REGRESSION" ? (
                  <RotateCcw size={14} className="shrink-0 text-orange-600" aria-hidden />
                ) : (
                  <ShieldCheck size={14} className="shrink-0 text-violet-600" aria-hidden />
                )}
                {getTicketTypeLabel(ticket.type)}
              </span>
            )}
          </div>

          {showPrioritySection ? (
            <div className="flex min-w-0 flex-col gap-0.5 sm:gap-1">
              <span className={lbl}>{t("priorityLabel")}</span>
              {canTriage ? (
                <div className="flex items-center gap-1.5">
                  <select
                    className={sel}
                    aria-label={t("priorityChangeAria")}
                    disabled={prioritySaving}
                    value={displayPriority ?? ""}
                    onChange={(e) => void updatePriority(e.target.value)}
                  >
                    <option value="">{t("priorityNone")}</option>
                    <option value="LOW">{t("priorityLow")}</option>
                    <option value="MEDIUM">{t("priorityMedium")}</option>
                    <option value="HIGH">{t("priorityHigh")}</option>
                  </select>
                  {prioritySaving ? <Loader2 size={spinSm} className="shrink-0 animate-spin text-muted-foreground" aria-hidden /> : null}
                </div>
              ) : displayPriority ? (
                <TicketPriorityBadge priority={displayPriority} />
              ) : (
                <span className={roMuted}>—</span>
              )}
            </div>
          ) : null}

          {showAssigneeSection ? (
            <div className="flex min-w-0 flex-col gap-0.5 sm:gap-1">
              <span className={lbl}>{t("assigneeLabel")}</span>
              {canAssign ? (
                <div className="flex items-center gap-1.5">
                  <select
                    className={sel}
                    aria-label={t("assigneeChangePlaceholder")}
                    disabled={assigneeSaving || teamLoading}
                    value={displayAssignee?.id ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      void updateAssignee(v === "" ? null : v);
                    }}
                  >
                    <option value="">{t("assigneeUnassigned")}</option>
                    {orphanAssignee ? (
                      <option value={orphanAssignee.id}>{orphanAssignee.name ?? orphanAssignee.email}</option>
                    ) : null}
                    {eligibleAssignees
                      .filter((m) => m.id !== orphanAssignee?.id)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name ?? m.email}
                        </option>
                      ))}
                  </select>
                  {assigneeSaving ? <Loader2 size={spinSm} className="shrink-0 animate-spin text-muted-foreground" aria-hidden /> : null}
                </div>
              ) : (
                <span className={roText}>
                  {displayAssignee ? displayAssignee.name ?? displayAssignee.email : t("assigneeUnassigned")}
                </span>
              )}
            </div>
          ) : null}

          {(canTriage || !!ticket.project) && (
            <div className="flex min-w-0 flex-col gap-0.5 sm:gap-1">
              <span className={lbl}>{t("projectLabel")}</span>
              {canTriage ? (
                <select
                  className={sel}
                  disabled={metaSaving}
                  value={ticket.project?.id ?? ""}
                  onChange={(e) => void updateProject(e.target.value === "" ? null : e.target.value)}
                  aria-label={t("projectChangeAria")}
                >
                  <option value="">{t("projectNone")}</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : ticket.project ? (
                <span className={roText}>{ticket.project.name}</span>
              ) : (
                <span className={roMuted}>—</span>
              )}
            </div>
          )}

          {(canTriage || ticket.sprint) && (
            <div className="flex min-w-0 flex-col gap-0.5 sm:gap-1">
              <span className={lbl}>{t("sprintLabel")}</span>
              {canTriage ? (
                <SprintSearchablePicker
                  value={ticket.sprint ?? null}
                  options={sprints}
                  saving={sprintSaving}
                  disabled={metaSaving}
                  isModal={isModal}
                  onPick={(id) => {
                    void updateSprint(id);
                  }}
                />
              ) : ticket.sprint ? (
                <span className={roText}>{ticket.sprint.name}</span>
              ) : (
                <span className={roMuted}>—</span>
              )}
            </div>
          )}

          {(canTriage || ticket.storyPoints != null) && (
            <div className="flex min-w-0 flex-col gap-0.5 sm:gap-1">
              <span className={lbl}>{t("storyPointsLabel")}</span>
              {canTriage ? (
                <input
                  type="number"
                  min={0}
                  max={99}
                  className={spInputClass}
                  disabled={metaSaving}
                  defaultValue={ticket.storyPoints ?? ""}
                  key={`sp-${surface}-${ticketId}-${ticket.storyPoints ?? "x"}`}
                  onBlur={(e) => void updateStoryPoints(e.target.value)}
                  aria-label={t("storyPointsChangeAria")}
                />
              ) : (
                <span className={roText}>{ticket.storyPoints ?? "—"}</span>
              )}
            </div>
          )}
        </div>

        {(canTriage || (ticket.tags && ticket.tags.length > 0)) && (
          <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
            <span className={lbl}>{t("tagsLabel")}</span>
            {ticket.tags && ticket.tags.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {ticket.tags.map((tag) =>
                  canTriage ? (
                    <span key={tag.id} className={tagPillEditableClass}>
                      <span className="min-w-0 max-w-full wrap-break-word">{tag.name}</span>
                      <button
                        type="button"
                        disabled={metaSaving}
                        onClick={() => void removeTicketTag(tag.name)}
                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        aria-label={t("tagRemoveAria", { name: tag.name })}
                      >
                        <X size={12} aria-hidden />
                      </button>
                    </span>
                  ) : (
                    <span key={tag.id} className={tagPillClass}>
                      {tag.name}
                    </span>
                  )
                )}
              </div>
            ) : null}
            {canTriage ? (
              <>
                <TagSuggestInput
                  className={tagInputClass}
                  value={newTagInput}
                  onChange={setNewTagInput}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    void commitNewTagsFromInput();
                  }}
                  placeholder={t("tagsPlaceholder")}
                  disabled={metaSaving}
                  aria-label={t("tagsInputAria")}
                  excludeNormalizedNames={existingTagNamesNormalized}
                />
                <p className="text-xs text-muted-foreground">{t("tagMaxLengthHint", { max: TAG_NAME_MAX_LENGTH })}</p>
              </>
            ) : null}
          </div>
        )}
      </>
    );

    if (isModal && options?.bareModalBody) {
      return <>{body}</>;
    }
    if (isModal) {
      return (
        <div className="rounded-xl border border-border bg-card/80 p-3 shadow-sm sm:p-4">{body}</div>
      );
    }
    return <div className="min-w-0">{body}</div>;
  }

  function renderHierarchyCard(
    surface: "modal" | "pageSidebar",
    options?: { bareModalBody?: boolean }
  ): React.ReactElement | null {
    if (!ticket) return null;
    const childrenList = ticket.childTickets ?? [];
    const siblings = ticket.siblingTickets ?? [];
    const showAsParent = childrenList.length > 0;
    const showAsChild = !showAsParent && !!ticket.parent;
    if (!showAsParent && !showAsChild) return null;

    const isModal = surface === "modal";
    const rowClass = isModal
      ? "flex w-full min-w-0 cursor-pointer items-start gap-2 rounded-md border border-border bg-card px-2 py-2 text-left text-xs text-foreground hover:bg-muted/50"
      : "flex w-full min-w-0 cursor-pointer items-start gap-2 rounded-md border border-border bg-card px-2 py-2.5 text-left text-xs text-foreground hover:bg-muted/50";

    const blockInner = showAsParent ? (
      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground">{t("childTicketsHeading")}</span>
        <ul className="list-none space-y-1.5 p-0">
          {childrenList.map((row: TicketHierarchyRow) => (
            <li key={row.id}>
              <button
                type="button"
                className={rowClass}
                onClick={() => setRelatedDetailTicketId(row.id)}
                aria-label={`${row.ref} — ${row.title}`}
              >
                <span className="shrink-0 font-mono">{row.ref}</span>
                <span className="min-w-0 flex-1 truncate">{row.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    ) : (
      <div className="space-y-4">
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">{t("parentTicketHeading")}</span>
          {ticket.parent ? (
            <button
              type="button"
              className={rowClass}
              onClick={() => {
                const p = ticket.parent;
                if (p) setRelatedDetailTicketId(p.id);
              }}
              aria-label={`${ticket.parent?.ref} — ${ticket.parent.title}`}
            >
              <span className="shrink-0 font-mono">{ticket.parent?.ref}</span>
              <span className="min-w-0 flex-1 truncate">{ticket.parent.title}</span>
            </button>
          ) : null}
        </div>
        {siblings.length > 0 ? (
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">{t("siblingTicketsHeading")}</span>
            <ul className="list-none space-y-1.5 p-0">
              {siblings.map((row: TicketHierarchyRow) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={rowClass}
                    onClick={() => setRelatedDetailTicketId(row.id)}
                    aria-label={`${row.ref} — ${row.title}`}
                  >
                    <span className="shrink-0 font-mono">{row.ref}</span>
                    <span className="min-w-0 flex-1 truncate">{row.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );

    if (isModal && options?.bareModalBody) {
      return <>{blockInner}</>;
    }
    if (isModal) {
      return (
        <div
          className="mb-4 rounded-xl border border-border bg-card/80 p-3 shadow-sm sm:p-4"
          role="region"
          aria-label={t("ticketHierarchySection")}
        >
          <h3 className="mb-3 text-sm font-semibold text-foreground">{t("ticketHierarchySection")}</h3>
          {blockInner}
        </div>
      );
    }

    return (
      <section className="rounded-xl border border-border bg-card/80 p-4 shadow-sm" aria-label={t("ticketHierarchySection")}>
        <h2 className="text-sm font-semibold text-foreground">{t("ticketHierarchySection")}</h2>
        <div className="mt-3">{blockInner}</div>
      </section>
    );
  }

  /**
   * "Possible Duplicates" card — semantic-similarity suggestions surfaced for
   * the current ticket. Rendered alongside the hierarchy card (same visual
   * pattern) in both the modal (bare body embedded in a collapsible panel)
   * and page-sidebar surfaces. Hidden when there are no candidates, when the
   * ticket is already a duplicate, or when it's archived.
   */
  function renderPossibleDuplicatesCard(
    surface: "modal" | "pageSidebar",
    options?: { bareModalBody?: boolean }
  ): React.ReactElement | null {
    if (!ticket) return null;
    if (ticket.duplicateOf) return null;
    if (ticket.status === "ARCHIVED") return null;
    if (similarCandidates.length === 0) return null;

    const isModal = surface === "modal";
    const rowClass = isModal
      ? "flex w-full min-w-0 items-start gap-2 rounded-md border border-border bg-card px-2 py-2 text-left text-xs text-foreground"
      : "flex w-full min-w-0 items-start gap-2 rounded-md border border-border bg-card px-2 py-2.5 text-left text-xs text-foreground";

    const blockInner = (
      <ul className="list-none space-y-1.5 p-0">
        {similarCandidates.map((row) => {
          const percent = Math.round(row.similarity * 100);
          const isDismissing = dismissingId === row.id;
          const isLinking = linkingFromSimilarId === row.id;
          return (
            <li key={row.id}>
              <div className={rowClass}>
                <button
                  type="button"
                  onClick={() => setRelatedDetailTicketId(row.id)}
                  aria-label={`${row.ref} — ${row.title}`}
                  className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left hover:opacity-80"
                >
                  <span className="shrink-0 font-mono">{row.ref}</span>
                  <span className="min-w-0 flex-1 truncate">{row.title}</span>
                </button>
                <div className="ml-2 flex shrink-0 items-center gap-1.5" aria-label={t("possibleDuplicatesSimilarityAria", { percent })}>
                  <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-violet-400"
                      style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                    />
                  </div>
                  <span className="w-9 shrink-0 text-right text-[11px] font-semibold tabular-nums text-foreground">
                    {percent}%
                  </span>
                </div>
              </div>
              {canTriage ? (
                <div className="mt-1 flex flex-wrap items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => void linkFromSimilarCandidate(row.id, row.similarity)}
                    disabled={isLinking || isDismissing || linkSaving}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    {isLinking ? <Loader2 size={10} className="animate-spin" aria-hidden /> : <Link2 size={10} aria-hidden />}
                    {t("possibleDuplicatesActionLink")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void dismissSimilarCandidate(row.id)}
                    disabled={isDismissing || isLinking}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                  >
                    {isDismissing ? <Loader2 size={10} className="animate-spin" aria-hidden /> : null}
                    {t("possibleDuplicatesActionKeepSeparate")}
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    );

    if (isModal && options?.bareModalBody) {
      return <>{blockInner}</>;
    }
    if (isModal) {
      return (
        <div
          className="mb-4 rounded-xl border border-border bg-card/80 p-3 shadow-sm sm:p-4"
          role="region"
          aria-label={t("possibleDuplicatesSection")}
        >
          <h3 className="mb-3 text-sm font-semibold text-foreground">{t("possibleDuplicatesSection")}</h3>
          {blockInner}
        </div>
      );
    }

    return (
      <section
        className="rounded-xl border border-border bg-card/80 p-4 shadow-sm"
        aria-label={t("possibleDuplicatesSection")}
      >
        <h2 className="text-sm font-semibold text-foreground">{t("possibleDuplicatesSection")}</h2>
        <div className="mt-3">{blockInner}</div>
      </section>
    );
  }

  function renderRelatedTicketModal(): React.ReactElement | null {
    if (!relatedDetailTicketId) return null;
    return (
      <TicketDetailView
        variant="modal"
        ticketId={relatedDetailTicketId}
        locale={locale}
        canTriage={canTriage}
        isAdmin={isAdmin}
        currentUserId={currentUserId}
        onUpdate={onUpdate}
        onListRowPatched={onListRowPatched}
        onRequestClose={() => setRelatedDetailTicketId(null)}
        routeProjectId={routeProjectId}
        modalStackDepth={modalStackDepth + 1}
      />
    );
  }

  function renderTriageModerationSection(placement: "modal" | "pageSidebar" | "modalInner" = "modal") {
    if (!ticket || !canTriage) return null;
    const inner = (
      <div className="space-y-3">
          {ticket.status !== "ARCHIVED" ? (
            <>
              {!deletePending ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-fit border-red-200 text-red-600 hover:bg-red-50"
                  onClick={() => setDeletePending(true)}
                  disabled={updatingStatus}
                >
                  {t("deleteReport")}
                </Button>
              ) : (
                <span className="flex flex-wrap items-center gap-1.5">
                  <AlertTriangle size={12} className="shrink-0 text-red-600" aria-hidden />
                  <span className="text-xs text-red-600">{t("deleteConfirm")}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-400 text-red-600 hover:bg-red-50"
                    onClick={() => {
                      void updateStatus("ARCHIVED");
                      setDeletePending(false);
                    }}
                    disabled={updatingStatus}
                  >
                    {t("deleteConfirmYes")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeletePending(false)}>
                    {t("deleteConfirmNo")}
                  </Button>
                </span>
              )}
            </>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" onClick={() => void updateStatus("READY")} disabled={updatingStatus}>
                {updatingStatus ? <Loader2 size={12} className="mr-1 animate-spin" /> : null}
                {t("restoreReport")}
              </Button>
            </div>
          )}

          {!ticket.duplicateOf && ticket.status !== "ARCHIVED" && (
            <div>
              {!linkingMode ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-xs text-muted-foreground"
                  onClick={() => {
                    setLinkingMode(true);
                    void searchTicketsForLink("");
                  }}
                >
                  <Link2 size={12} aria-hidden />
                  {t("linkAsDuplicate")}
                </Button>
              ) : (
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <p className="mb-2 text-xs font-medium text-foreground">{t("linkDuplicateSearch")}</p>
                  <div className="relative mb-2">
                    <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    <input
                      type="text"
                      className="h-8 w-full rounded-md border border-border bg-card pl-7 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder={t("linkDuplicatePlaceholder")}
                      value={linkSearch}
                      aria-label={t("linkDuplicatePlaceholder")}
                      onChange={(e) => {
                        setLinkSearch(e.target.value);
                        void searchTicketsForLink(e.target.value);
                      }}
                    />
                  </div>
                  {linkSearching && <p className="text-xs text-muted-foreground">{t("searching")}</p>}
                  {!linkSearching && linkResults.length === 0 && linkSearch.length > 0 && (
                    <p className="text-xs text-muted-foreground">{t("noResults")}</p>
                  )}
                  {linkResults.length > 0 && (
                    <ul className="space-y-1">
                      {linkResults.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            disabled={linkSaving}
                            onClick={() => void linkAsDuplicate(r.id)}
                            className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
                          >
                            <span className="font-mono font-semibold text-muted-foreground">{r.ref}</span>
                            <span className="ml-2 text-foreground">{r.title}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 flex justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs"
                      onClick={() => {
                        setLinkingMode(false);
                        setLinkSearch("");
                        setLinkResults([]);
                      }}
                    >
                      {tc("cancel")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {ticket.duplicateOf && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
              <Link2 size={12} className="shrink-0 text-amber-600" aria-hidden />
              <span className="min-w-0 text-xs text-amber-900 dark:text-amber-100">
                {t("duplicateOfLabel")}{" "}
                <span className="font-semibold">{ticket.duplicateOf.canonical.ref}</span>
                {" — "}
                {ticket.duplicateOf.canonical.title}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-6 shrink-0 px-2 text-xs text-amber-800 hover:bg-amber-100 dark:text-amber-200"
                disabled={unlinkSaving}
                onClick={() => void unlinkDuplicate()}
                aria-label={t("unlinkDuplicateAria")}
              >
                {unlinkSaving ? <Loader2 size={10} className="animate-spin" /> : <Link2Off size={12} />}
                <span className="ml-1">{t("unlinkDuplicate")}</span>
              </Button>
            </div>
          )}
        </div>
    );

    if (placement === "pageSidebar" || placement === "modalInner") {
      return inner;
    }
    return (
      <div className="mb-5 rounded-xl border border-border bg-muted/30 p-3 sm:p-4">
        <TicketSectionHeading>{t("ticketModerationSection")}</TicketSectionHeading>
        {inner}
      </div>
    );
  }

  const renderDetailFields = (textSize: "sm" | "base", options?: { pageLayout?: boolean }) => {
    const pageLayout = options?.pageLayout ?? false;
    const descClass = pageLayout
      ? "text-sm leading-relaxed text-foreground"
      : textSize === "base"
        ? "text-base leading-relaxed text-foreground"
        : "text-sm";
    const linkClass = pageLayout ? "text-xs" : textSize === "base" ? "text-sm" : "text-xs";
    const thumbClass =
      textSize === "base" && !pageLayout
        ? "max-h-[min(72vh,640px)] w-full max-w-4xl object-contain"
        : "max-h-64 max-w-full object-contain";
    const descriptionShellClass = pageLayout
      ? "rounded-xl border border-border bg-card p-5 shadow-(--shadow-1) sm:p-6"
      : "rounded-lg border border-border bg-muted/20 p-3 sm:p-4";

    return (
      <>
        {dups.length > 0 && (
          <div className="mb-4">
            <div className="flex gap-1 overflow-x-auto border-b border-border">
              <button
                type="button"
                onClick={() => setActiveDupTab(0)}
                className={`shrink-0 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                  activeDupTab === 0 ? "border-primary text-primary" : "border-transparent text-muted-foreground"
                }`}
              >
                {t("dupTabThisReport")}
              </button>
              {dups.map((link, idx) => (
                <button
                  key={link.id}
                  type="button"
                  onClick={() => setActiveDupTab(idx + 1)}
                  className={`shrink-0 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                    activeDupTab === idx + 1 ? "border-primary text-primary" : "border-transparent text-muted-foreground"
                  }`}
                >
                  <span className="font-mono text-[10px] font-semibold">{link.duplicate.ref}</span>
                  <span className="ml-1.5 inline-block max-w-[120px] truncate align-middle">{link.duplicate.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {activeDup ? (
          <div className="mb-5">
            <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Link2 size={12} aria-hidden />
              <span>
                {t("dupSubmittedBy")}{" "}
                <span className="font-medium text-foreground">
                  {activeDup.duplicate.user.name ?? activeDup.duplicate.user.email}
                </span>
                {" · "}
                {new Date(activeDup.duplicate.createdAt).toLocaleString(locale === "es" ? "es" : "en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              {canTriage ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-6 shrink-0 px-2 text-xs text-amber-800 hover:bg-amber-100 dark:text-amber-200"
                  disabled={unlinkingCanonicalId === activeDup.duplicate.id}
                  onClick={() => void unlinkDuplicateFromCanonical(activeDup.duplicate.id)}
                  aria-label={t("unlinkDuplicateAria")}
                >
                  {unlinkingCanonicalId === activeDup.duplicate.id ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <Link2Off size={12} />
                  )}
                  <span className="ml-1">{t("unlinkDuplicate")}</span>
                </Button>
              ) : null}
            </div>
            <div className={`mb-4 ${descriptionShellClass}`}>
              <TicketSectionHeading>{t("descriptionHeading")}</TicketSectionHeading>
              <p className={`mt-2 whitespace-pre-wrap ${descClass}`}>
                {renderRichText(activeDup.duplicate.description ?? "")}
              </p>
            </div>
            {activeDup.duplicate.pageUrl && (
              <div className="mb-4">
                <TicketSectionHeading>{t("page")}</TicketSectionHeading>
                <a
                  href={activeDup.duplicate.pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`break-all font-medium text-primary hover:underline ${linkClass}`}
                >
                  {activeDup.duplicate.pageUrl}
                </a>
              </div>
            )}
            {activeDup.duplicate.screenshot && (
              <div className="mb-4">
                <TicketSectionHeading>{t("screenshotHeading")}</TicketSectionHeading>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={activeDup.duplicate.screenshot} alt="" className={`rounded-lg border border-border ${thumbClass}`} />
              </div>
            )}
          </div>
        ) : (
          <>
            <div className={`mb-5 ${descriptionShellClass}`}>
              <div className="flex items-start justify-between gap-2">
                <TicketSectionHeading>{t("descriptionHeading")}</TicketSectionHeading>
                {!isEditingDescription && ticket.status !== "ARCHIVED" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 px-2 text-xs text-muted-foreground"
                    onClick={startEditingDescription}
                    aria-label={t("descriptionEditAria")}
                  >
                    <Pencil size={12} aria-hidden />
                    <span className="ml-1">{t("editDescription")}</span>
                  </Button>
                ) : null}
              </div>
              {isEditingDescription ? (
                <div className="mt-2">
                  <textarea
                    className={`w-full rounded-md border border-border bg-card p-2 ${descClass} focus:outline-none focus:ring-1 focus:ring-primary`}
                    value={descriptionDraft}
                    onChange={(e) => setDescriptionDraft(e.target.value)}
                    onPaste={handleDescriptionPaste}
                    rows={Math.max(4, Math.min(16, (descriptionDraft.match(/\n/g)?.length ?? 0) + 3))}
                    maxLength={10000}
                    disabled={descriptionSaving}
                    aria-label={t("descriptionEditAria")}
                  />
                  {pendingDescImages.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {pendingDescImages.map((p, i) => (
                        <div
                          key={p.localUrl}
                          className="relative h-[60px] w-[60px] shrink-0 overflow-hidden rounded-lg border border-border"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.localUrl} alt="" className="h-full w-full object-cover" />
                          <button
                            type="button"
                            aria-label={t("removeAttachmentAria")}
                            onClick={() => {
                              URL.revokeObjectURL(p.localUrl);
                              setPendingDescImages((prev) => prev.filter((_, j) => j !== i));
                            }}
                            className="absolute right-0.5 top-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-0 bg-black/60 p-0"
                          >
                            <X size={10} className="text-white" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={cancelEditingDescription}
                      disabled={descriptionSaving}
                    >
                      {tc("cancel")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void saveDescription()}
                      disabled={descriptionSaving || descriptionDraft.trim().length === 0}
                    >
                      {descriptionSaving ? <Loader2 size={12} className="mr-1 animate-spin" /> : null}
                      {tc("save")}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className={`mt-2 whitespace-pre-wrap ${descClass}`}>{renderRichText(ticket.description ?? "")}</p>
              )}
            </div>

            {ticket.pageUrl && (
              <div className="mb-5">
                <TicketSectionHeading>{t("page")}</TicketSectionHeading>
                <a
                  href={ticket.pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`break-all font-medium text-primary hover:underline ${linkClass}`}
                >
                  {ticket.pageUrl}
                </a>
              </div>
            )}

            {ticket.screenshot && (
              <div className="mb-5">
                <TicketSectionHeading>{t("screenshotHeading")}</TicketSectionHeading>
                <button
                  type="button"
                  aria-label={t("screenshotEnlargeAria")}
                  onClick={() => setLightboxOpen(true)}
                  className="group relative block max-w-full overflow-hidden rounded-lg border border-border bg-muted"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ticket.screenshot} alt="" className={thumbClass} />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity group-hover:opacity-100">
                    <ZoomIn size={28} className="text-white drop-shadow-md" />
                  </div>
                </button>
                {lightboxOpen && ticket.screenshot && (
                  <ScreenshotLightbox src={ticket.screenshot} onClose={() => setLightboxOpen(false)} />
                )}
              </div>
            )}

            {ticket.videoUrl && (
              <div className="mb-5">
                <TicketSectionHeading>{t("recordingSection")}</TicketSectionHeading>
                <button
                  type="button"
                  onClick={() => setVideoPlayerUrl(ticket.videoUrl!)}
                  className={`inline-flex items-center gap-1.5 font-medium text-primary hover:underline ${linkClass}`}
                >
                  <Video size={13} aria-hidden />
                  {t("watchRecording")}
                </button>
              </div>
            )}

            {canTriage && ticket.adminNote && (
              <div
                className={
                  pageLayout
                    ? "mb-5 rounded-xl border border-border bg-card p-5 shadow-(--shadow-1) sm:p-6"
                    : "mb-5 rounded-lg border border-border bg-muted/50 p-4"
                }
              >
                <TicketSectionHeading>{t("legacyNote")}</TicketSectionHeading>
                <p className={`whitespace-pre-wrap ${descClass}`}>{ticket.adminNote}</p>
              </div>
            )}
          </>
        )}
      </>
    );
  };

  if (variant === "page") {
    return (
      <>
      <article
        ref={pageRootRef}
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl py-(--page-padding-y)"
        style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
        aria-labelledby="ticket-page-title"
      >
        <div className="mt-2 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start lg:gap-10">
          <div className="min-w-0 space-y-8">
            <header className="flex flex-col gap-4 border-b border-border pb-6">
              <div className="flex flex-col gap-2">
                <div
                  className={cn(
                    "flex justify-between gap-3",
                    isEditingTitle ? "items-start" : "min-h-8 items-center"
                  )}
                >
                  {isEditingTitle ? (
                    <div className="min-w-0 flex-1 space-y-1">
                      <label htmlFor="ticket-page-title" className="sr-only">
                        {t("titleEditAria")}
                      </label>
                      <input
                        id="ticket-page-title"
                        type="text"
                        maxLength={120}
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        disabled={titleSaving}
                        className="w-full rounded-md border border-border bg-card px-3 py-2 text-balance font-semibold text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        style={{ fontSize: "var(--text-heading, 1.25rem)" }}
                        aria-label={t("titleEditAria")}
                      />
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {titleDraft.length}/120
                      </p>
                    </div>
                  ) : (
                    <>
                      <h1
                        id="ticket-page-title"
                        className="m-0 min-w-0 flex-1 text-balance font-semibold leading-snug text-foreground"
                        style={{ fontSize: "var(--text-heading, 1.25rem)" }}
                      >
                        {ticket.title}
                      </h1>
                      {ticket.status !== "ARCHIVED" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground"
                          onClick={startEditingTitle}
                          aria-label={t("titleEditAria")}
                        >
                          <Pencil size={14} aria-hidden />
                          <span>{t("editTitle")}</span>
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
                {isEditingTitle ? (
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={cancelEditingTitle}
                      disabled={titleSaving}
                    >
                      {tc("cancel")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void saveTitle()}
                      disabled={titleSaving || titleDraft.trim().length === 0}
                    >
                      {titleSaving ? <Loader2 size={12} className="mr-1 animate-spin" aria-hidden /> : null}
                      {tc("save")}
                    </Button>
                  </div>
                ) : null}
              </div>
              {renderContextStrip(false)}
            </header>

            <section className="space-y-4" aria-label={t("ticketDetailSummary")}>
              {renderDetailFields("sm", { pageLayout: true })}
            </section>

            <section
              className="rounded-xl border border-border bg-card p-5 shadow-(--shadow-1) sm:p-6"
              aria-label={t("attachmentsSection")}
            >
              <TicketAttachmentsSection
                key={`att-${attachmentsRefreshKey}`}
                ticketId={ticket.id}
                currentUserId={currentUserId}
              />
            </section>

            <section
              className="rounded-xl border border-border bg-card p-5 shadow-(--shadow-1) sm:p-6"
              aria-label={t("github.linkedPullRequests")}
            >
              <LinkedPRsSection
                ticketId={ticket.id}
                linkedPRs={ticket.linkedPRs}
                isAdmin={isAdmin}
                onChanged={load}
              />
            </section>

            <section
              className="rounded-xl border border-border bg-card p-5 shadow-(--shadow-1) sm:p-6"
              aria-label={t("commentsSection")}
            >
              <TicketCommentThread ticketId={ticket.id} currentUserId={currentUserId} pollingEnabled />
            </section>
          </div>

          <aside
            className="min-w-0 space-y-4 lg:sticky lg:top-[calc(var(--top-bar-height)+1rem)] lg:self-start"
            aria-label={t("ticketConfigurationSection")}
          >
            <section className="rounded-xl border border-border bg-card/80 p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-foreground">{t("ticketConfigurationSection")}</h2>
              <div className="mt-3">{renderTicketPropertiesCard("pageSidebar")}</div>
            </section>
            {renderHierarchyCard("pageSidebar")}
            {renderPossibleDuplicatesCard("pageSidebar")}
            {canTriage ? (
              <section className="rounded-xl border border-border bg-card/80 p-4 shadow-sm">
                <h2 className="text-sm font-semibold text-foreground">{t("ticketModerationSection")}</h2>
                <div className="mt-3">{renderTriageModerationSection("pageSidebar")}</div>
              </section>
            ) : null}
          </aside>
        </div>

        {videoPlayerUrl ? <VideoPlayer url={videoPlayerUrl} onClose={() => setVideoPlayerUrl(null)} /> : null}
      </article>
      {renderRelatedTicketModal()}
      </>
    );
  }

  const hierarchyModalBare = renderHierarchyCard("modal", { bareModalBody: true });
  const possibleDupModalBare = renderPossibleDuplicatesCard("modal", { bareModalBody: true });

  const card = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ticket-modal-title"
      tabIndex={-1}
      className="relative flex max-h-dvh w-full max-w-2xl flex-col rounded-t-2xl bg-card shadow-xl sm:max-h-[min(90dvh,800px)] sm:rounded-2xl"
      style={{
        paddingTop: "max(12px, env(safe-area-inset-top))",
        paddingBottom: "max(12px, env(safe-area-inset-bottom))",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-3 sm:px-4">
        <div
          className={cn(
            "flex justify-between gap-2",
            isEditingTitle ? "items-start" : "min-h-11 items-center"
          )}
        >
          <div className={cn("min-w-0 flex-1", !isEditingTitle && "flex min-h-11 items-center")}>
            {isEditingTitle ? (
              <div className="space-y-1.5">
                <p className="font-mono text-[11px] font-medium text-muted-foreground">{ticket.ref}</p>
                <label htmlFor="ticket-modal-title" className="sr-only">
                  {t("titleEditAria")}
                </label>
                <input
                  id="ticket-modal-title"
                  type="text"
                  maxLength={120}
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  disabled={titleSaving}
                  className="w-full rounded-md border border-border bg-muted/30 px-2 py-1.5 text-sm font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  aria-label={t("titleEditAria")}
                />
                <p className="text-[10px] tabular-nums text-muted-foreground">{titleDraft.length}/120</p>
              </div>
            ) : (
              <h2
                id="ticket-modal-title"
                className="m-0 min-w-0 truncate text-sm font-semibold leading-snug text-foreground"
              >
                <span className="font-mono">{ticket.ref}</span>
                <span className="text-muted-foreground"> — </span>
                {ticket.title}
              </h2>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            {!isEditingTitle && ticket.status !== "ARCHIVED" ? (
              <button
                type="button"
                onClick={startEditingTitle}
                aria-label={t("titleEditAria")}
                title={t("editTitle")}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
              >
                <Pencil size={18} aria-hidden />
              </button>
            ) : null}
            {isEditingTitle ? (
              <>
                <button
                  type="button"
                  onClick={cancelEditingTitle}
                  disabled={titleSaving}
                  className="rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                >
                  {tc("cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void saveTitle()}
                  disabled={titleSaving || titleDraft.trim().length === 0}
                  className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {titleSaving ? <Loader2 size={14} className="animate-spin" aria-hidden /> : tc("save")}
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => void copyPromptForAgent()}
              disabled={copyingAgentPrompt}
              aria-label={t("copyAgentPromptAria")}
              title={t("copyAgentPromptTitle")}
              className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-1.5 text-left text-xs font-semibold text-foreground hover:bg-muted/80 disabled:opacity-50 sm:shrink-0"
            >
              {copyingAgentPrompt ? <Loader2 size={16} className="shrink-0 animate-spin" aria-hidden /> : <Copy size={16} className="shrink-0" aria-hidden />}
              <span className="min-w-0 leading-tight sm:inline">{t("copyAgentPrompt")}</span>
            </button>
            <button
              type="button"
              onClick={openInNewTab}
              aria-label={t("openInNewTabAria")}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <ExternalLink size={18} />
            </button>
            <button
              type="button"
              onClick={handleClose}
              aria-label={t("modalCloseAria")}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
        <div className="mb-4 flex flex-col gap-3">{renderContextStrip(true)}</div>

        <div className="mb-4 overflow-hidden rounded-xl border border-border bg-card/80 shadow-sm">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left sm:px-4"
            aria-expanded={modalConfigOpen}
            aria-controls="ticket-modal-configuration-panel"
            onClick={() => setModalConfigOpen((o) => !o)}
          >
            <ChevronRight
              className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", modalConfigOpen && "rotate-90")}
              aria-hidden
            />
            <span className="text-sm font-semibold text-foreground">{t("ticketConfigurationSection")}</span>
          </button>
          {modalConfigOpen ? (
            <div id="ticket-modal-configuration-panel" className="border-t border-border p-3 sm:p-4">
              {renderTicketPropertiesCard("modal", { bareModalBody: true })}
            </div>
          ) : null}
        </div>

        {canTriage ? (
          <div className="mb-4 overflow-hidden rounded-xl border border-border bg-card/80 shadow-sm">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left sm:px-4"
              aria-expanded={modalModerationOpen}
              aria-controls="ticket-modal-moderation-panel"
              onClick={() => setModalModerationOpen((o) => !o)}
            >
              <ChevronRight
                className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", modalModerationOpen && "rotate-90")}
                aria-hidden
              />
              <span className="text-sm font-semibold text-foreground">{t("ticketModerationSection")}</span>
            </button>
            {modalModerationOpen ? (
              <div id="ticket-modal-moderation-panel" className="border-t border-border bg-muted/30 p-3 sm:p-4">
                {renderTriageModerationSection("modalInner")}
              </div>
            ) : null}
          </div>
        ) : null}

        {hierarchyModalBare ? (
          <div className="mb-4 overflow-hidden rounded-xl border border-border bg-card/80 shadow-sm">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left sm:px-4"
              aria-expanded={modalHierarchyOpen}
              aria-controls="ticket-modal-related-tickets-panel"
              onClick={() => setModalHierarchyOpen((o) => !o)}
            >
              <ChevronRight
                className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", modalHierarchyOpen && "rotate-90")}
                aria-hidden
              />
              <span className="text-sm font-semibold text-foreground">{t("ticketHierarchySection")}</span>
            </button>
            {modalHierarchyOpen ? (
              <div
                id="ticket-modal-related-tickets-panel"
                role="region"
                aria-label={t("ticketHierarchySection")}
                className="border-t border-border p-3 sm:p-4"
              >
                {hierarchyModalBare}
              </div>
            ) : null}
          </div>
        ) : null}

        {possibleDupModalBare ? (
          <div className="mb-4 overflow-hidden rounded-xl border border-border bg-card/80 shadow-sm">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left sm:px-4"
              aria-expanded={modalPossibleDupOpen}
              aria-controls="ticket-modal-possible-duplicates-panel"
              onClick={() => setModalPossibleDupOpen((o) => !o)}
            >
              <ChevronRight
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                  modalPossibleDupOpen && "rotate-90"
                )}
                aria-hidden
              />
              <span className="text-sm font-semibold text-foreground">{t("possibleDuplicatesSection")}</span>
              {similarLoading ? (
                <Loader2 size={12} className="animate-spin text-muted-foreground" aria-hidden />
              ) : null}
            </button>
            {modalPossibleDupOpen ? (
              <div
                id="ticket-modal-possible-duplicates-panel"
                role="region"
                aria-label={t("possibleDuplicatesSection")}
                className="border-t border-border p-3 sm:p-4"
              >
                {possibleDupModalBare}
              </div>
            ) : null}
          </div>
        ) : null}

        {renderDetailFields("sm")}

        <div className="mt-4 border-t border-border pt-4">
          <TicketAttachmentsSection
            key={`att-${attachmentsRefreshKey}`}
            ticketId={ticket.id}
            currentUserId={currentUserId}
          />
        </div>

        <div className="mt-4 border-t border-border pt-4" aria-label={t("github.linkedPullRequests")}>
          <LinkedPRsSection
            ticketId={ticket.id}
            linkedPRs={ticket.linkedPRs}
            isAdmin={isAdmin}
            onChanged={load}
          />
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <TicketCommentThread ticketId={ticket.id} currentUserId={currentUserId} pollingEnabled />
        </div>
      </div>

      <div
        className="flex shrink-0 justify-end border-t border-border bg-card px-3 py-2 sm:px-4"
        style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
      >
        <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={handleClose}>
          {tc("close")}
        </Button>
      </div>

      {videoPlayerUrl ? <VideoPlayer url={videoPlayerUrl} onClose={() => setVideoPlayerUrl(null)} /> : null}
    </div>
  );

  const modalLayerZ = 310 + modalStackDepth * 10;

  return (
    <>
      <div
        className="fixed inset-0 flex items-end justify-center sm:items-center sm:p-4"
        role="presentation"
        style={{ zIndex: modalLayerZ }}
        onClick={handleClose}
      >
        <div className="absolute inset-0 bg-black/50" aria-hidden />
        {card}
      </div>
      {renderRelatedTicketModal()}
    </>
  );
}
