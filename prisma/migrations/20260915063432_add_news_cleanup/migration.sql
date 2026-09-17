-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'NEWS_CLEANUP';

-- AlterTable
ALTER TABLE "JobExecution" ADD COLUMN     "deletedNewsCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "NewsItem_createdAt_id_idx" ON "NewsItem"("createdAt", "id");
