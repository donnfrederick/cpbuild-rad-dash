"use client";

import { NextIntlClientProvider, useLocale } from "next-intl";
import { hasLocale } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useLayoutEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { routing } from "@/i18n/routing";
import { SessionProvider } from "@/components/providers/SessionProvider";

function DocumentLangSync() {
  const locale = useLocale();
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return null;
}

export function ClientLocaleRoot({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const raw = params?.locale;
  const locale =
    typeof raw === "string" && hasLocale(routing.locales, raw)
      ? raw
      : routing.defaultLocale;

  const [messages, setMessages] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loaders: Record<
      string,
      () => Promise<{ default: Record<string, unknown> }>
    > = {
      en: () => import("@/messages/en.json"),
      es: () => import("@/messages/es.json"),
    };
    const load = loaders[locale] ?? loaders[routing.defaultLocale];
    void load().then((m) => {
      if (!cancelled) setMessages(m.default);
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  if (messages === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <DocumentLangSync />
      <SessionProvider>{children}</SessionProvider>
    </NextIntlClientProvider>
  );
}
