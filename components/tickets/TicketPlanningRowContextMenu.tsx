"use client";

import type { ReactElement, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { TicketStatus } from "@/components/tickets/ticket-types";
import { TICKET_STATUS_ORDER } from "@/lib/ticket-status";
import { cn } from "@/lib/utils";

const VIEWPORT_PAD = 8;

function clampMenuPosition(
  clientX: number,
  clientY: number,
  width: number,
  height: number
): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const p = VIEWPORT_PAD;
  let left = clientX;
  let top = clientY;
  if (width > 0) {
    left = Math.min(left, vw - p - width);
    left = Math.max(p, left);
  }
  if (height > 0) {
    top = Math.min(top, vh - p - height);
    top = Math.max(p, top);
  }
  return { left, top };
}

function SubmenuFlyout({
  visible,
  repositionKey,
  children,
  onMouseEnter,
  onMouseLeave,
}: {
  visible: boolean;
  /** Bumps layout measure when list lengths change while a submenu is open. */
  repositionKey: string;
  children: ReactNode;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}): ReactElement {
  const panelRef = useRef<HTMLDivElement>(null);
  const [nudge, setNudge] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!visible) {
      setNudge({ x: 0, y: 0 });
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.transform = "";
    const margin = VIEWPORT_PAD;
    const rect = panel.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (rect.right > window.innerWidth - margin) {
      dx = window.innerWidth - margin - rect.right;
    }
    if (rect.left + dx < margin) {
      dx = margin - rect.left;
    }
    if (rect.bottom > window.innerHeight - margin) {
      dy = window.innerHeight - margin - rect.bottom;
    }
    if (rect.top + dy < margin) {
      dy = margin - rect.top;
    }
    setNudge({ x: dx, y: dy });
  }, [visible, repositionKey]);

  return (
    <div
      role="presentation"
      className={cn(
        "absolute left-full top-0 z-[60] min-w-[11rem] pl-1",
        visible ? "block" : "hidden"
      )}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div
        ref={panelRef}
        className="max-h-[min(16rem,calc(100dvh-2rem))] overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-xl"
        role="menu"
        style={
          nudge.x !== 0 || nudge.y !== 0
            ? { transform: `translate(${nudge.x}px, ${nudge.y}px)` }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}

export type PlanningRowContextZone = "sprint" | "backlog";

type SubmenuKey = "status" | "priority" | "assign" | "project";

export interface TicketPlanningRowContextMenuProps {
  x: number;
  y: number;
  rowZone: PlanningRowContextZone;
  canTriage: boolean;
  /** When false, sprint move/remove actions are hidden (e.g. implicit sprint list). */
  showSprintMembershipActions: boolean;
  assigneesLoading: boolean;
  assignees: ReadonlyArray<{ id: string; name: string | null; email: string }>;
  projects: ReadonlyArray<{ id: string; name: string }>;
  statusLabel: (status: TicketStatus) => string;
  onClose: () => void;
  onMoveToSprint: () => void;
  onRemoveFromSprint: () => void;
  onSetStatus: (status: TicketStatus) => void;
  onSetPriority: (priority: "LOW" | "MEDIUM" | "HIGH" | null) => void;
  onSetAssignee: (assigneeId: string | null) => void;
  onSetProject: (projectId: string | null) => void;
}

const SUBMENU_CLOSE_MS = 350;

export function TicketPlanningRowContextMenu({
  x,
  y,
  rowZone,
  canTriage,
  showSprintMembershipActions,
  assigneesLoading,
  assignees,
  projects,
  statusLabel,
  onClose,
  onMoveToSprint,
  onRemoveFromSprint,
  onSetStatus,
  onSetPriority,
  onSetAssignee,
  onSetProject,
}: TicketPlanningRowContextMenuProps): ReactElement {
  const t = useTranslations("tickets");
  const [submenu, setSubmenu] = useState<SubmenuKey | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openSubmenu = useCallback(
    (key: SubmenuKey) => {
      clearCloseTimer();
      setSubmenu(key);
    },
    [clearCloseTimer]
  );

  const scheduleCloseSubmenu = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => setSubmenu(null), SUBMENU_CLOSE_MS);
  }, [clearCloseTimer]);

  useEffect(() => {
    return () => clearCloseTimer();
  }, [clearCloseTimer]);

  const showMoveToSprint = canTriage && showSprintMembershipActions && rowZone === "backlog";
  const showRemoveFromSprint = canTriage && showSprintMembershipActions && rowZone === "sprint";
  const showStatus = canTriage;
  const showPriority = canTriage;
  const showAssign = true;
  const showProject = canTriage;

  const rootRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  const clampRootToViewport = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w === 0 && h === 0) return;
    setMenuPos(clampMenuPosition(x, y, w, h));
  }, [x, y]);

  useLayoutEffect(() => {
    clampRootToViewport();
  }, [
    clampRootToViewport,
    submenu,
    rowZone,
    canTriage,
    showSprintMembershipActions,
    assigneesLoading,
    assignees.length,
    projects.length,
  ]);

  useEffect(() => {
    const onResizeOrScroll = (): void => {
      clampRootToViewport();
    };
    window.addEventListener("resize", onResizeOrScroll);
    window.addEventListener("scroll", onResizeOrScroll, true);
    return () => {
      window.removeEventListener("resize", onResizeOrScroll);
      window.removeEventListener("scroll", onResizeOrScroll, true);
    };
  }, [clampRootToViewport]);

  const submenuLayoutKey = `${assignees.length}-${projects.length}-${assigneesLoading}`;

  const submenuPanel = (key: SubmenuKey, children: ReactNode): ReactElement => (
    <SubmenuFlyout
      visible={submenu === key}
      repositionKey={submenuLayoutKey}
      onMouseEnter={() => openSubmenu(key)}
      onMouseLeave={scheduleCloseSubmenu}
    >
      {children}
    </SubmenuFlyout>
  );

  return (
    <div
      ref={rootRef}
      className="fixed z-50 min-w-[12rem] rounded-md border border-border bg-popover p-1 shadow-xl"
      style={{ left: menuPos.left, top: menuPos.top }}
      role="menu"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="relative py-0.5">
        {showMoveToSprint ? (
          <button
            type="button"
            role="menuitem"
            className="w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={() => {
              onMoveToSprint();
              onClose();
            }}
          >
            {t("planningCtxMoveToSprint")}
          </button>
        ) : null}
        {showRemoveFromSprint ? (
          <button
            type="button"
            role="menuitem"
            className="w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={() => {
              onRemoveFromSprint();
              onClose();
            }}
          >
            {t("planningBulkRemoveFromSprint")}
          </button>
        ) : null}

        {showStatus ? (
          <div
            className="relative"
            onMouseEnter={() => openSubmenu("status")}
            onMouseLeave={scheduleCloseSubmenu}
          >
            <div
              role="menuitem"
              className="flex w-full cursor-default items-center justify-between rounded-sm px-3 py-2 text-sm hover:bg-muted"
            >
              <span>{t("rowCtxSetStatus")}</span>
              <ChevronRight className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
            </div>
            {submenuPanel(
              "status",
              TICKET_STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="menuitem"
                  className="block w-full rounded-sm px-3 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    onSetStatus(s);
                    onClose();
                  }}
                >
                  {statusLabel(s)}
                </button>
              ))
            )}
          </div>
        ) : null}

        {showPriority ? (
          <div
            className="relative"
            onMouseEnter={() => openSubmenu("priority")}
            onMouseLeave={scheduleCloseSubmenu}
          >
            <div
              role="menuitem"
              className="flex w-full cursor-default items-center justify-between rounded-sm px-3 py-2 text-sm hover:bg-muted"
            >
              <span>{t("rowCtxSetPriority")}</span>
              <ChevronRight className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
            </div>
            {submenuPanel(
              "priority",
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full rounded-sm px-3 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    onSetPriority(null);
                    onClose();
                  }}
                >
                  {t("priorityNone")}
                </button>
                {(["LOW", "MEDIUM", "HIGH"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="menuitem"
                    className="block w-full rounded-sm px-3 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      onSetPriority(p);
                      onClose();
                    }}
                  >
                    {p === "LOW" ? t("priorityLow") : p === "MEDIUM" ? t("priorityMedium") : t("priorityHigh")}
                  </button>
                ))}
              </>
            )}
          </div>
        ) : null}

        {showAssign ? (
          <div
            className="relative"
            onMouseEnter={() => openSubmenu("assign")}
            onMouseLeave={scheduleCloseSubmenu}
          >
            <div
              role="menuitem"
              className="flex w-full cursor-default items-center justify-between rounded-sm px-3 py-2 text-sm hover:bg-muted"
            >
              <span>{t("rowCtxAssign")}</span>
              <ChevronRight className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
            </div>
            {submenuPanel(
              "assign",
              assigneesLoading ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">{t("rowCtxLoadingUsers")}</div>
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full rounded-sm px-3 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      onSetAssignee(null);
                      onClose();
                    }}
                  >
                    {t("assigneeUnassigned")}
                  </button>
                  {assignees.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      role="menuitem"
                      className="block w-full rounded-sm px-3 py-1.5 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        onSetAssignee(u.id);
                        onClose();
                      }}
                    >
                      {u.name ?? u.email}
                    </button>
                  ))}
                </>
              )
            )}
          </div>
        ) : null}

        {showProject ? (
          <div
            className="relative"
            onMouseEnter={() => openSubmenu("project")}
            onMouseLeave={scheduleCloseSubmenu}
          >
            <div
              role="menuitem"
              className="flex w-full cursor-default items-center justify-between rounded-sm px-3 py-2 text-sm hover:bg-muted"
            >
              <span>{t("rowCtxProject")}</span>
              <ChevronRight className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
            </div>
            {submenuPanel(
              "project",
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full rounded-sm px-3 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    onSetProject(null);
                    onClose();
                  }}
                >
                  {t("projectNone")}
                </button>
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitem"
                    className="block w-full rounded-sm px-3 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      onSetProject(p.id);
                      onClose();
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
