import { SprintHeaderBreadcrumb } from "@/components/layout/SprintHeaderBreadcrumb";

export default async function SprintLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ sprintId: string }>;
}) {
  const { sprintId } = await params;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <SprintHeaderBreadcrumb sprintId={sprintId} />
      {children}
    </div>
  );
}
