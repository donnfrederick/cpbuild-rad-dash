"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface SprintCompletedTagProps {
  className?: string;
}

export function SprintCompletedTag({ className }: SprintCompletedTagProps): React.ReactElement {
  const t = useTranslations("sprints");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-muted-foreground/35 bg-muted/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground",
        className
      )}
      aria-label={t("completedTagAria")}
    >
      {t("completedTag")}
    </span>
  );
}
