import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/** In-app path to the full ticket detail page (locale prefix added by router / getPathname). */
export function ticketDetailPageHref(
  ticketId: string,
  projectId?: string | null
): `/projects/${string}/tickets/${string}/details` | `/tickets/${string}/details` {
  if (projectId) {
    return `/projects/${projectId}/tickets/${ticketId}/details`;
  }
  return `/tickets/${ticketId}/details`;
}

export function buildTicketDetailAbsoluteUrl(
  origin: string,
  locale: string,
  ticketId: string,
  projectId?: string | null
): string {
  const base = origin.replace(/\/$/, "");
  const path = getPathname({ locale, href: ticketDetailPageHref(ticketId, projectId) });
  return `${base}${path}`;
}

/** Absolute URL for emails and server routes (default locale). */
export function buildTicketDetailAppUrl(ticketId: string, projectId?: string | null): string {
  const APP_URL = (
    process.env.AUTH_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3003"
  ).replace(/\/$/, "");
  const path = getPathname({
    locale: routing.defaultLocale,
    href: ticketDetailPageHref(ticketId, projectId),
  });
  return `${APP_URL}${path}`;
}
