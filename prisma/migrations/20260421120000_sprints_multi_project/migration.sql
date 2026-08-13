-- CreateTable
CREATE TABLE "sprints" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprint_projects" (
    "sprintId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "sprint_projects_pkey" PRIMARY KEY ("sprintId","projectId")
);

-- CreateIndex
CREATE INDEX "sprint_projects_projectId_idx" ON "sprint_projects"("projectId");

-- AddForeignKey
ALTER TABLE "sprint_projects" ADD CONSTRAINT "sprint_projects_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_projects" ADD CONSTRAINT "sprint_projects_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
