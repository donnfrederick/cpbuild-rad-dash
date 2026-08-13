"use client";

import dynamic from "next/dynamic";
import { CsrPageFallback } from "@/components/csr/CsrPageFallback";

export default dynamic(() => import("./DuplicatesPage"), {
  ssr: false,
  loading: () => <CsrPageFallback />,
});
