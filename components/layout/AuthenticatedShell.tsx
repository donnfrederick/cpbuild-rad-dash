"use client";

import { DashboardShell } from "@/components/layout/DashboardShell";
import { FeedbackButton } from "@/components/feedback/FeedbackButton";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { AuthenticatedPageLoader } from "@/components/layout/AuthenticatedPageLoader";
import { useRedirectUnauthenticated } from "@/hooks/useRedirectUnauthenticated";
import { AppUserProvider } from "@/contexts/AppUserContext";
import { CurrentTeamProvider } from "@/contexts/CurrentTeamContext";
import { PageHeaderProvider } from "@/contexts/PageHeaderContext";
import { DevToolsPanelWrapper } from "@/components/devtools/DevToolsPanelWrapper";
import { AgentWidget } from "@/components/agent/AgentWidget";
import { ScreenRecordingProvider } from "@/components/tickets/ScreenRecordingProvider";
import { hasPermission, PERMISSIONS } from "@/lib/permissions-core";

/**
 * Persistent shell rendered once at the (app) route group layout level.
 * Handles the auth check and renders DashboardShell + sidebar exactly once —
 * children (page content) swap without the shell unmounting.
 */
export function AuthenticatedShell({
  children,
  agentEnabled = false,
  showLocalDevToolsTabs = false,
}: {
  children: React.ReactNode;
  agentEnabled?: boolean;
  showLocalDevToolsTabs?: boolean;
}): React.ReactElement | null {
  const me = useRedirectUnauthenticated();

  if (me.status === "loading") {
    return <AuthenticatedPageLoader />;
  }
  if (me.status === "unauthorized") {
    return null;
  }

  return (
    <AppUserProvider user={me.user}>
      <CurrentTeamProvider
        teamMemberships={me.user.teamMemberships}
        specialPermissions={me.user.specialPermissions}
      >
        <ScreenRecordingProvider>
          <PageHeaderProvider>
            <DashboardShell
              user={{
                id: me.user.id,
                email: me.user.email,
                name: me.user.name,
                role: me.user.role,
                specialPermissions: me.user.specialPermissions,
                teamMemberships: me.user.teamMemberships,
              }}
              headerActions={
                <>
                  <FeedbackButton variant="inline" theme="light" />
                  <NotificationBell />
                </>
              }
            >
              {children}
            </DashboardShell>
            <DevToolsPanelWrapper
              canUseDevTools={hasPermission(me.user.role, PERMISSIONS.ACCESS_DEVTOOLS)}
              appEnv={process.env.NEXT_PUBLIC_APP_ENV}
              showLocalDevToolsTabs={showLocalDevToolsTabs}
            />
            {agentEnabled && <AgentWidget />}
          </PageHeaderProvider>
        </ScreenRecordingProvider>
      </CurrentTeamProvider>
    </AppUserProvider>
  );
}
