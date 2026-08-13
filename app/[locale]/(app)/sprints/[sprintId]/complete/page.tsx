import SprintCompletePage from "./SprintCompletePage";

export default function SprintCompleteRoutePage({
  params,
}: {
  params: Promise<{ sprintId: string }>;
}) {
  return <SprintCompletePage params={params} />;
}
