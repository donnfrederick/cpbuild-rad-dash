"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { User } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ProfileSettingsFormProps {
  initialName: string | null;
  email: string;
  roleCode: string;
  roleNameFromDb: string | null;
}

export function ProfileSettingsForm({
  initialName,
  email,
  roleCode,
  roleNameFromDb,
}: ProfileSettingsFormProps) {
  const t = useTranslations("settings.profile");
  const tRoles = useTranslations("roles");
  const { update: updateSession } = useSession();

  const [name, setName] = useState(initialName ?? "");
  const [committedTrimmed, setCommittedTrimmed] = useState(
    () => (initialName ?? "").trim()
  );
  const [saving, setSaving] = useState(false);

  const roleDisplay =
    roleNameFromDb?.trim() ||
    (roleCode === "ADMIN" || roleCode === "MEMBER"
      ? tRoles(roleCode)
      : tRoles("unknown"));

  const trimmed = name.trim();
  const unchanged = trimmed === committedTrimmed;

  const onSave = useCallback(async () => {
    if (unchanged || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(err?.error ?? t("saveError"));
        return;
      }
      const data = (await res.json()) as { name: string | null };
      const next = data.name ?? "";
      setCommittedTrimmed(next.trim());
      setName(next);
      if (updateSession) {
        await updateSession({ name: data.name });
      }
      toast.success(t("saved"));
    } catch {
      toast.error(t("saveError"));
    } finally {
      setSaving(false);
    }
  }, [name, unchanged, saving, updateSession, t]);

  return (
    <div
      className="mx-auto max-w-2xl py-(--page-padding-y)"
      style={{
        paddingLeft: "var(--page-padding-x)",
        paddingRight: "var(--page-padding-x)",
      }}
    >
      <div className="overflow-hidden rounded-md border border-border bg-card shadow-(--shadow-1)">
        <div className="border-b border-border p-(--card-padding)">
          <div className="flex gap-(--component-gap)">
            <span
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700"
              aria-hidden
            >
              <User className="size-6" />
            </span>
            <div>
              <h1 className="text-foreground" style={{ fontSize: "var(--text-heading)" }}>
                {t("title")}
              </h1>
              <p className="mt-1 text-muted-foreground" style={{ fontSize: "var(--text-body)" }}>
                {t("subtitle")}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-0 p-(--card-padding)">
          <div className="pb-5">
            <label className="mb-2 block text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t("name")}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-h-(--input-height) rounded-sm border-border shadow-(--shadow-1)"
              autoComplete="name"
              disabled={saving}
            />
          </div>

          <div className="flex flex-col gap-1 border-t border-border py-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-8">
            <span className="shrink-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t("email")}
            </span>
            <span className="min-w-0 break-all text-foreground sm:text-end">{email}</span>
          </div>

          <div className="flex flex-col gap-1 border-t border-border py-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-8">
            <span className="shrink-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t("role")}
            </span>
            <span className="text-foreground sm:text-end">{roleDisplay}</span>
          </div>
        </div>

        <div className="border-t border-border p-(--card-padding)">
          <Button
            type="button"
            variant="outline"
            className="min-h-(--button-height) border-border px-4 font-medium"
            disabled={unchanged || saving}
            onClick={() => void onSave()}
          >
            {saving ? t("saving") : t("save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
