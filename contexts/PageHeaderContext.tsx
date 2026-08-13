"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

interface PageHeaderContextValue {
  leading: React.ReactNode | null;
  setLeading: (node: React.ReactNode | null) => void;
}

const PageHeaderContext = createContext<PageHeaderContextValue | null>(null);

/** For components that may render outside the app shell (e.g. tests). */
export function useOptionalPageHeader(): PageHeaderContextValue | null {
  return useContext(PageHeaderContext);
}

export function PageHeaderProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [leading, setLeadingState] = useState<React.ReactNode | null>(null);

  const setLeading = useCallback((node: React.ReactNode | null) => {
    setLeadingState(node);
  }, []);

  const value = useMemo(() => ({ leading, setLeading }), [leading, setLeading]);

  return <PageHeaderContext.Provider value={value}>{children}</PageHeaderContext.Provider>;
}

export function usePageHeader(): PageHeaderContextValue {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) {
    throw new Error("usePageHeader must be used within PageHeaderProvider");
  }
  return ctx;
}
