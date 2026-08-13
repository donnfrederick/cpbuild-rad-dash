import type { SprintApiPayload } from "@/lib/sprint-map";

/** One-line summary of planning fields for list and board headers. */
export function formatSprintPlanningMetaLine(
  s: SprintApiPayload,
  t: (key: string, values?: Record<string, number | string>) => string
): string | null {
  const parts: string[] = [];
  if (s.startDate || s.endDate) {
    const a = s.startDate ? s.startDate.slice(0, 10) : "—";
    const b = s.endDate ? s.endDate.slice(0, 10) : "—";
    parts.push(`${a} → ${b}`);
  }
  if (s.maxManSprints != null) parts.push(t("metaMaxManSprints", { n: s.maxManSprints }));
  if (s.daysOff > 0) parts.push(t("metaDaysOff", { n: s.daysOff }));
  if (s.carryOverPoints != null) parts.push(t("metaCarryOver", { n: s.carryOverPoints }));
  if (s.pointsPlanned != null) parts.push(t("metaPointsPlanned", { n: s.pointsPlanned }));
  return parts.length > 0 ? parts.join(" · ") : null;
}
