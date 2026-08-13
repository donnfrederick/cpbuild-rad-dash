"use client";

/**
 * Client-only wrapper to avoid hydration mismatch.
 * Visible to any role with ACCESS_DEVTOOLS (ADMIN by default).
 */
import { useSyncExternalStore } from "react";
import { DevToolsPanel } from "./DevToolsPanel";
import { DevToolsAlerts } from "./DevToolsAlerts";

// subscribe is a no-op: mounted never changes after initial render
function subscribe() {
  return () => {};
}

interface Props {
  /** When true, render the dev tray. True for any role with ACCESS_DEVTOOLS. */
  canUseDevTools?: boolean;
  /** Client-readable environment label (e.g. "development", "production"). */
  appEnv?: string;
  /** When true, show Design System / Test Plan / Test Runner tabs. */
  showLocalDevToolsTabs?: boolean;
}

export function DevToolsPanelWrapper({
  canUseDevTools = false,
  appEnv,
  showLocalDevToolsTabs = false,
}: Props) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

  const shouldShow = mounted && canUseDevTools;

  if (!shouldShow) return null;

  return (
    <>
      <DevToolsPanel appEnv={appEnv} showLocalDevToolsTabs={showLocalDevToolsTabs} />
      <DevToolsAlerts />
    </>
  );
}
