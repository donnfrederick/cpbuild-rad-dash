import { redirect } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { TicketDetailsClientEntry } from "@/components/tickets/TicketDetailsClientEntry";

type PageProps = {
  params: Promise<{ locale: string; id: string }>;
};

export default async function TicketDetailsLegacyPage({ params }: PageProps) {
  const { locale, id } = await params;
  const row = await db.ticket.findUnique({
    where: { id },
    select: { projectId: true },
  });
  if (row?.projectId) {
    redirect({
      href: `/projects/${row.projectId}/tickets/${id}/details`,
      locale,
    });
  }
  return <TicketDetailsClientEntry />;
}
