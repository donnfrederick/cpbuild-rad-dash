"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, ChevronDown, Copy, Loader2, Mail, Search, Trash2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

type UserStatusValue = "ACTIVE" | "INACTIVE" | "SUSPENDED";

interface EmailDiagnosticsResponse {
  config: {
    transport: "smtp" | "resend";
    resendKeySet: boolean;
    resendKeyValid: boolean;
    emailFromSet: boolean;
    smtpHostSet: boolean;
  };
  hint: string;
}

interface TeamOption {
  id: string;
  name: string;
  logoUrl?: string | null;
}

function teamInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// ── Multi-team select with search ──────────────────────────────────────────

interface MultiTeamSelectProps {
  teams: TeamOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
}

function MultiTeamSelect({
  teams,
  selectedIds,
  onChange,
  placeholder = "Select teams…",
  searchPlaceholder = "Search teams…",
}: MultiTeamSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = teams.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()));
  const selectedTeams = teams.filter((t) => selectedIds.includes(t.id));

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    setTimeout(() => searchRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    onChange(selectedIds.filter((x) => x !== id));
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-(--input-height) w-full flex-wrap items-center gap-1 rounded-sm border border-border bg-background px-2 py-1 text-left text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {selectedTeams.length === 0 ? (
          <span className="px-1 text-muted-foreground">{placeholder}</span>
        ) : (
          selectedTeams.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 rounded-sm bg-muted pl-0.5 pr-2 py-0.5 text-xs font-medium text-foreground"
            >
              {t.logoUrl ? (
                <Image
                  src={t.logoUrl}
                  alt={t.name}
                  width={16}
                  height={16}
                  className="size-4 rounded-sm object-cover"
                  unoptimized
                />
              ) : (
                <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-neutral-200 text-[8px] font-bold text-neutral-600">
                  {teamInitials(t.name)}
                </span>
              )}
              {t.name}
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => remove(t.id, e)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onChange(selectedIds.filter((x) => x !== t.id));
                  }
                }}
                className="cursor-pointer text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${t.name}`}
              >
                <X className="h-2.5 w-2.5" />
              </span>
            </span>
          ))
        )}
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-sm border border-border bg-popover shadow-md">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <ul className="max-h-44 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">No teams found.</li>
            ) : (
              filtered.map((t) => {
                const selected = selectedIds.includes(t.id);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => toggle(t.id)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/60"
                    >
                      <span
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                          selected ? "border-primary bg-primary" : "border-border"
                        }`}
                      >
                        {selected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                      </span>
                      {t.logoUrl ? (
                        <Image
                          src={t.logoUrl}
                          alt={t.name}
                          width={20}
                          height={20}
                          className="size-5 shrink-0 rounded-sm object-cover"
                          unoptimized
                        />
                      ) : (
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-neutral-200 text-[9px] font-bold text-neutral-600">
                          {teamInitials(t.name)}
                        </span>
                      )}
                      <span className="text-foreground">{t.name}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

interface UsersAdminViewProps {
  currentUserId: string;
  initialUsers: UserRow[];
  initialInvites: PendingInvite[];
  roles: RoleOption[];
  teams: TeamOption[];
}

interface BulkInviteResultRow {
  email: string;
  success: boolean;
  inviteLink?: string;
  emailSent?: boolean;
  emailErrorCode?: string;
  error?: string;
}

function inviteErrorCodeMessage(t: (key: string) => string, code: string | undefined): string {
  if (code === "SMTP_CONNECTION") return t("emailErrorSmtp");
  if (code === "RESEND_CONFIG") return t("emailErrorResend");
  return t("emailErrorUnknown");
}

export function UsersAdminView({
  currentUserId,
  initialUsers,
  initialInvites,
  roles,
  teams,
}: UsersAdminViewProps) {
  const t = useTranslations("users");
  const locale = useLocale();
  const [users, setUsers] = useState(initialUsers);
  const [invites, setInvites] = useState(initialInvites);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteBulkText, setInviteBulkText] = useState("");
  const [inviteRoleId, setInviteRoleId] = useState(
    roles.find((r) => r.code === "MEMBER")?.id ?? roles[0]?.id ?? ""
  );
  const selectedRoleIsAdmin = roles.find((r) => r.id === inviteRoleId)?.code === "ADMIN";
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [teamRoles, setTeamRoles] = useState<Record<string, "ADMIN" | "MEMBER">>({});
  const [grantAllTeams, setGrantAllTeams] = useState(false);
  const [invitePending, setInvitePending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [emailDiag, setEmailDiag] = useState<EmailDiagnosticsResponse | null>(null);
  const [emailDiagDismissed, setEmailDiagDismissed] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletePending, setDeletePending] = useState(false);

  useEffect(() => {
    void fetch("/api/email/diagnostics")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setEmailDiag(d as EmailDiagnosticsResponse);
      });
  }, []);

  function copyLink(link: string, key: string) {
    void navigator.clipboard.writeText(link).then(() => {
      setCopiedId(key);
      toast.success(t("linkCopied"));
      setTimeout(() => setCopiedId((prev) => (prev === key ? null : prev)), 2000);
    });
  }

  const reload = useCallback(async () => {
    const [uRes, iRes] = await Promise.all([fetch("/api/users"), fetch("/api/invites")]);
    if (uRes.ok) {
      const data = (await uRes.json()) as { users: UserRow[] };
      setUsers(data.users);
    }
    if (iRes.ok) {
      const data = (await iRes.json()) as { invites: PendingInvite[] };
      setInvites(data.invites);
    }
  }, []);

  async function submitBulkInvites(e: React.FormEvent) {
    e.preventDefault();
    const parts = inviteBulkText
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      toast.error(t("inviteEmailsRequired"));
      return;
    }
    if (teams.length > 0 && !grantAllTeams && selectedTeamIds.length === 0) {
      toast.error(t("teamsRequiredError"));
      return;
    }
    setInvitePending(true);
    const teamAssignments = selectedTeamIds.map((teamId) => ({
      teamId,
      teamRole: (teamRoles[teamId] ?? "MEMBER") as "ADMIN" | "MEMBER",
    }));
    const res = await fetch("/api/invites/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        emails: parts,
        roleId: inviteRoleId,
        ...(grantAllTeams ? { grantAllTeams: true } : teamAssignments.length > 0 ? { teamAssignments } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      invalidEmails?: string[];
      results?: BulkInviteResultRow[];
      summary?: { created: number; failed: number; total: number };
    };
    setInvitePending(false);
    if (!res.ok) {
      toast.error(data.error ?? t("inviteBulkFailed"));
      return;
    }
    if (data.invalidEmails && data.invalidEmails.length > 0) {
      toast.warning(t("inviteInvalidSkipped", { count: data.invalidEmails.length }));
    }
    const summary = data.summary ?? { created: 0, failed: 0, total: 0 };
    toast.success(
      t("inviteBulkSummary", {
        created: summary.created,
        failed: summary.failed,
      })
    );
    const rows = data.results ?? [];
    const emailFailures = rows.filter((r) => r.success && r.emailSent === false);
    if (emailFailures.length > 0) {
      const code = emailFailures[0]?.emailErrorCode;
      toast.warning(`${t("inviteEmailNotSent")} ${inviteErrorCodeMessage(t, code)}`);
    }
    setInviteBulkText("");
    setSelectedTeamIds([]);
    setTeamRoles({});
    setGrantAllTeams(false);
    setInviteModalOpen(false);
    void reload();
  }

  async function changeRole(userId: string, roleId: string) {
    setSavingId(userId);
    const res = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId }),
    });
    setSavingId(null);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(err.error ?? "Update failed");
      return;
    }
    toast.success(t("roleUpdated"));
    void reload();
  }

  async function changeStatus(userId: string, status: UserStatusValue) {
    setSavingId(userId);
    const res = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setSavingId(null);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(err.error ?? "Update failed");
      return;
    }
    toast.success(t("statusUpdated"));
    void reload();
  }

  async function generateResetLink(userId: string) {
    const res = await fetch(`/api/users/${userId}/reset-password`, { method: "POST" });
    if (!res.ok) {
      toast.error("Could not generate reset link");
      return;
    }
    const data = (await res.json()) as { resetLink: string };
    copyLink(data.resetLink, "last");
  }

  async function resendInvite(id: string) {
    const res = await fetch(`/api/invites/${id}/resend`, { method: "POST" });
    if (!res.ok) {
      toast.error(t("resendFailed"));
      return;
    }
    const data = (await res.json()) as { emailSent?: boolean; emailErrorCode?: string };
    if (data.emailSent === false) {
      toast.warning(`${t("resentNotSent")} ${inviteErrorCodeMessage(t, data.emailErrorCode)}`);
    } else {
      toast.success(t("resent"));
    }
  }

  async function confirmDeleteUser() {
    if (!deleteTarget || deleteConfirmText !== "DELETE") {
      toast.error(t("deleteConfirmMismatch"));
      return;
    }
    setDeletePending(true);
    const res = await fetch(`/api/users/${deleteTarget.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      code?: string;
      reasons?: string[];
    };
    setDeletePending(false);
    if (res.status === 409 && data.code === "USER_DELETE_BLOCKED") {
      toast.error(data.message ?? t("deleteBlocked"));
      setDeleteTarget(null);
      setDeleteConfirmText("");
      return;
    }
    if (!res.ok) {
      toast.error(data.error ?? t("deleteFailed"));
      return;
    }
    toast.success(data.message ?? t("deleteSuccess"));
    setDeleteTarget(null);
    setDeleteConfirmText("");
    void reload();
  }

  return (
    <div
      className="mx-auto max-w-5xl py-(--page-padding-y)"
      style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
    >
      {emailDiag && !emailDiagDismissed && (
        <div className="mb-6 flex items-start justify-between gap-3 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
          <div>
            <p className="font-medium text-foreground">{t("emailDiagTitle")}</p>
            <p className="mt-1 text-muted-foreground">{emailDiag.hint}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("emailDiagTransport", { transport: emailDiag.config.transport })}
              {emailDiag.config.smtpHostSet ? ` · ${t("emailDiagSmtpSet")}` : ""}
              {emailDiag.config.resendKeyValid ? ` · ${t("emailDiagResendOk")}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEmailDiagDismissed(true)}
            className="shrink-0 text-sm text-muted-foreground hover:text-foreground"
          >
            {t("emailDiagDismiss")}
          </button>
        </div>
      )}

      <div className="mb-(--section-gap) flex flex-wrap items-center justify-between gap-4">
        <div className="flex w-full justify-end">
          <button
            type="button"
            onClick={() => setInviteModalOpen(true)}
            className="inline-flex h-(--button-height) items-center gap-2 rounded-sm bg-primary px-3 text-sm font-semibold text-primary-foreground"
          >
            <Mail className="h-4 w-4" />
            {t("inviteUser")}
          </button>
        </div>
      </div>

      <Dialog
        open={inviteModalOpen}
        onOpenChange={(open) => {
          setInviteModalOpen(open);
          if (!open) {
            setSelectedTeamIds([]);
            setTeamRoles({});
            setGrantAllTeams(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submitBulkInvites}>
            <DialogHeader>
              <DialogTitle>{t("inviteModalTitle")}</DialogTitle>
              <DialogDescription>{t("inviteModalDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <label className="flex flex-col text-sm">
                <span className="text-muted-foreground">{t("inviteBulkEmailsLabel")}</span>
                <textarea
                  required
                  rows={6}
                  value={inviteBulkText}
                  onChange={(e) => setInviteBulkText(e.target.value)}
                  placeholder={t("inviteBulkPlaceholder")}
                  className="mt-1 min-h-[120px] w-full rounded-sm border border-border bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="flex flex-col text-sm">
                <span className="text-muted-foreground">{t("role")}</span>
                <select
                  value={inviteRoleId}
                  onChange={(e) => {
                    setInviteRoleId(e.target.value);
                    const isAdmin = roles.find((r) => r.id === e.target.value)?.code === "ADMIN";
                    if (!isAdmin) setGrantAllTeams(false);
                  }}
                  className="mt-1 min-h-(--input-height) rounded-sm border border-border bg-background px-3 text-sm"
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              {selectedRoleIsAdmin && (
                <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={grantAllTeams}
                    onChange={(e) => {
                      setGrantAllTeams(e.target.checked);
                      if (e.target.checked) {
                        setSelectedTeamIds([]);
                        setTeamRoles({});
                      }
                    }}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded-sm accent-primary"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium text-foreground">{t("grantAllTeamsLabel")}</span>
                    <span className="text-xs text-muted-foreground">{t("grantAllTeamsHint")}</span>
                  </span>
                </label>
              )}
              {teams.length > 0 && !grantAllTeams && (
                <div className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">
                    {t("teamsLabel")}
                    <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">{t("teamsOptional")}</span>
                  </span>
                  <MultiTeamSelect
                    teams={teams}
                    selectedIds={selectedTeamIds}
                    onChange={(ids) => {
                      setSelectedTeamIds(ids);
                      setTeamRoles((prev) => {
                        const next: Record<string, "ADMIN" | "MEMBER"> = {};
                        for (const id of ids) next[id] = prev[id] ?? "MEMBER";
                        return next;
                      });
                    }}
                    placeholder={t("teamsPlaceholder")}
                    searchPlaceholder={t("teamsSearch")}
                  />
                  {selectedTeamIds.length > 0 && (
                    <div className="mt-2 flex flex-col gap-1 rounded-sm border border-border bg-muted/30 px-3 py-2">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">{t("teamRolesLabel")}</p>
                      {selectedTeamIds.map((teamId) => {
                        const team = teams.find((t) => t.id === teamId);
                        if (!team) return null;
                        return (
                          <div key={teamId} className="flex items-center justify-between gap-2">
                            <span className="truncate text-foreground">{team.name}</span>
                            <select
                              value={teamRoles[teamId] ?? "MEMBER"}
                              onChange={(e) =>
                                setTeamRoles((prev) => ({
                                  ...prev,
                                  [teamId]: e.target.value as "ADMIN" | "MEMBER",
                                }))
                              }
                              className="min-h-7 rounded-sm border border-border bg-background px-2 text-xs"
                            >
                              <option value="MEMBER">{t("teamRoleMember")}</option>
                              <option value="ADMIN">{t("teamRoleAdmin")}</option>
                            </select>
                          </div>
                        );
                      })}
                      <p className="mt-1 text-xs text-muted-foreground">{t("teamRolesAdminHint")}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
            <DialogFooter>
              <button
                type="button"
                onClick={() => setInviteModalOpen(false)}
                className="text-sm text-muted-foreground"
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={invitePending}
                className="inline-flex h-(--button-height) items-center rounded-sm bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {invitePending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("sendInvite")}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteConfirmText("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("deleteConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? t("deleteConfirmDescription", {
                    email: deleteTarget.email,
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-destructive">{t("deleteWarningTickets")}</p>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("deleteConfirmHint")}</span>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              className="min-h-(--input-height) rounded-sm border border-border bg-background px-3 text-sm"
              placeholder={t("deleteConfirmPlaceholder")}
              autoComplete="off"
            />
          </label>
          <DialogFooter>
            <button
              type="button"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteConfirmText("");
              }}
              className="text-sm text-muted-foreground"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              disabled={deletePending || deleteConfirmText !== "DELETE"}
              onClick={() => void confirmDeleteUser()}
              className="inline-flex h-(--button-height) items-center rounded-sm bg-destructive px-4 text-sm font-semibold text-destructive-foreground disabled:opacity-50"
            >
              {deletePending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("deleteUser")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-foreground">{t("members")}</h2>
        <div className="overflow-x-auto rounded-md border border-border bg-card shadow-(--shadow-1)">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="p-3 font-medium">{t("name")}</th>
                <th className="p-3 font-medium">{t("email")}</th>
                <th className="p-3 font-medium">{t("role")}</th>
                <th className="p-3 font-medium">{t("status")}</th>
                <th className="p-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="p-3 text-foreground">{u.name ?? "—"}</td>
                  <td className="p-3 text-foreground">{u.email}</td>
                  <td className="p-3">
                    <select
                      value={u.role.id}
                      disabled={savingId === u.id}
                      onChange={(e) => void changeRole(u.id, e.target.value)}
                      className="min-h-8 rounded-sm border border-border bg-background px-2 text-sm"
                    >
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-3">
                    <select
                      value={u.status}
                      disabled={savingId === u.id}
                      onChange={(e) => void changeStatus(u.id, e.target.value as UserStatusValue)}
                      className="min-h-8 rounded-sm border border-border bg-background px-2 text-sm"
                    >
                      <option value="ACTIVE">{t("statusActive")}</option>
                      <option value="INACTIVE">{t("statusInactive")}</option>
                      <option value="SUSPENDED">{t("statusSuspended")}</option>
                    </select>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
                      <button
                        type="button"
                        onClick={() => void generateResetLink(u.id)}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Copy className="h-3 w-3" />
                        {t("copyResetLink")}
                      </button>
                      {u.id !== currentUserId && (
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteTarget(u);
                            setDeleteConfirmText("");
                          }}
                          className="inline-flex items-center gap-1 text-xs text-destructive hover:underline"
                        >
                          <Trash2 className="h-3 w-3" />
                          {t("deleteUser")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-foreground">{t("pendingInvites")}</h2>
        {invites.length === 0 ? (
          <p className="text-muted-foreground">{t("noInvites")}</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
            {invites.map((i) => {
              const link = `${window.location.origin}/${locale}/invite/accept?token=${encodeURIComponent(i.token)}`;
              return (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <div>
                    <span className="font-medium text-foreground">{i.email}</span>
                    <span className="ml-2 text-muted-foreground">
                      {i.role.name} · {t("expires")}{" "}
                      {new Date(i.expiresAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => copyLink(link, i.id)}
                      className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
                    >
                      {copiedId === i.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedId === i.id ? t("copied") : t("copyLink")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void resendInvite(i.id)}
                      className="text-sm font-medium text-primary"
                    >
                      {t("resend")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
