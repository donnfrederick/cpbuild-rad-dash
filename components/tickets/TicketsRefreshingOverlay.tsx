"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

/** Semi-transparent overlay while ticket list data soft-refreshes. */
export function TicketsRefreshingOverlay(): React.ReactElement {
  const tc = useTranslations("common");

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[280] flex items-center justify-center bg-background/45"
      aria-live="polite"
      aria-busy="true"
      aria-label={tc("loading")}
    >
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
    </div>
  );
}
