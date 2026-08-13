"use client";

import { useEffect, useState } from "react";

export interface TeamMembershipInfo {
  teamId: string;
  teamName: string;
  teamSlug: string;
  teamRole: "ADMIN" | "MEMBER";
  teamLogoUrl: string | null;
}

export interface MeUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  roleNameFromDb: string | null;
  status: "ACTIVE";
  specialPermissions: string[];
  teamMemberships: TeamMembershipInfo[];
}

export type UseMeState =
  | { status: "loading"; user: null }
  | { status: "authenticated"; user: MeUser }
  | { status: "unauthorized"; user: null };

export function useMe(): UseMeState {
  const [state, setState] = useState<UseMeState>({ status: "loading", user: null });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/me");
      if (cancelled) return;
      if (res.status === 401) {
        setState({ status: "unauthorized", user: null });
        return;
      }
      if (!res.ok) {
        setState({ status: "unauthorized", user: null });
        return;
      }
      const data = (await res.json()) as { user: MeUser };
      setState({ status: "authenticated", user: data.user });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
