-- CreateTable
CREATE TABLE "CapturedThought" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskName" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "categoryOptionId" TEXT,
    "estimatedDurationMinutes" INTEGER,
    "roughTiming" TEXT,
    "status" TEXT NOT NULL DEFAULT 'captured',
    "convertedRecordId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapturedThought_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CapturedThought_workspaceId_userId_status_idx" ON "CapturedThought"("workspaceId", "userId", "status");

-- AddForeignKey
ALTER TABLE "CapturedThought" ADD CONSTRAINT "CapturedThought_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapturedThought" ADD CONSTRAINT "CapturedThought_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
