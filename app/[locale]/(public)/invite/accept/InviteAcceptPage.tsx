"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

function InviteAcceptForm(): React.ReactElement {
  const t = useTranslations("inviteAccept");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  /** When there is no token, we are not waiting on validation (avoids setState in effect for that case). */
  const [validating, setValidating] = useState(() => Boolean(token));
  const [valid, setValid] = useState(false);
  const [masked, setMasked] = useState("");
  const [roleName, setRoleName] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/invites/validate?token=${encodeURIComponent(token)}`);
      if (cancelled) return;
      setValidating(false);
      if (!res.ok) {
        setValid(false);
        return;
      }
      const data = (await res.json()) as {
        valid: boolean;
        emailMasked?: string;
        roleName?: string;
      };
      setValid(data.valid === true);
      if (data.emailMasked) setMasked(data.emailMasked);
      if (data.roleName) setRoleName(data.roleName);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!token) return;
    setPending(true);
    const res = await fetch("/api/invites/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, name, password, confirmPassword: confirm }),
    });
    setPending(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        details?: Record<string, string[]>;
      };
      const firstDetail = data.details
        ? Object.values(data.details).flat()[0]
        : undefined;
      toast.error(firstDetail ?? data.error ?? t("error"));
      return;
    }
    toast.success(t("success"));
    window.location.href = `/${locale}/login`;
  }

  if (!token) {
    return <p className="p-8 text-center text-muted-foreground">{t("noToken")}</p>;
  }

  if (validating) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!valid) {
    return <p className="p-8 text-center text-destructive">{t("invalid")}</p>;
  }

  return (
    <div className="mx-auto max-w-md px-(--page-padding-x) py-(--page-padding-y)">
      <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("forEmail", { email: masked })}
        {roleName ? ` · ${roleName}` : ""}
      </p>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        <label className="text-sm font-medium text-foreground">
          {t("name")}
          <input
            required
            minLength={2}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-sm border border-border bg-card px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm font-medium text-foreground">
          {t("password")}
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-sm border border-border bg-card px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            {t("passwordHint")}
          </span>
        </label>
        <label className="text-sm font-medium text-foreground">
          {t("confirmPassword")}
          <input
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 w-full rounded-sm border border-border bg-card px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-(--button-height) items-center justify-center rounded-sm bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("submit")}
        </button>
      </form>
    </div>
  );
}

function InviteAcceptFormWithKey(): React.ReactElement {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  return <InviteAcceptForm key={token || "__no_token__"} />;
}

export default function InviteAcceptPage(): React.ReactElement {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <InviteAcceptFormWithKey />
    </Suspense>
  );
}
