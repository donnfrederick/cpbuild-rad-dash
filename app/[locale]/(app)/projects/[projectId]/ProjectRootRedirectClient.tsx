"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";

export default function ProjectRootRedirectClient(): React.ReactElement {
  const params = useParams();
  const router = useRouter();
  const projectId = typeof params?.projectId === "string" ? params.projectId : "";

  useEffect(() => {
    if (projectId) {
      router.replace(`/projects/${projectId}/overview`);
    }
  }, [projectId, router]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
    </div>
  );
}
