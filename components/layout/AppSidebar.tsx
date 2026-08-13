"use client";

import Image from "next/image";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  FolderKanban,
  LayoutGrid,
  LayoutList,
  Layers,
  LogOut,
  Settings,
  Shield,
  SlidersHorizontal,
  User as UserIcon,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DashboardShellUser } from "@/components/layout/DashboardShell";
import { cn } from "@/lib/utils";
import { hasPermission, PERMISSIONS } from "@/lib/permissions-core";
import { useCurrentTeam } from "@/contexts/CurrentTeamContext";

interface AppSidebarProps {
  user: DashboardShellUser;
}

function projectIdFromPathname(pathname: string): string | null {
  const m = pathname.match(/^\/projects\/([^/]+)/);
  return m?.[1] ?? null;
}

function sprintIdFromPathname(pathname: string): string | null {
  const m = pathname.match(/^\/sprints\/([^/]+)/);
  return m?.[1] ?? null;
}

/** Abbreviation shown inside team icon buttons when there's no image. */
function teamInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function AppSidebar({ user }: AppSidebarProps) {
  const t = useTranslations("common");
  const tNav = useTranslations("nav");
  const tProjects = useTranslations("projects");
  const tSprints = useTranslations("sprints");
  const tRoles = useTranslations("roles");
  const pathname = usePathname();
  const locale = useLocale();
  const router = useRouter();
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;

  const isSuperAdmin = user.specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS);
  const showTeamStrip = isSuperAdmin || user.teamMemberships.length >= 2;

  // Team list and refresh come from context — no local fetch needed.
  const { currentTeam, setCurrentTeam, allTeams: stripTeams } = useCurrentTeam();

  /**
   * Switch teams. If we're inside a sprint or project detail page, redirect
   * to the corresponding list page so the new team's content loads correctly
   * (the current detail belongs to the old team and won't change otherwise).
   */
  function handleTeamSwitch(slug: string) {
    const inSprintDetail = /^\/sprints\/[^/]+/.test(pathname);
    const inProjectDetail = /^\/projects\/[^/]+/.test(pathname);

    if (inSprintDetail) {
      router.push(`/${locale}/sprints?team=${encodeURIComponent(slug)}`);
      return;
    }
    if (inProjectDetail) {
      router.push(`/${locale}/projects?team=${encodeURIComponent(slug)}`);
      return;
    }
    setCurrentTeam(slug);
  }

  const displayName = user.name?.trim() || user.email || "—";
  const roleCode =
    user.role === "ADMIN" || user.role === "MEMBER" ? user.role : "unknown";

  const projectId = projectIdFromPathname(pathname);
  const inProject = projectId != null;
  const sprintId = sprintIdFromPathname(pathname);
  const inSprint = !inProject && sprintId != null;

  const projectsActive =
    pathname === "/projects" || pathname.startsWith("/projects/");
  const usersActive = pathname === "/users";
  const sprintsActive = pathname === "/sprints" || pathname.startsWith("/sprints/");
  const ticketsActive = pathname === "/tickets" || pathname.startsWith("/tickets/");
  const adminActive = pathname.startsWith("/admin/");

  const projectNavItems = inProject
    ? ([
        {
          href: `/projects/${projectId}/overview`,
          label: tProjects("navOverview"),
          icon: Layers,
        },
        {
          href: `/projects/${projectId}/tickets`,
          label: tProjects("navTickets"),
          icon: LayoutList,
        },
        {
          href: `/projects/${projectId}/duplicates`,
          label: tProjects("navDuplicates"),
          icon: Copy,
        },
        {
          href: `/projects/${projectId}/sprint`,
          label: tProjects("navSprint"),
          icon: LayoutGrid,
        },
        {
          href: `/projects/${projectId}/settings`,
          label: tProjects("navSettings"),
          icon: Settings,
        },
      ] as const)
    : null;

  const sprintNavItems = inSprint
    ? ([
        {
          href: `/sprints/${sprintId}/overview`,
          label: tSprints("navOverview"),
          icon: Layers,
        },
        {
          href: `/sprints/${sprintId}/tickets`,
          label: tSprints("navTickets"),
          icon: LayoutList,
        },
      ] as const)
    : null;

  return (
    <div className="flex h-dvh shrink-0">
      {/* Team switcher strip — only rendered for super admins and multi-team members */}
      {showTeamStrip && (
        <aside
          className="flex w-14 shrink-0 flex-col items-center border-r border-border bg-sidebar"
          aria-label="Team switcher"
        >
          {/* Header label */}
          <div className="flex w-full items-center justify-center border-b border-border py-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 select-none">
              Teams
            </span>
          </div>

          <div className="flex flex-col items-center gap-1 py-3 w-full">
            {stripTeams.map((team) => {
              const isActive = currentTeam?.teamSlug === team.slug;
              return (
                <Tooltip key={team.id}>
                  <TooltipTrigger asChild>
                    {/* Wrapper adds the left accent bar for the active team */}
                    <div className="relative flex w-full items-center justify-center py-0.5">
                      {isActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-7 w-1 rounded-r-full bg-primary" />
                      )}
                      <button
                        type="button"
                        onClick={() => handleTeamSwitch(team.slug)}
                        className={cn(
                          "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg text-xs font-bold transition-all",
                          isActive
                            ? "shadow-md scale-105"
                            : "opacity-50 hover:opacity-100 hover:scale-105 hover:shadow-sm"
                        )}
                      >
                        {team.logoUrl ? (
                          <Image
                            src={team.logoUrl}
                            alt={team.name}
                            width={40}
                            height={40}
                            className="size-10 rounded-lg object-cover"
                            unoptimized
                          />
                        ) : (
                          <span
                            className={cn(
                              "flex size-10 items-center justify-center rounded-lg border",
                              isActive
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-sidebar-accent/50 text-sidebar-foreground/70 border-border hover:bg-sidebar-accent"
                            )}
                          >
                            {teamInitials(team.name)}
                          </span>
                        )}
                      </button>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="flex flex-col gap-0.5">
                    <span className="font-semibold">{team.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {isActive ? "Active team" : "Switch to this team"}
                    </span>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </aside>
      )}

      {/* Main sidebar */}
      <aside
        className="flex w-(--nav-width) shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground"
        aria-label={t("appName")}
      >
        <div
          className="flex shrink-0 items-center gap-2 border-b border-border px-4"
          style={{ minHeight: "var(--top-bar-height)" }}
        >
          <Image
            src="/rad-dash-logo.png"
            alt={t("appName")}
            width={1175}
            height={211}
            priority
            className="h-8 w-auto"
          />
          {appVersion ? (
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              v{appVersion}
            </span>
          ) : null}
        </div>

        {currentTeam && (
          <div className="border-b border-border px-4 py-1.5">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {currentTeam.teamName}
            </span>
          </div>
        )}

        <nav
          className="flex flex-col gap-1 p-3"
          aria-label={inProject ? tProjects("subNavAria") : inSprint ? tSprints("subNavAria") : "Main"}
        >
          {inProject && projectNavItems ? (
            <>
              <Link
                href="/projects"
                className={cn(
                  "flex items-center gap-(--inline-gap) rounded-sm px-3 py-3 text-sm font-medium transition-colors",
                  pathname === "/projects"
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                )}
              >
                <ArrowLeft
                  className="shrink-0"
                  style={{ width: "var(--icon-size)", height: "var(--icon-size)" }}
                  aria-hidden
                />
                {tNav("returnToProjects")}
              </Link>
              {projectNavItems.map(({ href, label, icon: Icon }) => {
                const active =
                  pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "flex items-center gap-(--inline-gap) rounded-sm px-3 py-3 text-sm font-medium transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                    )}
                  >
                    <Icon
                      className="shrink-0"
                      style={{
                        width: "var(--icon-size)",
                        height: "var(--icon-size)",
                      }}
                      aria-hidden
                    />
                    {label}
                  </Link>
                );
              })}
            </>
          ) : inSprint && sprintNavItems ? (
            <>
              <Link
                href="/sprints"
                className={cn(
                  "flex items-center gap-(--inline-gap) rounded-sm px-3 py-3 text-sm font-medium transition-colors",
                  pathname === "/sprints"
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                )}
              >
                <ArrowLeft
                  className="shrink-0"
                  style={{ width: "var(--icon-size)", height: "var(--icon-size)" }}
                  aria-hidden
                />
                {tNav("returnToSprints")}
              </Link>
              {sprintNavItems.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "flex items-center gap-(--inline-gap) rounded-sm px-3 py-3 text-sm font-medium transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                    )}
                  >
                    <Icon
                      className="shrink-0"
                      style={{
                        width: "var(--icon-size)",
                        height: "var(--icon-size)",
                      }}
                      aria-hidden
                    />
                    {label}
                  </Link>
                );
              })}
            </>
          ) : (
            <>
              {isSuperAdmin && (
                <Link
                  href="/users"
                  className={cn(
                    "flex items-center gap-(--inline-gap) rounded-sm px-3 py-3 text-sm font-medium transition-colors",
                    usersActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                  )}
                >
                  <Users
                    className="shrink-0"
                    style={{ width: "var(--icon-size)", height: "var(--icon-size)" }}
                    aria-hidden
                  />
                  {tNav("users")}
                </Link>
              )}
              <Link
                href="/projects"
                className={cn(
                  "flex items-center gap-(--inline-gap) rounded-sm px-3 py-3 text-sm font-medium transition-colors",
                  projectsActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                )}
              >
                <FolderKanban
                  className="shrink-0"
                  style={{ width: "var(--icon-size)", height: "var(--icon-size)" }}
                  aria-hidden
                />
                {tNav("projects")}
              </Link>
              <Link
                href="/sprints"
                className={cn(
                  "flex items-center gap-(--inline-gap) rounded-sm px-3 py-3 text-sm font-medium transition-colors",
                  sprintsActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                )}
              >
                <LayoutGrid
                  className="shrink-0"
                  style={{ width: "var(--icon-size)", height: "var(--icon-size)" }}
                  aria-hidden
                />
                {tNav("sprints")}
              </Link>
              <Link
                href="/tickets"
                className={cn(
                  "flex items-center gap-(--inline-gap) rounded-sm px-3 py-3 text-sm font-medium transition-colors",
                  ticketsActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                )}
              >
                <LayoutList
                  className="shrink-0"
                  style={{ width: "var(--icon-size)", height: "var(--icon-size)" }}
                  aria-hidden
                />
                {tNav("tickets")}
              </Link>
            </>
          )}
        </nav>

        <div className="min-h-0 flex-1" />

        {user.role === "ADMIN" && (
          <div className="border-t border-border px-3 pt-2 pb-1">
            <Link
              href="/admin/teams"
              className={cn(
                "flex items-center gap-(--inline-gap) rounded-sm px-3 py-2 text-sm font-medium transition-colors",
                adminActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              )}
            >
              <Shield
                className="shrink-0"
                style={{ width: "var(--icon-size)", height: "var(--icon-size)" }}
                aria-hidden
              />
              {isSuperAdmin ? "All Teams" : "My Team"}
            </Link>
          </div>
        )}

        <div className="shrink-0 border-t border-border bg-sidebar-accent/40 p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex w-full min-h-(--min-touch) items-center gap-(--inline-gap) rounded-sm px-2 py-2 text-left outline-none transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700"
                  aria-hidden
                >
                  <UserIcon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-foreground">
                    {displayName}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {tRoles(roleCode)}
                  </span>
                </span>
                <ChevronDown
                  className="size-4 shrink-0 text-neutral-500"
                  aria-hidden
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-[min(100%,calc(var(--nav-width)-16px))]">
              {hasPermission(user.role, PERMISSIONS.ACCESS_DEVTOOLS) && (
                <>
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      window.dispatchEvent(new CustomEvent("devtools:open"));
                    }}
                  >
                    <SlidersHorizontal className="size-4" />
                    Dev Tools
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem asChild>
                <Link href="/settings" className="cursor-pointer">
                  <Settings className="size-4" />
                  {t("accountSettings")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={(e) => {
                  e.preventDefault();
                  void signOut({ callbackUrl: `/${locale}/login` });
                }}
              >
                <LogOut className="size-4" />
                {t("signOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </div>
  );
}
