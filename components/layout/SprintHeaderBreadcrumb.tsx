"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { usePageHeader } from "@/contexts/PageHeaderContext";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb";

type SprintSubPath = "overview" | "tickets" | "report" | "sprint-root";

function parseSprintContentPath(pathname: string, sprintId: string): SprintSubPath | null {
  const prefix = `/sprints/${sprintId}`;
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  if (pathname === prefix || pathname === `${prefix}/`) {
    return "sprint-root";
  }
  if (pathname === `${prefix}/overview`) {
    return "overview";
  }
  if (pathname === `${prefix}/report`) {
    return "report";
  }
  if (pathname === `${prefix}/tickets` || pathname.startsWith(`${prefix}/tickets/`)) {
    return "tickets";
  }
  return null;
}

export function SprintHeaderBreadcrumb({ sprintId }: { sprintId: string }): null {
  const pathname = usePathname();
  const { setLeading } = usePageHeader();
  const tNav = useTranslations("nav");
  const tSprints = useTranslations("sprints");

  const contentPath = useMemo(() => parseSprintContentPath(pathname, sprintId), [pathname, sprintId]);

  const [sprintName, setSprintName] = useState<string>("");
  const [sprintCompleted, setSprintCompleted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/sprints/${encodeURIComponent(sprintId)}`);
        if (!res.ok) {
          throw new Error("load");
        }
        const data = (await res.json()) as { name: string; completedAt?: string | null };
        if (!cancelled) {
          setSprintName(data.name);
          setSprintCompleted(Boolean(data.completedAt));
        }
      } catch {
        if (!cancelled) {
          setSprintName("");
          setSprintCompleted(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sprintId]);

  useEffect(() => {
    if (contentPath === null) {
      return;
    }
    if (contentPath === "sprint-root") {
      return;
    }

    const displayName = sprintName.trim() || "…";
    const overviewHref = `/sprints/${sprintId}/overview`;
    const ticketsHref = `/sprints/${sprintId}/tickets`;
    const reportHref = `/sprints/${sprintId}/report`;

    setLeading(
      <Breadcrumb className="min-w-0 flex-1 text-xs">
        <BreadcrumbList>
          <BreadcrumbItem>
            <Link href="/sprints" className="hover:text-foreground">
              {tNav("sprints")}
            </Link>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <Link href={overviewHref} className="max-w-40 truncate hover:text-foreground">
              {displayName}
            </Link>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          {contentPath === "overview" ? (
            <BreadcrumbItem>
              <span className="text-foreground" aria-current="page">
                {tSprints("navOverview")}
              </span>
            </BreadcrumbItem>
          ) : (
            <BreadcrumbItem>
              <Link href={overviewHref} className="hover:text-foreground">
                {tSprints("navOverview")}
              </Link>
            </BreadcrumbItem>
          )}
          <BreadcrumbSeparator />
          {contentPath === "tickets" ? (
            <BreadcrumbItem>
              <span className="text-foreground" aria-current="page">
                {tSprints("navTickets")}
              </span>
            </BreadcrumbItem>
          ) : (
            <BreadcrumbItem>
              <Link href={ticketsHref} className="hover:text-foreground">
                {tSprints("navTickets")}
              </Link>
            </BreadcrumbItem>
          )}
          {sprintCompleted ? (
            <>
              <BreadcrumbSeparator />
              {contentPath === "report" ? (
                <BreadcrumbItem>
                  <span className="text-foreground" aria-current="page">
                    {tSprints("navReport")}
                  </span>
                </BreadcrumbItem>
              ) : (
                <BreadcrumbItem>
                  <Link href={reportHref} className="hover:text-foreground">
                    {tSprints("navReport")}
                  </Link>
                </BreadcrumbItem>
              )}
            </>
          ) : null}
        </BreadcrumbList>
      </Breadcrumb>
    );

    return () => {
      setLeading(null);
    };
  }, [contentPath, sprintId, sprintName, sprintCompleted, setLeading, tNav, tSprints]);

  return null;
}
