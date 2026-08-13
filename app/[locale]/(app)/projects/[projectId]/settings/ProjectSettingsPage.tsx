"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useAppUser } from "@/contexts/AppUserContext";

export default function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}): React.ReactElement {
  const { projectId } = use(params);
  const user = useAppUser();
  const t = useTranslations("projects");

  const [projectName, setProjectName] = useState("");
  const [projectTeamId, setProjectTeamId] = useState<string | null>(null);
  const [loadingProject, setLoadingProject] = useState(true);

  const isAdmin =
    user.role === "ADMIN" ||
    (projectTeamId !== null &&
      user.teamMemberships.some(
        (m) => m.teamId === projectTeamId && m.teamRole === "ADMIN"
      ));
  const [connected, setConnected] = useState(false);
  const [repoOwner, setRepoOwner] = useState("");
  const [repoName, setRepoName] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [loadingGithub, setLoadingGithub] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const webhookDisplayUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/api/webhooks/github`;
  }, []);

  const loadProject = useCallback(async () => {
    setLoadingProject(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
      if (!res.ok) throw new Error("project");
      const data = (await res.json()) as { name: string; teamId: string };
      setProjectName(data.name ?? "");
      setProjectTeamId(data.teamId ?? null);
    } catch {
      setProjectName("");
      toast.error(t("loadFailed"));
    } finally {
      setLoadingProject(false);
    }
  }, [projectId, t]);

  const loadGithub = useCallback(async () => {
    setLoadingGithub(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/github-config`);
      if (!res.ok) throw new Error("github");
      const data = (await res.json()) as {
        connected: boolean;
        repo: { repoOwner: string; repoName: string } | null;
      };
      setConnected(data.connected);
      if (data.repo) {
        setRepoOwner(data.repo.repoOwner);
        setRepoName(data.repo.repoName);
      } else {
        setRepoOwner("");
        setRepoName("");
      }
    } catch {
      setConnected(false);
    } finally {
      setLoadingGithub(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  useEffect(() => {
    void loadGithub();
  }, [loadGithub]);

  async function onSaveGithub(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!isAdmin) return;

    const owner = repoOwner.trim().toLowerCase();
    const name = repoName.trim().toLowerCase();
    if (!owner || !name) {
      toast.error(t("saveFailed"));
      return;
    }

    const secretTrim = webhookSecret.trim();
    if (!connected && !secretTrim) {
      toast.error(t("githubSecretRequiredNew"));
      return;
    }

    setSaving(true);
    try {
      const body: { repoOwner: string; repoName: string; webhookSecret?: string } = {
        repoOwner: owner,
        repoName: name,
      };
      if (secretTrim) {
        body.webhookSecret = secretTrim;
      }

      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/github-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 409) {
          toast.error(t("githubConflictRepo"));
        } else {
          toast.error(err.error ?? t("githubSaveFailed"));
        }
        return;
      }
      toast.success(t("githubSaved"));
      setWebhookSecret("");
      await loadGithub();
    } finally {
      setSaving(false);
    }
  }

  async function onDisconnect(): Promise<void> {
    if (!isAdmin || !connected) return;
    setDisconnecting(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/github-config`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(err.error ?? t("githubDisconnectFailed"));
        return;
      }
      toast.success(t("githubDisconnected"));
      setWebhookSecret("");
      await loadGithub();
    } finally {
      setDisconnecting(false);
    }
  }

  if (loadingProject) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  return (
    <div
      className="mx-auto w-full max-w-2xl py-(--page-padding-y)"
      style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
    >
      <header className="mb-8 border-b border-border pb-6">
        <h1 className="text-xl font-semibold text-foreground">{t("settingsTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {projectName ? `${projectName} · ${t("settingsSubtitle")}` : t("settingsSubtitle")}
        </p>
      </header>

      <section
        className="rounded-xl border border-border bg-card p-5 shadow-(--shadow-1) sm:p-6"
        aria-labelledby="github-integration-heading"
      >
        <h2 id="github-integration-heading" className="text-base font-semibold text-foreground">
          {t("githubIntegrationTitle")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("githubIntegrationDescription")}</p>

        <div className="mt-4 rounded-lg bg-muted/50 p-3 text-sm">
          <div className="font-medium text-foreground">{t("githubWebhookUrlLabel")}</div>
          <code className="mt-1 block break-all text-xs">{webhookDisplayUrl || "…"}</code>
        </div>

        {!isAdmin ? (
          <p className="mt-4 text-sm text-amber-700 dark:text-amber-300">{t("githubAdminOnly")}</p>
        ) : null}

        {loadingGithub ? (
          <div className="mt-6 flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : (
          <form onSubmit={(e) => void onSaveGithub(e)} className="mt-6 space-y-4">
            {connected ? (
              <p className="text-sm text-foreground">
                {t("githubConnectedAs", { owner: repoOwner, name: repoName })}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{t("githubNotConnected")}</p>
            )}

            <div className="space-y-2">
              <label htmlFor="gh-owner" className="text-sm font-medium text-foreground">
                {t("githubRepoOwner")}
              </label>
              <Input
                id="gh-owner"
                value={repoOwner}
                onChange={(e) => setRepoOwner(e.target.value)}
                disabled={!isAdmin || saving}
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="gh-name" className="text-sm font-medium text-foreground">
                {t("githubRepoName")}
              </label>
              <Input
                id="gh-name"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                disabled={!isAdmin || saving}
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="gh-secret" className="text-sm font-medium text-foreground">
                {t("githubWebhookSecret")}
              </label>
              <Input
                id="gh-secret"
                type="password"
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                disabled={!isAdmin || saving}
                autoComplete="new-password"
                placeholder={connected ? "••••••••" : ""}
              />
              <p className="text-xs text-muted-foreground">{t("githubWebhookSecretHelp")}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!isAdmin || saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    {t("githubSaving")}
                  </>
                ) : (
                  t("githubSave")
                )}
              </Button>
              {connected ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!isAdmin || disconnecting || saving}
                  onClick={() => void onDisconnect()}
                >
                  {disconnecting ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    t("githubDisconnect")
                  )}
                </Button>
              ) : null}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
