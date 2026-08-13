"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { usePageHeader } from "@/contexts/PageHeaderContext";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb";

type ProjectSubPath = "overview" | "tickets" | "duplicates" | "sprint" | "settings" | "project-root";

function parseProjectContentPath(pathname: string, projectId: string): "ticket-detail" | ProjectSubPath | null {
  const prefix = `/projects/${projectId}`;
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  if (/^\/projects\/[^/]+\/tickets\/[^/]+\/details$/.test(pathname)) {
    return "ticket-detail";
  }

  if (pathname === prefix || pathname === `${prefix}/overview`) {
    return pathname === prefix ? "project-root" : "overview";
  }
  if (pathname === `${prefix}/tickets`) {
    return "tickets";
  }
  if (pathname === `${prefix}/duplicates`) {
    return "duplicates";
  }
  if (pathname === `${prefix}/sprint`) {
    return "sprint";
  }
  if (pathname === `${prefix}/settings`) {
    return "settings";
  }
  return null;
}

export function ProjectHeaderBreadcrumb({ projectId }: { projectId: string }): null {
  const pathname = usePathname();
  const { setLeading } = usePageHeader();
  const tNav = useTranslations("nav");
  const tProjects = useTranslations("projects");

  const contentPath = useMemo(() => parseProjectContentPath(pathname, projectId), [pathname, projectId]);

  const [projectName, setProjectName] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
        if (!res.ok) {
          throw new Error("load");
        }
        const data = (await res.json()) as { name: string };
        if (!cancelled) {
          setProjectName(data.name);
        }
      } catch {
        if (!cancelled) {
          setProjectName("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (contentPath === null || contentPath === "ticket-detail") {
      return;
    }

    const displayName = projectName.trim() || "…";
    const overviewHref = `/projects/${projectId}/overview`;

    const currentLabel =
      contentPath === "tickets"
        ? tProjects("navTickets")
        : contentPath === "duplicates"
          ? tProjects("navDuplicates")
          : contentPath === "sprint"
            ? tProjects("navSprint")
            : contentPath === "settings"
              ? tProjects("navSettings")
              : tProjects("navOverview");

    setLeading(
      <Breadcrumb className="min-w-0 flex-1 text-xs">
        <BreadcrumbList>
          <BreadcrumbItem>
            <Link href="/projects" className="hover:text-foreground">
              {tNav("projects")}
            </Link>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <Link href={overviewHref} className="max-w-40 truncate hover:text-foreground">
              {displayName}
            </Link>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <span className="text-foreground" aria-current="page">
              {currentLabel}
            </span>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );

    return () => {
      setLeading(null);
    };
  }, [contentPath, projectId, projectName, setLeading, tNav, tProjects]);

  return null;
}
