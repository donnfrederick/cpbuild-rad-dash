"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { TeamMembershipInfo } from "@/hooks/useMe";
import { PERMISSIONS } from "@/lib/permissions-core";

export interface CurrentTeam {
  teamId: string;
  teamName: string;
  teamSlug: string;
  teamRole: "ADMIN" | "MEMBER" | null;
  teamLogoUrl: string | null;
}

export interface AllTeamsEntry {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

interface CurrentTeamContextValue {
  currentTeam: CurrentTeam | null;
  setCurrentTeam: (slug: string) => void;
  /** All teams visible to this user (memberships for regulars, all teams for super admin). */
  allTeams: AllTeamsEntry[];
  /** Re-fetch the team list — call this after creating or deleting a team. */
  refreshTeams: () => void;
}

const CurrentTeamContext = createContext<CurrentTeamContextValue | null>(null);

const STORAGE_KEY = "rad-dash:last-team";

function readStoredSlug(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredSlug(slug: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, slug);
  } catch {
    // ignore — private browsing may block storage
  }
}

export function CurrentTeamProvider({
  children,
  teamMemberships,
  specialPermissions,
}: {
  children: React.ReactNode;
  teamMemberships: TeamMembershipInfo[];
  specialPermissions: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isSuperAdmin = specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS);

  const teamParam = searchParams.get("team");

  // Persist the team param to storage whenever it's present in the URL
  useEffect(() => {
    if (teamParam) writeStoredSlug(teamParam);
  }, [teamParam]);

  // Super admins fetch the full list from the API so newly-created teams appear immediately.
  const [fetchedTeams, setFetchedTeams] = useState<AllTeamsEntry[]>([]);
  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => {
    if (!isSuperAdmin) return;
    void fetch("/api/teams")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { teams: AllTeamsEntry[] } | null) => {
        if (data?.teams) setFetchedTeams(data.teams);
      });
  }, [isSuperAdmin, fetchKey]);

  const refreshTeams = useCallback(() => setFetchKey((k) => k + 1), []);

  // For regular multi-team users, derive from the memberships passed at auth time.
  const membershipTeams = useMemo<AllTeamsEntry[]>(
    () =>
      teamMemberships.map((m) => ({
        id: m.teamId,
        name: m.teamName,
        slug: m.teamSlug,
        logoUrl: m.teamLogoUrl,
      })),
    [teamMemberships]
  );

  const allTeams = isSuperAdmin ? fetchedTeams : membershipTeams;

  const resolvedTeam = useMemo<CurrentTeam | null>(() => {
    // Priority 1: explicit ?team= URL param
    if (teamParam) {
      const match = teamMemberships.find(
        (m) => m.teamSlug === teamParam || m.teamId === teamParam
      );
      if (match) {
        return {
          teamId: match.teamId,
          teamName: match.teamName,
          teamSlug: match.teamSlug,
          teamRole: match.teamRole,
          teamLogoUrl: match.teamLogoUrl,
        };
      }
      // Super admin may view any team; look it up in the fetched list for a display name.
      if (isSuperAdmin) {
        const fetched = fetchedTeams.find((t) => t.slug === teamParam || t.id === teamParam);
        return {
          teamId: fetched?.id ?? teamParam,
          teamName: fetched?.name ?? teamParam,
          teamSlug: fetched?.slug ?? teamParam,
          teamRole: null,
          teamLogoUrl: fetched?.logoUrl ?? null,
        };
      }
    }

    // Priority 2: last team the user explicitly chose (stored in localStorage)
    const storedSlug = readStoredSlug();
    if (storedSlug) {
      const match = teamMemberships.find((m) => m.teamSlug === storedSlug);
      if (match) {
        return {
          teamId: match.teamId,
          teamName: match.teamName,
          teamSlug: match.teamSlug,
          teamRole: match.teamRole,
          teamLogoUrl: match.teamLogoUrl,
        };
      }
      if (isSuperAdmin) {
        const fetched = fetchedTeams.find((t) => t.slug === storedSlug);
        if (fetched) {
          return {
            teamId: fetched.id,
            teamName: fetched.name,
            teamSlug: fetched.slug,
            teamRole: null,
            teamLogoUrl: fetched.logoUrl,
          };
        }
      }
    }

    // Priority 3: first membership (alphabetical by name)
    const sorted = [...teamMemberships].sort((a, b) =>
      a.teamName.localeCompare(b.teamName)
    );
    const first = sorted[0];
    if (!first) return null;
    return {
      teamId: first.teamId,
      teamName: first.teamName,
      teamSlug: first.teamSlug,
      teamRole: first.teamRole,
      teamLogoUrl: first.teamLogoUrl,
    };
  }, [teamParam, teamMemberships, isSuperAdmin, fetchedTeams]);

  const setCurrentTeam = useCallback(
    (slug: string) => {
      writeStoredSlug(slug);
      const params = new URLSearchParams(searchParams.toString());
      params.set("team", slug);
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams]
  );

  return (
    <CurrentTeamContext.Provider
      value={{ currentTeam: resolvedTeam, setCurrentTeam, allTeams, refreshTeams }}
    >
      {children}
    </CurrentTeamContext.Provider>
  );
}

export function useCurrentTeam(): CurrentTeamContextValue {
  const ctx = useContext(CurrentTeamContext);
  if (!ctx) throw new Error("useCurrentTeam must be used within CurrentTeamProvider");
  return ctx;
}
