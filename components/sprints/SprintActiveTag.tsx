"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface SprintActiveTagProps {
  className?: string;
}

/** Pill label for a sprint whose planning dates include today (local calendar). */
export function SprintActiveTag({ className }: SprintActiveTagProps): React.ReactElement {
  const t = useTranslations("sprints");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-primary/35 bg-primary/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary",
        className
      )}
      aria-label={t("activeTagAria")}
    >
      {t("activeTag")}
    </span>
  );
}
