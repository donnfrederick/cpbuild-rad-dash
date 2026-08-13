"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";

export default function SprintRootRedirectClient(): React.ReactElement {
  const params = useParams();
  const router = useRouter();
  const sprintId = typeof params?.sprintId === "string" ? params.sprintId : "";

  useEffect(() => {
    if (sprintId) {
      router.replace(`/sprints/${sprintId}/overview`);
    }
  }, [sprintId, router]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
    </div>
  );
}
