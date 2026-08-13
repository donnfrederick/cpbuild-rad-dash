import { redirect } from "@/i18n/navigation";

type PageProps = {
  params: Promise<{ locale: string; id: string }>;
};

export default async function TicketDetailLegacyRedirect({ params }: PageProps): Promise<void> {
  const { id, locale } = await params;
  redirect({ href: `/tickets/${id}/details`, locale });
}
