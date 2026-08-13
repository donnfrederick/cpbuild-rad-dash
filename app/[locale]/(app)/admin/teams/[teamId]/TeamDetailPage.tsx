"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import {
  ArrowLeft,
  Crown,
  GripVertical,
  Lock,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Shield,
  Tag,
  Trash2,
  Upload,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAppUser } from "@/contexts/AppUserContext";
import { PERMISSIONS } from "@/lib/permissions-core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TeamTicketType {
  id: string;
  name: string;
  key: string;
  isBuiltIn: boolean;
  isEnabled: boolean;
  sortOrder: number;
}

interface Team {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  createdAt: string;
  memberCount: number;
  projectCount: number;
}

interface Member {
  membershipId: string;
  teamRole: "ADMIN" | "MEMBER";
  joinedAt: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    status: string;
    roleCode: string;
    roleName: string;
  };
}

interface Role {
  id: string;
  code: string;
  name: string;
}

interface UserOption {
  id: string;
  name: string | null;
  email: string;
}

export default function TeamDetailPage() {
  const appUser = useAppUser();
  const params = useParams() as { teamId: string };
  const teamId = params.teamId;
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("teams");

  const isSuperAdmin = appUser.specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS);

  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite form state
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteRoleId, setInviteRoleId] = useState("");
  const [inviteTeamRole, setInviteTeamRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [inviting, setInviting] = useState(false);

  // User search combobox state
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<UserOption[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserOption | null>(null);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Logo upload state
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  // Ticket types state
  const [ticketTypes, setTicketTypes] = useState<TeamTicketType[]>([]);
  const [ticketTypesLoading, setTicketTypesLoading] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [addingType, setAddingType] = useState(false);
  const [showAddTypeForm, setShowAddTypeForm] = useState(false);
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [editingTypeName, setEditingTypeName] = useState("");
  const [savingTypeId, setSavingTypeId] = useState<string | null>(null);
  const [deletingTypeId, setDeletingTypeId] = useState<string | null>(null);
  const [togglingTypeId, setTogglingTypeId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);

  // Check if current user can manage this team
  const myMembership = members.find((m) => m.user.id === appUser.id);
  const canManage = isSuperAdmin || myMembership?.teamRole === "ADMIN";

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  // After load: redirect users who have no access to this team at all.
  // App-level admins keep read access; non-members who are neither super admins
  // nor app-level admins are bounced back.
  useEffect(() => {
    if (!loading && team !== null) {
      const hasAccess = isSuperAdmin || appUser.role === "ADMIN" || !!myMembership;
      if (!hasAccess) {
        router.replace(`/${locale}/tickets`);
      }
    }
  }, [loading, team, isSuperAdmin, appUser.role, myMembership, router, locale]);

  async function loadAll() {
    setLoading(true);
    try {
      const [teamRes, membersRes, rolesRes] = await Promise.all([
        fetch(`/api/teams/${teamId}`),
        fetch(`/api/teams/${teamId}/members`),
        fetch("/api/roles"),
      ]);

      if (!teamRes.ok) {
        toast.error(t("teamNotFound"));
        router.replace(`/${locale}/admin/teams`);
        return;
      }

      const [teamData, membersData, rolesData] = await Promise.all([
        teamRes.json() as Promise<Team>,
        membersRes.ok
          ? (membersRes.json() as Promise<{ members: Member[] }>)
          : Promise.resolve({ members: [] }),
        rolesRes.ok
          ? (rolesRes.json() as Promise<{ roles: Role[] }>)
          : Promise.resolve({ roles: [] }),
      ]);

      setTeam(teamData);
      setMembers(membersData.members);
      setRoles(rolesData.roles);
      if (rolesData.roles.length > 0 && !inviteRoleId) {
        const memberRole = rolesData.roles.find((r: Role) => r.code === "MEMBER");
        const defaultRole = isSuperAdmin
          ? (memberRole ?? rolesData.roles[0])
          : (memberRole ?? rolesData.roles[0]);
        setInviteRoleId(defaultRole.id);
      }
    } catch {
      toast.error(t("loadDataFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function loadTicketTypes() {
    setTicketTypesLoading(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/ticket-types`);
      if (!res.ok) throw new Error("fetch failed");
      const data = (await res.json()) as { ticketTypes: TeamTicketType[] };
      setTicketTypes(data.ticketTypes);
    } catch {
      toast.error("Failed to load ticket types");
    } finally {
      setTicketTypesLoading(false);
    }
  }

  useEffect(() => {
    if (!loading && team) {
      void loadTicketTypes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, team?.id]);

  async function addTicketType(e: React.FormEvent) {
    e.preventDefault();
    const name = newTypeName.trim();
    if (!name) return;
    setAddingType(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/ticket-types`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Failed to add ticket type");
        return;
      }
      toast.success(`"${name}" added`);
      setNewTypeName("");
      setShowAddTypeForm(false);
      void loadTicketTypes();
    } catch {
      toast.error("Failed to add ticket type");
    } finally {
      setAddingType(false);
    }
  }

  async function saveTypeRename(typeId: string) {
    const name = editingTypeName.trim();
    if (!name) return;
    setSavingTypeId(typeId);
    try {
      const res = await fetch(`/api/teams/${teamId}/ticket-types/${typeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Failed to rename");
        return;
      }
      toast.success("Ticket type renamed");
      setEditingTypeId(null);
      void loadTicketTypes();
    } catch {
      toast.error("Failed to rename ticket type");
    } finally {
      setSavingTypeId(null);
    }
  }

  async function toggleTicketType(typeId: string, isEnabled: boolean) {
    setTogglingTypeId(typeId);
    try {
      const res = await fetch(`/api/teams/${teamId}/ticket-types/${typeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled }),
      });
      if (!res.ok) {
        toast.error("Failed to update ticket type");
        return;
      }
      setTicketTypes((prev) =>
        prev.map((tt) => (tt.id === typeId ? { ...tt, isEnabled } : tt))
      );
    } catch {
      toast.error("Failed to update ticket type");
    } finally {
      setTogglingTypeId(null);
    }
  }

  async function deleteTicketType(typeId: string, name: string) {
    if (!confirm(`Delete ticket type "${name}"? Existing tickets with this type will keep their current value.`)) return;
    setDeletingTypeId(typeId);
    try {
      const res = await fetch(`/api/teams/${teamId}/ticket-types/${typeId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Failed to delete");
        return;
      }
      toast.success(`"${name}" deleted`);
      void loadTicketTypes();
    } catch {
      toast.error("Failed to delete ticket type");
    } finally {
      setDeletingTypeId(null);
    }
  }

  async function reorderTypes(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const sorted = [...ticketTypes].sort((a, b) => a.sortOrder - b.sortOrder);
    const fromIdx = sorted.findIndex((tt) => tt.id === draggedId);
    const toIdx = sorted.findIndex((tt) => tt.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    // Reorder in-place
    const reordered = [...sorted];
    const [item] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, item);

    // Assign new sequential sortOrders
    const updated = reordered.map((tt, i) => ({ ...tt, sortOrder: i }));
    setTicketTypes(updated);

    try {
      await Promise.all(
        updated.map((tt) =>
          fetch(`/api/teams/${teamId}/ticket-types/${tt.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sortOrder: tt.sortOrder }),
          })
        )
      );
    } catch {
      toast.error("Failed to reorder");
      void loadTicketTypes();
    }
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedUser || !inviteRoleId) return;
    setInviting(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: selectedUser.email,
          roleId: inviteRoleId,
          teamRole: inviteTeamRole,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        existingUser?: boolean;
        added?: boolean;
      };
      if (!res.ok) {
        toast.error(data.error ?? t("addMemberFailed"));
        return;
      }
      const displayName = selectedUser.name ?? selectedUser.email;
      toast.success(t("addMemberSuccess", { name: displayName }));
      setSelectedUser(null);
      setUserQuery("");
      setUserResults([]);
      setShowInviteForm(false);
      void loadAll();
    } catch {
      toast.error(t("addMemberFailed"));
    } finally {
      setInviting(false);
    }
  }

  const searchUsers = useCallback(
    async (q: string) => {
      setUserSearchLoading(true);
      try {
        const res = await fetch(
          `/api/teams/${teamId}/addable-users?search=${encodeURIComponent(q)}`
        );
        if (res.ok) {
          const data = (await res.json()) as { users: UserOption[] };
          setUserResults(data.users);
        }
      } finally {
        setUserSearchLoading(false);
      }
    },
    [teamId]
  );

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced user search
  useEffect(() => {
    if (!showInviteForm) return;
    const timer = setTimeout(() => {
      void searchUsers(userQuery);
    }, 250);
    return () => clearTimeout(timer);
  }, [userQuery, showInviteForm, searchUsers]);

  async function removeMember(userId: string, name: string) {
    if (!confirm(`Remove ${name} from this team?`)) return;
    try {
      const res = await fetch(`/api/teams/${teamId}/members/${userId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? t("removeMemberFailed"));
        return;
      }
      toast.success(t("removeMemberSuccess", { name }));
      void loadAll();
    } catch {
      toast.error(t("removeMemberFailed"));
    }
  }

  async function changeRole(userId: string, teamRole: "ADMIN" | "MEMBER", name: string) {
    try {
      const res = await fetch(`/api/teams/${teamId}/members/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamRole }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? t("updateRoleFailed"));
        return;
      }
      toast.success(teamRole === "ADMIN" ? t("changeRoleSuccessAdmin", { name }) : t("changeRoleSuccessMember", { name }));
      void loadAll();
    } catch {
      toast.error(t("updateRoleFailed"));
    }
  }

  async function handleLogoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show instant preview
    const objectUrl = URL.createObjectURL(file);
    setLogoPreview(objectUrl);
    setLogoUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", "team-logos");

      const uploadRes = await fetch("/api/upload/field-media", {
        method: "POST",
        body: formData,
      });

      if (!uploadRes.ok) {
        const err = (await uploadRes.json().catch(() => ({}))) as { error?: string };
        toast.error(err.error ?? t("logoUploadFailed"));
        setLogoPreview(null);
        return;
      }

      const { storageUrl } = (await uploadRes.json()) as { storageUrl: string };

      const patchRes = await fetch(`/api/teams/${teamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoUrl: storageUrl }),
      });

      if (!patchRes.ok) {
        const err = (await patchRes.json().catch(() => ({}))) as { error?: string };
        toast.error(err.error ?? t("logoSaveFailed"));
        setLogoPreview(null);
        return;
      }

      toast.success(t("logoUpdated"));
      // Persist the final URL in the team state so the preview sticks
      setTeam((prev) => (prev ? { ...prev, logoUrl: storageUrl } : prev));
      setLogoPreview(null);
    } catch {
      toast.error(t("logoUploadFailed"));
      setLogoPreview(null);
    } finally {
      setLogoUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  }

  async function removeLogo() {
    if (!confirm("Remove the team logo?")) return;
    try {
      const res = await fetch(`/api/teams/${teamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoUrl: null }),
      });
      if (!res.ok) {
        toast.error(t("removeLogoFailed"));
        return;
      }
      toast.success(t("logoRemoved"));
      setTeam((prev) => (prev ? { ...prev, logoUrl: null } : prev));
    } catch {
      toast.error(t("removeLogoFailed"));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!team) return null;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push(`/${locale}/admin/teams`)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t("allTeams")}
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* Team logo / initials with upload overlay for admins */}
          <div className="group relative">
            {logoPreview ?? team.logoUrl ? (
              <Image
                src={logoPreview ?? team.logoUrl ?? ""}
                alt={team.name}
                width={40}
                height={40}
                className="size-10 rounded-lg object-cover"
                unoptimized
              />
            ) : (
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
                {team.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            {canManage && (
              <>
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={logoUploading}
                  title={t("changeLogo")}
                  className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 disabled:cursor-not-allowed"
                >
                  {logoUploading ? (
                    <Loader2 className="size-4 animate-spin text-white" />
                  ) : (
                    <Upload className="size-4 text-white" />
                  )}
                </button>
                {team.logoUrl && !logoUploading && (
                  <button
                    type="button"
                    onClick={() => void removeLogo()}
                    title={t("removeLogo")}
                    className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                )}
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handleLogoFileChange(e)}
                />
              </>
            )}
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">{team.name}</h1>
            <p className="text-xs text-muted-foreground">
              {t("memberCount", { count: members.length })} · {t("projectCount", { count: team.projectCount })}
            </p>
          </div>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => {
              setShowInviteForm((v) => {
                if (v) {
                  setSelectedUser(null);
                  setUserQuery("");
                  setUserResults([]);
                }
                return !v;
              });
            }}
            className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <UserPlus className="size-4" />
            {t("addMember")}
          </button>
        )}
      </div>

      {/* Invite form */}
      {showInviteForm && canManage && (
        <form
          onSubmit={sendInvite}
          className="mt-6 flex flex-col gap-4 rounded-lg border border-border bg-card p-5"
        >
          <h2 className="text-sm font-semibold text-foreground">{t("addMemberTo", { name: team.name })}</h2>

          {/* User search combobox */}
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">{t("userLabel")}</span>
            <div ref={searchRef} className="relative">
              {selectedUser ? (
                <div className="flex items-center justify-between rounded-sm border border-border bg-card px-3 py-2">
                  <span className="flex items-center gap-2 text-sm">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-bold text-neutral-600">
                      {(selectedUser.name ?? selectedUser.email)[0]?.toUpperCase() ?? "?"}
                    </span>
                    <span className="font-medium text-foreground">
                      {selectedUser.name ?? selectedUser.email}
                    </span>
                    <span className="text-muted-foreground">{selectedUser.email}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedUser(null);
                      setUserQuery("");
                      setUserResults([]);
                      setTimeout(() => searchInputRef.current?.focus(), 0);
                    }}
                    className="ml-2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    ref={searchInputRef}
                    autoFocus
                    type="text"
                    value={userQuery}
                    onChange={(e) => {
                      setUserQuery(e.target.value);
                      setShowDropdown(true);
                    }}
                    onFocus={() => setShowDropdown(true)}
                    placeholder={t("searchPlaceholder")}
                    className="w-full rounded-sm border border-border bg-card py-2 pl-9 pr-3 text-sm"
                  />
                  {userSearchLoading && (
                    <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  )}
                </div>
              )}

              {/* Dropdown results */}
              {!selectedUser && showDropdown && userResults.length > 0 && (
                <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-card shadow-lg">
                  {userResults.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setSelectedUser(u);
                          setShowDropdown(false);
                        }}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-neutral-100"
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-bold text-neutral-600">
                          {(u.name ?? u.email)[0]?.toUpperCase() ?? "?"}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">
                            {u.name ?? u.email}
                          </span>
                          {u.name && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {u.email}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!selectedUser && showDropdown && !userSearchLoading && userResults.length === 0 && userQuery.length > 0 && (
                <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-card px-3 py-3 text-sm text-muted-foreground shadow-lg">
                  {t("noUsersFound", { query: userQuery })}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <label className="flex-1 text-sm font-medium text-foreground">
              {t("appRoleLabel")}
              {isSuperAdmin ? (
                <select
                  value={inviteRoleId}
                  onChange={(e) => setInviteRoleId(e.target.value)}
                  className="mt-1 w-full rounded-sm border border-border bg-card px-3 py-2 text-sm"
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={inviteRoleId}
                  disabled
                  className="mt-1 w-full rounded-sm border border-border bg-muted px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
                >
                  {roles
                    .filter((r) => r.code === "MEMBER")
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              )}
            </label>
            <label className="flex-1 text-sm font-medium text-foreground">
              {t("teamRoleLabel")}
              {isSuperAdmin ? (
                <select
                  value={inviteTeamRole}
                  onChange={(e) => setInviteTeamRole(e.target.value as "ADMIN" | "MEMBER")}
                  className="mt-1 w-full rounded-sm border border-border bg-card px-3 py-2 text-sm"
                >
                  <option value="MEMBER">{t("roleLabelMember")}</option>
                  <option value="ADMIN">{t("roleLabelAdmin")}</option>
                </select>
              ) : (
                <select
                  value="MEMBER"
                  disabled
                  className="mt-1 w-full rounded-sm border border-border bg-muted px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
                >
                  <option value="MEMBER">{t("roleLabelMember")}</option>
                </select>
              )}
            </label>
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={inviting || !selectedUser}
              className="inline-flex h-9 items-center gap-2 rounded-sm bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {inviting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <UserPlus className="size-4" />
                  {t("addMember")}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowInviteForm(false);
                setSelectedUser(null);
                setUserQuery("");
                setUserResults([]);
              }}
              className="inline-flex h-9 items-center rounded-sm border border-border px-4 text-sm font-medium text-muted-foreground hover:bg-neutral-100"
            >
              {t("cancel")}
            </button>
          </div>
        </form>
      )}

      {/* Members list */}
      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("members")}
        </h2>
        {members.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("noMembers")}</p>
        ) : (
          <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {members.map((m) => {
              const displayName = m.user.name?.trim() || m.user.email;
              return (
                <div key={m.membershipId} className="flex items-center gap-4 px-5 py-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-bold text-neutral-600">
                    {displayName[0]?.toUpperCase() ?? "?"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {displayName}
                      </span>
                      {m.teamRole === "ADMIN" && (
                        <span className="flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          <Crown className="size-3" />
                          {t("roleLabelAdmin")}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{m.user.email}</span>
                  </div>
                  {canManage && m.user.id !== appUser.id && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="flex size-8 items-center justify-center rounded-sm hover:bg-neutral-100"
                        >
                          <MoreVertical className="size-4 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {m.teamRole === "MEMBER" ? (
                          <DropdownMenuItem
                            onSelect={() => void changeRole(m.user.id, "ADMIN", displayName)}
                          >
                            <Crown className="size-4" />
                            {t("makeTeamAdmin")}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onSelect={() => void changeRole(m.user.id, "MEMBER", displayName)}
                          >
                            <Shield className="size-4" />
                            {t("demoteToMember")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => void removeMember(m.user.id, displayName)}
                        >
                          <UserMinus className="size-4" />
                          {t("removeMember")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Ticket Types section */}
      <div className="mt-10">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Ticket Types
          </h2>
          {canManage && (
            <button
              type="button"
              onClick={() => {
                setShowAddTypeForm((v) => !v);
                setNewTypeName("");
              }}
              className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-neutral-100"
            >
              <Plus className="size-3.5" />
              Add type
            </button>
          )}
        </div>

        {showAddTypeForm && canManage && (
          <form
            onSubmit={addTicketType}
            className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3"
          >
            <Tag className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              type="text"
              value={newTypeName}
              onChange={(e) => setNewTypeName(e.target.value)}
              placeholder="Type name (e.g. Performance Issue)"
              maxLength={60}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={addingType || !newTypeName.trim()}
              className="inline-flex h-7 items-center gap-1.5 rounded-sm bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {addingType ? <Loader2 className="size-3.5 animate-spin" /> : "Add"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddTypeForm(false);
                setNewTypeName("");
              }}
              className="inline-flex h-7 items-center rounded-sm border border-border px-3 text-xs text-muted-foreground hover:bg-neutral-100"
            >
              Cancel
            </button>
          </form>
        )}

        {ticketTypesLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : ticketTypes.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No ticket types configured.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {ticketTypes
              .slice()
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((tt) => (
                <div
                  key={tt.id}
                  draggable={canManage}
                  onDragStart={() => { dragIdRef.current = tt.id; }}
                  onDragEnd={() => { dragIdRef.current = null; setDragOverId(null); }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverId(tt.id); }}
                  onDragLeave={() => setDragOverId(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIdRef.current) void reorderTypes(dragIdRef.current, tt.id);
                    setDragOverId(null);
                  }}
                  className={[
                    "flex items-center gap-3 px-4 py-3 transition-colors",
                    !tt.isEnabled ? "opacity-50" : "",
                    dragOverId === tt.id && dragIdRef.current !== tt.id
                      ? "bg-primary/5 ring-1 ring-inset ring-primary/30"
                      : "",
                    canManage ? "cursor-default" : "",
                  ].filter(Boolean).join(" ")}
                >
                  {canManage && (
                    <GripVertical className="size-4 shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/50" aria-hidden />
                  )}

                  <div className="min-w-0 flex-1">
                    {editingTypeId === tt.id && canManage ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void saveTypeRename(tt.id);
                        }}
                        className="flex items-center gap-2"
                      >
                        <input
                          autoFocus
                          type="text"
                          value={editingTypeName}
                          onChange={(e) => setEditingTypeName(e.target.value)}
                          maxLength={60}
                          className="min-w-0 flex-1 rounded border border-border bg-card px-2 py-1 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
                        />
                        <button
                          type="submit"
                          disabled={savingTypeId === tt.id || !editingTypeName.trim()}
                          className="inline-flex h-7 items-center gap-1 rounded-sm bg-primary px-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                        >
                          {savingTypeId === tt.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            "Save"
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTypeId(null)}
                          className="inline-flex h-7 items-center rounded-sm border border-border px-2.5 text-xs text-muted-foreground hover:bg-neutral-100"
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{tt.name}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {tt.key}
                        </span>
                        {tt.isBuiltIn && (
                          <span className="flex items-center gap-0.5 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500">
                            <Lock className="size-2.5" />
                            Built-in
                          </span>
                        )}
                        {!tt.isEnabled && (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            Disabled
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {canManage && editingTypeId !== tt.id && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTypeId(tt.id);
                          setEditingTypeName(tt.name);
                        }}
                        title="Rename"
                        className="flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-neutral-100 hover:text-foreground"
                      >
                        <Pencil className="size-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => void toggleTicketType(tt.id, !tt.isEnabled)}
                        disabled={togglingTypeId === tt.id}
                        title={tt.isEnabled ? "Disable" : "Enable"}
                        className="rounded-sm border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-neutral-100 disabled:opacity-50"
                      >
                        {togglingTypeId === tt.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : tt.isEnabled ? (
                          "Disable"
                        ) : (
                          "Enable"
                        )}
                      </button>

                      {!tt.isBuiltIn && (
                        <button
                          type="button"
                          onClick={() => void deleteTicketType(tt.id, tt.name)}
                          disabled={deletingTypeId === tt.id}
                          title="Delete"
                          className="flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                        >
                          {deletingTypeId === tt.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
