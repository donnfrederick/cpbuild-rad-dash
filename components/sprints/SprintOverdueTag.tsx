"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface SprintOverdueTagProps {
  className?: string;
}

export function SprintOverdueTag({ className }: SprintOverdueTagProps): React.ReactElement {
  const t = useTranslations("sprints");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200",
        className
      )}
      aria-label={t("overdueTagAria")}
    >
      {t("overdueTag")}
    </span>
  );
}
