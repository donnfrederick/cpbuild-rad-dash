"use client";

import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  ExternalLink,
  Loader2,
  MessageSquare,
  Trash2,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import type {
  TicketLinkedPRCommentRow,
  TicketLinkedPRRow,
} from "@/components/tickets/ticket-types";
import { cn } from "@/lib/utils";

function SectionHeading({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="mb-2 block text-[13px] font-bold uppercase tracking-wide text-muted-foreground">{children}</span>
  );
}

function StatusBadge({ status }: { status: TicketLinkedPRRow["status"] }): React.ReactElement {
  const t = useTranslations("tickets.github");
  const styles: Record<TicketLinkedPRRow["status"], string> = {
    OPEN: "bg-primary-100 text-primary-700",
    MERGED: "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-200",
    CLOSED: "bg-muted text-muted-foreground",
  };
  const label =
    status === "OPEN" ? t("prStatusOpen") : status === "MERGED" ? t("prStatusMerged") : t("prStatusClosed");
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", styles[status])}>{label}</span>
  );
}

function ChecksBadge({ status }: { status: TicketLinkedPRRow["checksStatus"] }): React.ReactElement {
  const t = useTranslations("tickets.github");
  const config: Record<
    TicketLinkedPRRow["checksStatus"],
    { label: string; icon: React.ReactElement; className: string }
  > = {
    PENDING: {
      label: t("checksPending"),
      icon: <CircleDot className="h-3.5 w-3.5" aria-hidden />,
      className: "bg-muted text-muted-foreground",
    },
    IN_PROGRESS: {
      label: t("checksInProgress"),
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />,
      className: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
    },
    SUCCESS: {
      label: t("checksSuccess"),
      icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />,
      className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
    },
    FAILURE: {
      label: t("checksFailure"),
      icon: <XCircle className="h-3.5 w-3.5" aria-hidden />,
      className: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200",
    },
  };
  const { label, icon, className } = config[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        className
      )}
      title={label}
      aria-label={label}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

function ReviewStateBadge({ state }: { state: string }): React.ReactElement | null {
  const t = useTranslations("tickets.github");
  const normalized = state.toLowerCase();
  const map: Record<string, { label: string; className: string }> = {
    approved: {
      label: t("reviewApproved"),
      className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
    },
    changes_requested: {
      label: t("reviewChangesRequested"),
      className: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200",
    },
    commented: {
      label: t("reviewCommented"),
      className: "bg-muted text-muted-foreground",
    },
    dismissed: {
      label: t("reviewDismissed"),
      className: "bg-muted text-muted-foreground line-through",
    },
  };
  const entry = map[normalized];
  if (!entry) return null;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", entry.className)}>
      {entry.label}
    </span>
  );
}

function getInitials(login: string): string {
  const trimmed = login.trim();
  if (!trimmed) return "?";
  return trimmed.slice(0, 2).toUpperCase();
}

function CommentItem({
  comment,
  locale,
}: {
  comment: TicketLinkedPRCommentRow;
  locale: string;
}): React.ReactElement {
  const when = new Date(comment.postedAt).toLocaleString(locale === "es" ? "es" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <li className="flex gap-3 rounded-md border border-border bg-background px-3 py-2.5 text-sm">
      {comment.authorAvatarUrl ? (
        <img
          src={comment.authorAvatarUrl}
          alt=""
          className="h-7 w-7 shrink-0 rounded-full bg-muted"
          loading="lazy"
        />
      ) : (
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
          aria-hidden
        >
          {getInitials(comment.authorLogin)}
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={comment.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-foreground hover:underline"
          >
            {comment.authorLogin}
          </a>
          {comment.commentType === "REVIEW" && comment.reviewState ? (
            <ReviewStateBadge state={comment.reviewState} />
          ) : null}
          <span className="text-xs text-muted-foreground">{when}</span>
        </div>
        {comment.body.trim().length > 0 ? (
          <p className="whitespace-pre-wrap wrap-break-word text-sm text-foreground/90">{comment.body}</p>
        ) : null}
      </div>
    </li>
  );
}

function CommentThread({
  ticketId: _ticketId,
  prRowId,
  comments,
  locale,
}: {
  ticketId: string;
  prRowId: string;
  comments: TicketLinkedPRCommentRow[];
  locale: string;
}): React.ReactElement {
  const t = useTranslations("tickets.github");
  const [open, setOpen] = useState(false);

  if (comments.length === 0) {
    return (
      <p className="mt-2 text-xs italic text-muted-foreground">{t("noPrComments")}</p>
    );
  }

  return (
    <div className="mt-2 w-full">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={`pr-comments-${prRowId}`}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        )}
        <MessageSquare className="h-3.5 w-3.5" aria-hidden />
        {t("prCommentCount", { count: comments.length })}
      </button>
      {open ? (
        <ul id={`pr-comments-${prRowId}`} className="mt-2 space-y-2">
          {comments.map((c) => (
            <CommentItem key={c.id} comment={c} locale={locale} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function LinkedPRsSection({
  ticketId,
  linkedPRs,
  isAdmin,
  onChanged,
}: {
  ticketId: string;
  linkedPRs: TicketLinkedPRRow[] | undefined;
  isAdmin: boolean;
  onChanged: () => void | Promise<void>;
}): React.ReactElement {
  const t = useTranslations("tickets.github");
  const locale = useLocale();
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const rows = linkedPRs ?? [];

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      toast.error(t("linkPrUrlRequired"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/linked-prs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prUrl: trimmed }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(err.error ?? t("linkPrFailed"));
        return;
      }
      toast.success(t("linkPrSuccess"));
      setUrl("");
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function unlink(prRowId: string): Promise<void> {
    setDeletingId(prRowId);
    try {
      const res = await fetch(
        `/api/tickets/${encodeURIComponent(ticketId)}/linked-prs/${encodeURIComponent(prRowId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(err.error ?? t("unlinkFailed"));
        return;
      }
      toast.success(t("unlinkSuccess"));
      await onChanged();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <SectionHeading>{t("linkedPullRequests")}</SectionHeading>

      {rows.length > 0 ? (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"
            >
              <div className="flex w-full flex-wrap items-center gap-2">
                <StatusBadge status={row.status} />
                <a
                  href={row.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-w-0 flex-1 items-center gap-1 font-medium text-primary hover:underline"
                >
                  <span className="truncate">
                    {row.repoOwner}/{row.repoName}#{row.prNumber}
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                </a>
                <ChecksBadge status={row.checksStatus} />
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => void unlink(row.id)}
                    disabled={deletingId === row.id}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
                    aria-label={t("unlinkPrAria")}
                  >
                    {deletingId === row.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="h-4 w-4" aria-hidden />
                    )}
                  </button>
                ) : null}
              </div>
              <CommentThread
                ticketId={ticketId}
                prRowId={row.id}
                comments={row.comments ?? []}
                locale={locale}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("noLinkedPrs")}</p>
      )}

      {isAdmin ? (
        <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 space-y-1">
            <label htmlFor={`link-pr-url-${ticketId}`} className="sr-only">
              {t("linkPrLabel")}
            </label>
            <Input
              id={`link-pr-url-${ticketId}`}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t("linkPrPlaceholder")}
              disabled={saving}
              className="w-full"
            />
          </div>
          <Button type="submit" disabled={saving} className="shrink-0 sm:w-auto">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : t("linkPrButton")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
