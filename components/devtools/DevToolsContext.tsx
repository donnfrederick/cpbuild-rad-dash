"use client";

/**
 * DevToolsContext — shared state for Error Wrap-Up aggregation.
 * Debugger, ServerLogs, TestRunner, TestPlan can register their data.
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export interface LogEntry {
  id: number;
  timestamp: string;
  level: string;
  message: string;
}

export interface FrontendIssue {
  id: number;
  timestamp: string;
  severity: string;
  category: string;
  message: string;
  detail?: string;
  url?: string;
  status?: number;
}

export interface DiagFailure {
  group: string;
  name: string;
  detail: string;
  status: string;
}

export interface TestPlanGap {
  sourceFile: string;
  status: string;
  linesPct: number;
  testFile: string | null;
  suggestedTestPath: string;
}

export interface TestRunFailure {
  suite: string;
  failed: number;
  passed: number;
  output: string[];
}

interface DevToolsData {
  debuggerIssues: FrontendIssue[];
  debuggerDiagFailures: DiagFailure[];
  serverLogEntries: LogEntry[];
  serverLogErrorsWarnings: LogEntry[];
  testPlanGaps: TestPlanGap[];
  testRunFailure: TestRunFailure | null;
}

interface DevToolsContextValue extends DevToolsData {
  setDebuggerData: (issues: FrontendIssue[], diagFailures: DiagFailure[]) => void;
  setServerLogEntries: (entries: LogEntry[]) => void;
  setTestPlanGaps: (gaps: TestPlanGap[]) => void;
  setTestRunFailure: (result: TestRunFailure | null) => void;
}

const initial: DevToolsData = {
  debuggerIssues: [],
  debuggerDiagFailures: [],
  serverLogEntries: [],
  serverLogErrorsWarnings: [],
  testPlanGaps: [],
  testRunFailure: null,
};

const DevToolsContext = createContext<DevToolsContextValue | null>(null);

export function DevToolsProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DevToolsData>(initial);

  const setDebuggerData = useCallback((issues: FrontendIssue[], diagFailures: DiagFailure[]) => {
    setData((prev) => ({ ...prev, debuggerIssues: issues, debuggerDiagFailures: diagFailures }));
  }, []);

  const setServerLogEntries = useCallback((entries: LogEntry[]) => {
    const errorsWarnings = entries.filter((e) => e.level === "error" || e.level === "warn");
    setData((prev) => ({ ...prev, serverLogEntries: entries, serverLogErrorsWarnings: errorsWarnings }));
  }, []);

  const setTestPlanGaps = useCallback((gaps: TestPlanGap[]) => {
    setData((prev) => ({ ...prev, testPlanGaps: gaps }));
  }, []);

  const setTestRunFailure = useCallback((result: TestRunFailure | null) => {
    setData((prev) => ({ ...prev, testRunFailure: result }));
  }, []);

  const value: DevToolsContextValue = {
    ...data,
    setDebuggerData,
    setServerLogEntries,
    setTestPlanGaps,
    setTestRunFailure,
  };

  return <DevToolsContext.Provider value={value}>{children}</DevToolsContext.Provider>;
}

export function useDevToolsContext() {
  const ctx = useContext(DevToolsContext);
  return ctx;
}
