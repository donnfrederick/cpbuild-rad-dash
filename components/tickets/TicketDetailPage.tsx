"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { useLocale } from "next-intl";
import { Loader2 } from "lucide-react";
import { hasTicketTriageAccess } from "@/lib/ticket-triage";
import { TicketDetailView } from "@/components/tickets/TicketDetailView";
import { useAppUser } from "@/contexts/AppUserContext";
import { useRouter } from "@/i18n/navigation";
import { TICKETS_INBOX_MERGE_EVENT } from "@/lib/ticket-inbox-events";
import type { TicketReport } from "@/components/tickets/ticket-types";

export default function TicketDetailPage(): React.ReactElement {
  const params = useParams();
  const router = useRouter();
  const locale = useLocale();
  const user = useAppUser();
  const ticketId =
    typeof params?.ticketId === "string"
      ? params.ticketId
      : typeof params?.id === "string"
        ? params.id
        : "";
  const routeProjectId = typeof params?.projectId === "string" ? params.projectId : null;
  const canTriage = hasTicketTriageAccess(user.role, user.specialPermissions);
  const isAdmin = user.role === "ADMIN";

  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <TicketDetailView
        variant="page"
        ticketId={ticketId}
        locale={locale}
        canTriage={canTriage}
        isAdmin={isAdmin}
        currentUserId={user.id}
        routeProjectId={routeProjectId}
        onUpdate={async () => {}}
        onListRowPatched={(report: TicketReport) => {
          window.dispatchEvent(new CustomEvent(TICKETS_INBOX_MERGE_EVENT, { detail: report }));
        }}
        onRequestClose={() => {
          if (routeProjectId) {
            router.push(`/projects/${routeProjectId}/tickets`);
          } else {
            router.push("/tickets");
          }
        }}
      />
    </Suspense>
  );
}
