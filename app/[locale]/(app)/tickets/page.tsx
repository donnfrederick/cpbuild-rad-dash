"use client";

import dynamic from "next/dynamic";
import { CsrPageFallback } from "@/components/csr/CsrPageFallback";

export default dynamic(() => import("./TicketsPage"), {
  ssr: false,
  loading: () => <CsrPageFallback />,
});
