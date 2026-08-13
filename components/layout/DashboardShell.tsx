"use client";

import type { ReactNode } from "react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { usePageHeader } from "@/contexts/PageHeaderContext";
import type { TeamMembershipInfo } from "@/hooks/useMe";

export interface DashboardShellUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  specialPermissions: string[];
  teamMemberships: TeamMembershipInfo[];
}

interface DashboardShellProps {
  children: ReactNode;
  user: DashboardShellUser;
  headerActions?: ReactNode;
}

export function DashboardShell({
  children,
  user,
  headerActions,
}: DashboardShellProps) {
  const { leading } = usePageHeader();

  return (
    <div className="flex h-dvh min-h-0 w-full bg-background">
      <AppSidebar user={user} />
      <div className="flex min-w-0 min-h-0 flex-1 flex-col bg-background">
        {headerActions != null && (
          <header
            className={`flex shrink-0 items-center gap-2 border-b border-border bg-card sm:gap-3 ${
              leading ? "justify-between" : "justify-end"
            }`}
            style={{
              paddingLeft: "var(--page-padding-x)",
              paddingRight: "var(--page-padding-x)",
              minHeight: "var(--top-bar-height)",
            }}
          >
            {leading ? (
              <div className="min-w-0 flex-1 overflow-hidden py-1">{leading}</div>
            ) : null}
            <div className="flex shrink-0 items-center justify-end gap-1 sm:gap-2">{headerActions}</div>
          </header>
        )}
        <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-background">{children}</div>
      </div>
    </div>
  );
}
