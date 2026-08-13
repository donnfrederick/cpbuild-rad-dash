"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Loader2 } from "lucide-react";
import { UsersAdminView } from "@/components/users/UsersAdminView";
import { useAppUser } from "@/contexts/AppUserContext";
import { PERMISSIONS } from "@/lib/permissions-core";

interface RoleOption {
  id: string;
  code: string;
  name: string;
}

interface UserRow {
  id: string;
  name: string | null;
  email: string;
  status: string;
  role: RoleOption;
}

interface PendingInvite {
  id: string;
  email: string;
  token: string;
  role: RoleOption;
  expiresAt: string;
  sentBy: string;
}

interface TeamOption {
  id: string;
  name: string;
  logoUrl?: string | null;
}

export default function UsersPage(): React.ReactElement {
  const user = useAppUser();
  const router = useRouter();
  const locale = useLocale();
  const isSuperAdmin = user.specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS);
  const [bootstrap, setBootstrap] = useState<{
    users: UserRow[];
    invites: PendingInvite[];
    roles: RoleOption[];
    teams: TeamOption[];
  } | null>(null);
  const [bootstrapError, setBootstrapError] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) {
      router.replace(`/${locale}/tickets`);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [uRes, iRes, rRes, tRes] = await Promise.all([
        fetch("/api/users"),
        fetch("/api/invites"),
        fetch("/api/roles"),
        fetch("/api/teams"),
      ]);
      if (cancelled) return;
      if (!uRes.ok || !iRes.ok || !rRes.ok) {
        setBootstrapError(true);
        return;
      }
      const usersJson = (await uRes.json()) as { users: UserRow[] };
      const invitesJson = (await iRes.json()) as {
        invites: Array<{
          id: string;
          email: string;
          token: string;
          role: RoleOption;
          expiresAt: string;
          sentBy: string;
        }>;
      };
      const rolesJson = (await rRes.json()) as { roles: RoleOption[] };
      const teamsJson = tRes.ok ? ((await tRes.json()) as { teams: TeamOption[] }) : { teams: [] };
      setBootstrap({
        users: usersJson.users,
        invites: invitesJson.invites.map((i) => ({
          id: i.id,
          email: i.email,
          token: i.token,
          role: i.role,
          expiresAt: i.expiresAt,
          sentBy: i.sentBy,
        })),
        roles: rolesJson.roles,
        teams: teamsJson.teams,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [user.role, locale, router]);

  if (!isSuperAdmin) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }
  if (bootstrapError) {
    return <p className="p-6 text-sm text-destructive">Failed to load users.</p>;
  }
  if (bootstrap === null) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  return (
    <UsersAdminView
      currentUserId={user.id}
      initialUsers={bootstrap.users}
      initialInvites={bootstrap.invites}
      roles={bootstrap.roles}
      teams={bootstrap.teams}
    />
  );
}
