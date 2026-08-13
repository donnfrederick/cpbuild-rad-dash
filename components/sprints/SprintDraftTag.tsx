"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface SprintDraftTagProps {
  className?: string;
}

export function SprintDraftTag({ className }: SprintDraftTagProps): React.ReactElement {
  const t = useTranslations("sprints");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-sky-500/35 bg-sky-500/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300",
        className
      )}
      aria-label={t("draftTagAria")}
    >
      {t("draftTag")}
    </span>
  );
}
