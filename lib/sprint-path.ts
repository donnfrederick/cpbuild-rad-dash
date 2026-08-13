/**
 * Extracts the sprint ID from a pathname like `/sprints/:id/…` or `/en/sprints/:id/…`.
 * Returns null when the pathname is not inside a sprint route.
 */
export function sprintIdFromPathname(pathname: string): string | null {
  const m = pathname.match(/\/sprints\/([^/]+)/);
  return m?.[1] ?? null;
}
