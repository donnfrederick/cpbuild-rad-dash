"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { Plus, Shield, Users, FolderKanban, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAppUser } from "@/contexts/AppUserContext";
import { useCurrentTeam } from "@/contexts/CurrentTeamContext";
import { PERMISSIONS } from "@/lib/permissions-core";

interface Team {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  createdAt: string;
  memberCount: number;
  projectCount: number;
}

export default function TeamsAdminPage() {
  const user = useAppUser();
  const router = useRouter();
  const locale = useLocale();
  const { refreshTeams } = useCurrentTeam();

  const t = useTranslations("teams");
  const isSuperAdmin = user.specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS);

  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);

  useEffect(() => {
    if (user.role !== "ADMIN") {
      router.replace(`/${locale}/tickets`);
      return;
    }
    void loadTeams();
  }, [user.role, locale, router]);

  async function loadTeams() {
    setLoading(true);
    try {
      const res = await fetch("/api/teams");
      if (!res.ok) throw new Error(t("loadFailed"));
      const data = (await res.json()) as { teams: Team[] };
      setTeams(data.teams);
    } catch {
      toast.error(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function createTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTeamName.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? t("createFailed"));
        return;
      }
      toast.success(t("createSuccess", { name: newTeamName.trim() }));
      setNewTeamName("");
      setShowCreateForm(false);
      refreshTeams();
      void loadTeams();
    } catch {
      toast.error(t("createFailed"));
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Shield className="size-6 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">
            {isSuperAdmin ? t("allTeams") : t("myTeams")}
          </h1>
        </div>
        {isSuperAdmin && (
          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-4" />
            {t("newTeam")}
          </button>
        )}
      </div>

      {showCreateForm && (
        <form
          onSubmit={createTeam}
          className="mt-6 flex items-end gap-3 rounded-lg border border-border bg-card p-4"
        >
          <label className="flex-1 text-sm font-medium text-foreground">
            {t("teamName")}
            <input
              autoFocus
              required
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              placeholder={t("teamNamePlaceholder")}
              className="mt-1 w-full rounded-sm border border-border bg-card px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={creating || !newTeamName.trim()}
            className="inline-flex h-9 items-center gap-2 rounded-sm bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {creating ? <Loader2 className="size-4 animate-spin" /> : t("create")}
          </button>
          <button
            type="button"
            onClick={() => { setShowCreateForm(false); setNewTeamName(""); }}
            className="inline-flex h-9 items-center rounded-sm border border-border px-4 text-sm font-medium text-muted-foreground hover:bg-neutral-100"
          >
            {t("cancel")}
          </button>
        </form>
      )}

      <div className="mt-6 flex flex-col gap-2">
        {teams.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => router.push(`/${locale}/admin/teams/${team.id}`)}
              className="flex items-center gap-4 rounded-lg border border-border bg-card px-5 py-4 text-left transition-colors hover:bg-neutral-50"
            >
              {team.logoUrl ? (
                <Image
                  src={team.logoUrl}
                  alt={team.name}
                  width={40}
                  height={40}
                  className="size-10 rounded-lg object-cover border border-border"
                  unoptimized
                />
              ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary border border-border">
                  {team.name.slice(0, 2).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-foreground">{team.name}</span>
                <span className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users className="size-3" />
                    {t("memberCount", { count: team.memberCount })}
                  </span>
                  <span className="flex items-center gap-1">
                    <FolderKanban className="size-3" />
                    {t("projectCount", { count: team.projectCount })}
                  </span>
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
