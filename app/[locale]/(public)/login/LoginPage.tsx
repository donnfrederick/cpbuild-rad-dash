"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";

export default function LoginPage(): React.ReactElement {
  const t = useTranslations("login");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? `/${locale}/tickets`;

  const [view, setView] = useState<"login" | "forgot" | "forgot-sent">("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotPending, setForgotPending] = useState(false);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl,
    });
    setPending(false);
    if (res?.error) {
      setError("Invalid email or password");
      return;
    }
    if (res?.url) {
      window.location.href = res.url;
    }
  }

  async function onForgotSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setForgotPending(true);
    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: forgotEmail, locale }),
    }).catch(() => {});
    setForgotPending(false);
    setView("forgot-sent");
  }

  const inputClass =
    "min-h-(--input-height) rounded-sm border border-border bg-card px-3 text-sm text-foreground shadow-(--shadow-1)";
  const btnClass =
    "inline-flex h-(--button-height) items-center justify-center rounded-sm bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-(--shadow-1) disabled:opacity-50";

  if (view === "forgot") {
    return (
      <div
        className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center"
        style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
      >
        <h1 className="mb-2 text-foreground">{t("forgotTitle")}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{t("forgotDescription")}</p>
        <form onSubmit={onForgotSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
            <span>{t("email")}</span>
            <input
              type="email"
              autoComplete="email"
              value={forgotEmail}
              onChange={(e) => setForgotEmail(e.target.value)}
              className={inputClass}
              required
            />
          </label>
          <button type="submit" disabled={forgotPending} className={btnClass}>
            {forgotPending ? "…" : t("forgotSubmit")}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setView("login")}
          className="mt-4 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {t("backToSignIn")}
        </button>
      </div>
    );
  }

  if (view === "forgot-sent") {
    return (
      <div
        className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center"
        style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
      >
        <p className="mb-6 text-sm text-foreground">{t("forgotSent")}</p>
        <button
          type="button"
          onClick={() => setView("login")}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline self-start"
        >
          {t("backToSignIn")}
        </button>
      </div>
    );
  }

  return (
    <div
      className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center"
      style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
    >
      <h1 className="mb-6 text-foreground">{t("title")}</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
          <span>{t("email")}</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
          <span>{t("password")}</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            required
          />
        </label>
        {error && <p className="text-sm font-medium text-error-600">{error}</p>}
        <button type="submit" disabled={pending} className={btnClass}>
          {pending ? "…" : t("submit")}
        </button>
      </form>
      <button
        type="button"
        onClick={() => setView("forgot")}
        className="mt-4 self-start text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        {t("forgotPassword")}
      </button>
    </div>
  );
}
