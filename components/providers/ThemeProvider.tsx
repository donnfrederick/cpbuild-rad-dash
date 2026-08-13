"use client";

/**
 * Script-free theme provider (matches command-center-reboot).
 * Syncs from localStorage in useLayoutEffect before paint.
 */

import * as React from "react";

const MEDIA = "(prefers-color-scheme: dark)";

export type ThemeProviderProps = {
  children: React.ReactNode;
  attribute?: "class";
  defaultTheme?: string;
  enableSystem?: boolean;
  enableColorScheme?: boolean;
  disableTransitionOnChange?: boolean;
  storageKey?: string;
  forcedTheme?: string;
};

type ThemeContextValue = {
  theme: string | undefined;
  setTheme: React.Dispatch<React.SetStateAction<string>>;
  forcedTheme?: string;
  resolvedTheme?: string;
  themes: string[];
  systemTheme?: "dark" | "light";
};

const DEFAULT_THEMES = ["light", "dark"] as const;

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined);

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia(MEDIA).matches ? "dark" : "light";
}

function resolveTheme(
  theme: string,
  forcedTheme: string | undefined
): "light" | "dark" {
  if (forcedTheme === "light" || forcedTheme === "dark") return forcedTheme;
  if (theme === "system") return getSystemTheme();
  return theme === "dark" ? "dark" : "light";
}

function isStoredTheme(s: string | null): s is "light" | "dark" | "system" {
  return s === "light" || s === "dark" || s === "system";
}

function disableTransitions(): () => void {
  const css = document.createElement("style");
  css.appendChild(
    document.createTextNode(
      "*,*::before,*::after{-webkit-transition:none!important;-moz-transition:none!important;transition:none!important}"
    )
  );
  document.head.appendChild(css);
  return () => {
    window.getComputedStyle(document.body);
    setTimeout(() => {
      document.head.removeChild(css);
    }, 1);
  };
}

function applyResolved(
  resolved: "light" | "dark",
  opts: { enableColorScheme: boolean; disableTransitionOnChange: boolean }
): void {
  const root = document.documentElement;
  const finishTransition = opts.disableTransitionOnChange ? disableTransitions() : null;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  if (opts.enableColorScheme) {
    root.style.colorScheme = resolved;
  }
  finishTransition?.();
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    return {
      theme: undefined,
      setTheme: () => {},
      resolvedTheme: undefined,
      themes: [],
    };
  }
  return ctx;
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  enableSystem = true,
  enableColorScheme = true,
  disableTransitionOnChange = false,
  storageKey = "theme",
  forcedTheme,
}: ThemeProviderProps) {
  const [theme, setTheme] = React.useState(defaultTheme);
  const [systemTick, setSystemTick] = React.useState(0);
  const hydratedRef = React.useRef(false);

  const themes = React.useMemo(
    () => (enableSystem ? [...DEFAULT_THEMES, "system"] : [...DEFAULT_THEMES]),
    [enableSystem]
  );

  const resolvedTheme = React.useMemo(() => {
    void systemTick;
    return resolveTheme(theme, forcedTheme);
  }, [theme, forcedTheme, systemTick]);

  React.useLayoutEffect(() => {
    let active = theme;
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      try {
        const stored = localStorage.getItem(storageKey);
        if (isStoredTheme(stored)) {
          active = stored;
          if (stored !== theme) setTheme(stored);
        }
      } catch {
        /* ignore */
      }
    }
    const resolved = resolveTheme(active, forcedTheme);
    applyResolved(resolved, {
      enableColorScheme,
      disableTransitionOnChange,
    });
  }, [
    theme,
    forcedTheme,
    storageKey,
    enableColorScheme,
    disableTransitionOnChange,
    systemTick,
  ]);

  React.useEffect(() => {
    if (!enableSystem) return;
    const mq = window.matchMedia(MEDIA);
    const onChange = () => setSystemTick((n) => n + 1);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [enableSystem]);

  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey || e.newValue == null) return;
      if (isStoredTheme(e.newValue)) setTheme(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);

  const setThemePersist = React.useCallback(
    (value: React.SetStateAction<string>) => {
      setTheme((prev) => {
        const next = typeof value === "function" ? (value as (p: string) => string)(prev) : value;
        try {
          localStorage.setItem(storageKey, next);
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [storageKey]
  );

  const value = React.useMemo(() => {
    void systemTick;
    return {
      theme,
      forcedTheme,
      setTheme: setThemePersist,
      resolvedTheme,
      themes,
      systemTheme: enableSystem ? getSystemTheme() : undefined,
    };
  }, [theme, forcedTheme, setThemePersist, resolvedTheme, themes, enableSystem, systemTick]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
