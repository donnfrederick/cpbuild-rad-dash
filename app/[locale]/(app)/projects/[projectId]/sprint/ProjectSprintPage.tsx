"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

/** Sprints now live at `/sprints` and can include multiple projects. */
export default function LegacyProjectSprintRedirect(): React.ReactElement {
  const router = useRouter();
  useEffect(() => {
    router.replace("/sprints");
  }, [router]);
  return (
    <div className="flex justify-center py-20 text-sm text-muted-foreground">
      Redirecting…
    </div>
  );
}
