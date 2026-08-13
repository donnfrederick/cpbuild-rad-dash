import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import NextAuth from "next-auth";
import createMiddleware from "next-intl/middleware";
import { authConfig } from "@/lib/auth.config";
import { routing } from "./i18n/routing";

const PUBLIC_PATHS = ["/login", "/invite/accept"];
const AUTH_API_PREFIX = "/api/auth";

const intlMiddleware = createMiddleware(routing);
const { auth } = NextAuth(authConfig);

export default auth(async (request) => {
  const intlResponse = await intlMiddleware(request);
  const { pathname } = request.nextUrl;

  if (pathname.startsWith(AUTH_API_PREFIX)) {
    return intlResponse;
  }
  if (process.env.DEV_BYPASS_AUTH === "true") {
    return intlResponse;
  }

  const pathWithoutLocale = pathname.replace(/^\/[a-z]{2}(\/|$)/, "$1") || "/";
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathWithoutLocale === p || pathWithoutLocale.startsWith(p + "/")
  );
  if (isPublic) {
    return intlResponse;
  }

  if (!request.auth) {
    const locale = pathname.match(/^\/([a-z]{2})\b/)?.[1] ?? routing.defaultLocale;
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return intlResponse;
});

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
