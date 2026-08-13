import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Breadcrumb({ className, ...props }: React.ComponentProps<"nav">): React.ReactElement {
  return <nav aria-label="Breadcrumb" className={cn(className)} {...props} />;
}

export function BreadcrumbList({ className, ...props }: React.ComponentProps<"ol">): React.ReactElement {
  return (
    <ol
      className={cn("flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export function BreadcrumbItem({ className, ...props }: React.ComponentProps<"li">): React.ReactElement {
  return <li className={cn("inline-flex min-w-0 items-center gap-1.5", className)} {...props} />;
}

export function BreadcrumbSeparator({ className }: { className?: string }): React.ReactElement {
  return (
    <span className={cn("inline-flex shrink-0 text-muted-foreground/60", className)} aria-hidden>
      <ChevronRight className="size-4" />
    </span>
  );
}
