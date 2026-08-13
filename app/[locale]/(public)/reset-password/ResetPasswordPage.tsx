"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

function ResetPasswordForm(): React.ReactElement {
  const locale = useLocale();
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <p className="p-8 text-center text-destructive">
        Missing reset link. Use the link provided by your administrator.
      </p>
    );
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <p className="text-lg font-semibold text-foreground">Password updated!</p>
        <p className="mt-2 text-sm text-muted-foreground">You can now sign in with your new password.</p>
        <a
          href={`/${locale}/login`}
          className="mt-6 inline-flex h-10 items-center rounded-sm bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          Go to sign in
        </a>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setPending(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password, confirmPassword: confirm }),
    });
    setPending(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        details?: Record<string, string[]>;
      };
      const firstDetail = data.details ? Object.values(data.details).flat()[0] : undefined;
      toast.error(firstDetail ?? data.error ?? "Could not reset password.");
      return;
    }
    setDone(true);
  }

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-xl font-semibold text-foreground">Set a new password</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Choose a new password for your account.
      </p>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        <label className="text-sm font-medium text-foreground">
          New password
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-sm border border-border bg-card px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            At least 8 characters, one uppercase letter, and one number.
          </span>
        </label>
        <label className="text-sm font-medium text-foreground">
          Confirm password
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
          className="inline-flex h-10 items-center justify-center rounded-sm bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update password"}
        </button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage(): React.ReactElement {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
