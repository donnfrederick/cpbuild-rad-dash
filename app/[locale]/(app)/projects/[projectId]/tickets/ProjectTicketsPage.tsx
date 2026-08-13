"use client";

import { use } from "react";
import { TicketsWorkspace } from "@/components/tickets/TicketsWorkspace";

export default function ProjectTicketsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  return <TicketsWorkspace projectId={projectId} />;
}
