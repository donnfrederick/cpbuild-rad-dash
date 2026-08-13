import { AuthenticatedShell } from "@/components/layout/AuthenticatedShell";
import { shouldShowLocalDevToolsTabs } from "@/lib/devtools-env";
import { getGoogleGenerativeAiApiKey } from "@/lib/google-generative-ai";

/**
 * Route group layout for all authenticated app pages (tickets, users, settings).
 * DashboardShell lives here so it persists across navigations — only the
 * children slot (content area) changes when the route changes.
 *
 * Runs on the server so we can gate server-only features (like the AI agent
 * and Gemini-backed tooling) before ever rendering their client UI.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const agentEnabled = Boolean(getGoogleGenerativeAiApiKey());
  const showLocalDevToolsTabs = shouldShowLocalDevToolsTabs();

  return (
    <AuthenticatedShell
      agentEnabled={agentEnabled}
      showLocalDevToolsTabs={showLocalDevToolsTabs}
    >
      {children}
    </AuthenticatedShell>
  );
}
