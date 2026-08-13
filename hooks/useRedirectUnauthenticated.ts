"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useMe, type UseMeState } from "@/hooks/useMe";

/** When `/api/me` returns 401, send the user to localized login with `callbackUrl`. */
export function useRedirectUnauthenticated(): UseMeState {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();

  useEffect(() => {
    if (me.status !== "unauthorized") return;
    router.replace(
      `/${locale}/login?callbackUrl=${encodeURIComponent(pathname)}`
    );
  }, [me.status, locale, pathname, router]);

  return me;
}
