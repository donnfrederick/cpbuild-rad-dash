"use client";

import { useEffect, useState } from "react";
import { usePathname } from "@/i18n/navigation";
import { sprintIdFromPathname } from "@/lib/sprint-path";
import type { SprintApiPayload } from "@/lib/sprint-map";

export interface SprintRouteCreateTicketContext {
  /** True once any async fetch has resolved (or immediately when not on a sprint route). */
  ready: boolean;
  /**
   * Set only when on a sprint route AND the sprint uses an explicit ticket list AND the user
   * can triage. Passing this to CreateTicketDialog will insert a sprint_tickets row on create.
   */
  linkSprintId: string | undefined;
  /**
   * The project IDs linked to this sprint. Narrows the project picker on implicit sprints so
   * newly created tickets are visible via the project-scoped board fallback.
   */
  allowedProjectIds: string[] | undefined;
}

/**
 * Derives the sprint-link context for CreateTicketDialog when the user is currently
 * navigated inside a sprint route (/sprints/:id/…).
 *
 * Mirror of the logic in TicketsWorkspace.tsx:
 *   linkSprintId = canTriage && usesExplicitTicketList && !completedAt ? sprintId : undefined
 *   allowedProjectIds = sprint.projects.map(p => p.id)
 */
export function useSprintRouteCreateTicketContext(
  canTriage: boolean
): SprintRouteCreateTicketContext {
  const pathname = usePathname();
  const sprintId = sprintIdFromPathname(pathname);

  const [ready, setReady] = useState(!sprintId);
  const [linkSprintId, setLinkSprintId] = useState<string | undefined>(undefined);
  const [allowedProjectIds, setAllowedProjectIds] = useState<string[] | undefined>(undefined);

  useEffect(() => {
    if (!sprintId) {
      setReady(true);
      setLinkSprintId(undefined);
      setAllowedProjectIds(undefined);
      return;
    }

    setReady(false);
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(`/api/sprints/${encodeURIComponent(sprintId)}`);
        if (!res.ok) {
          if (!cancelled) {
            setAllowedProjectIds(undefined);
            setLinkSprintId(undefined);
          }
        } else {
          const data = (await res.json()) as SprintApiPayload;
          if (!cancelled) {
            const ids = (data.projects ?? []).map((p) => p.id);
            setAllowedProjectIds(ids.length > 0 ? ids : undefined);
            setLinkSprintId(
              canTriage && data.usesExplicitTicketList && !data.completedAt ? sprintId : undefined
            );
          }
        }
      } catch {
        if (!cancelled) {
          setAllowedProjectIds(undefined);
          setLinkSprintId(undefined);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sprintId, canTriage]);

  return { ready, linkSprintId, allowedProjectIds };
}
