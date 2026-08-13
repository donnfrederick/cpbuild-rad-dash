import { Loader2 } from "lucide-react";

/** Shown while a route module loaded with `dynamic(..., { ssr: false })` is fetching on the client. */
export function CsrPageFallback(): React.ReactElement {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
    </div>
  );
}
