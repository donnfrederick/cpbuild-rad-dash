import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { TicketDetailsClientEntry } from "@/components/tickets/TicketDetailsClientEntry";

type PageProps = {
  params: Promise<{ locale: string; projectId: string; ticketId: string }>;
};

export default async function ProjectTicketDetailsPage({ params }: PageProps) {
  const { locale, projectId, ticketId } = await params;

  const row = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { projectId: true },
  });
  if (!row) {
    notFound();
  }
  if (!row.projectId) {
    redirect({ href: `/tickets/${ticketId}/details`, locale });
  }
  if (row.projectId !== projectId) {
    redirect({
      href: `/projects/${row.projectId}/tickets/${ticketId}/details`,
      locale,
    });
  }

  return <TicketDetailsClientEntry />;
}
