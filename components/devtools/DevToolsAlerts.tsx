"use client";

/**
 * DevToolsAlerts
 *
 * Listens for devtools:new-error and devtools:test-failed events.
 * Shows toast notifications so issues are visible even when the DevTools panel is closed.
 *
 * Dev-only — rendered alongside DevToolsPanel.
 */

import { useEffect } from "react";
import { toast } from "sonner";

export function DevToolsAlerts() {
  useEffect(() => {
    const onError = (e: Event) => {
      const detail = (e as CustomEvent<{ count?: number; message?: string; tab?: string }>).detail ?? {};
      const msg = detail.message ?? "Issue detected";
      const tabHint = detail.tab === "server-logs" ? "Server Logs" : detail.tab === "debugger" ? "Debugger" : detail.tab === "test-runner" ? "Test Runner" : "DevTools";
      toast.error(msg.length > 80 ? `${msg.slice(0, 80)}…` : msg, {
        duration: 6000,
        description: `Open DevTools → ${tabHint} for details`,
      });
    };

    const onTestFailed = (e: Event) => {
      const detail = (e as CustomEvent<{ failed: number; passed: number; suite: string }>).detail ?? {};
      const { failed = 0, passed = 0 } = detail;
      toast.error(`Tests failed: ${failed} failed, ${passed} passed`, {
        duration: 8000,
        description: `Open DevTools → Test Runner for details`,
      });
    };

    window.addEventListener("devtools:new-error", onError);
    window.addEventListener("devtools:test-failed", onTestFailed);
    return () => {
      window.removeEventListener("devtools:new-error", onError);
      window.removeEventListener("devtools:test-failed", onTestFailed);
    };
  }, []);

  return null;
}
