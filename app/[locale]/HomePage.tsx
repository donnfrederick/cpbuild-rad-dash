"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";

export default function HomePage(): React.ReactElement {
  const params = useParams();
  const router = useRouter();
  const raw = params?.locale;
  const locale =
    typeof raw === "string" && hasLocale(routing.locales, raw)
      ? raw
      : routing.defaultLocale;

  useEffect(() => {
    router.replace(`/${locale}/tickets`);
  }, [locale, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
    </div>
  );
}
