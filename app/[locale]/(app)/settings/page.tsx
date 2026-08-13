"use client";

import dynamic from "next/dynamic";
import { CsrPageFallback } from "@/components/csr/CsrPageFallback";

export default dynamic(() => import("./SettingsPage"), {
  ssr: false,
  loading: () => <CsrPageFallback />,
});
