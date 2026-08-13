import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// Prefer NEXT_PUBLIC_APP_COMMIT if already injected into the build env
// (e.g. set on Railway before `railway up`), otherwise derive from the
// CI/platform SHA env vars. Falls back to "local" for local dev.
const existingCommit = process.env.NEXT_PUBLIC_APP_COMMIT?.trim();
const gitSha =
  process.env.GITHUB_SHA?.trim() ||
  process.env.RAILWAY_GIT_COMMIT_SHA?.trim() ||
  "";
const appCommitShort =
  existingCommit || (gitSha.length > 0 ? gitSha.slice(0, 7) : "local");
const appVersion =
  process.env.NEXT_PUBLIC_APP_VERSION?.trim() ||
  process.env.npm_package_version ||
  "0.0.0";

/** App UI routes use `next/dynamic(..., { ssr: false })` so page modules render on the client only. API routes and auth stay on the server. */
const nextConfig: NextConfig = {
  /** Ensure Vercel AI SDK packages are bundled (avoids resolve issues in some Webpack setups). */
  transpilePackages: ["@ai-sdk/react", "ai"],
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_APP_COMMIT: appCommitShort,
    NEXT_PUBLIC_APP_BUILD_TIME: new Date().toISOString(),
  },
};

export default withNextIntl(nextConfig);
