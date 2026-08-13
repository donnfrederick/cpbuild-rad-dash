import { ProjectHeaderBreadcrumb } from "@/components/layout/ProjectHeaderBreadcrumb";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return (
    <div className="min-h-0 w-full min-w-0 flex-1">
      <ProjectHeaderBreadcrumb projectId={projectId} />
      {children}
    </div>
  );
}
