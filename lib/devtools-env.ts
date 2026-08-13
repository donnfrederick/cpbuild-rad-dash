/**
 * Helpers for DevTools routes.
 * DevTools are allowed when:
 *   - NODE_ENV !== "production" (local dev), OR
 *   - APP_ENV === "dev", "development", or "staging", OR
 *   - RAILWAY_ENVIRONMENT_NAME === "dev", "development", or "staging" (Railway auto-injected), OR
 *   - RAILWAY_GIT_BRANCH === "dev" (deploying from dev branch), OR
 *   - DEVTOOLS_ENABLED === "true" (explicit opt-in for production admin use)
 *
 * Raw SQL WHERE filtering (rawWhere param) is NEVER allowed in production,
 * even if DEVTOOLS_ENABLED=true. It is explicitly blocked by isRawSqlAllowed().
 */
const DEV_LIKE = ["dev", "development", "staging"];

function isDevLike(value: string | undefined): boolean {
  if (!value) return false;
  return DEV_LIKE.includes(value.toLowerCase());
}

export function isDevToolsAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (isDevLike(process.env.APP_ENV)) return true;
  if (isDevLike(process.env.RAILWAY_ENVIRONMENT_NAME)) return true;
  if (process.env.RAILWAY_GIT_BRANCH?.toLowerCase() === "dev") return true;
  if (process.env.DEVTOOLS_ENABLED === "true") return true;
  return false;
}

/**
 * Whether Design System / Test Plan / Test Runner tabs are shown.
 * Local `npm run dev` always qualifies. Hosted builds hide them unless
 * NEXT_PUBLIC_APP_ENV is unset (legacy prod behaviour) or DEVTOOLS_ENABLED=true.
 */
export function shouldShowLocalDevToolsTabs(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.DEVTOOLS_ENABLED === "true") return true;
  if (!process.env.NEXT_PUBLIC_APP_ENV?.trim()) return true;
  return false;
}

/**
 * Raw SQL WHERE filtering is only allowed in non-production environments.
 * DEVTOOLS_ENABLED=true does NOT unlock this — it is hard-blocked in prod
 * to prevent data extraction via SQL injection patterns.
 */
export function isRawSqlAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (isDevLike(process.env.APP_ENV)) return true;
  if (isDevLike(process.env.RAILWAY_ENVIRONMENT_NAME)) return true;
  if (process.env.RAILWAY_GIT_BRANCH?.toLowerCase() === "dev") return true;
  // Intentionally NOT checking DEVTOOLS_ENABLED — raw SQL is never prod-safe.
  return false;
}

/** Message shown when DevTools are blocked (e.g. in production). */
export const DEVTOOLS_BLOCKED_MESSAGE =
  "DevTools are only available when NODE_ENV!=='production', APP_ENV is 'dev'/'development'/'staging', RAILWAY_ENVIRONMENT_NAME is 'dev'/'development'/'staging', RAILWAY_GIT_BRANCH is 'dev', or DEVTOOLS_ENABLED=true.";
