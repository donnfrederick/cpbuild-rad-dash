"use client";

import dynamic from "next/dynamic";
import { CsrPageFallback } from "@/components/csr/CsrPageFallback";

const TicketDetailPage = dynamic(() => import("@/components/tickets/TicketDetailPage"), {
  ssr: false,
  loading: () => <CsrPageFallback />,
});

/** Client-only shell for ticket detail routes (matches prior CSR behavior). */
export function TicketDetailsClientEntry(): React.ReactElement {
  return <TicketDetailPage />;
}
