-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('RSS_SYNC', 'SWEEPER_ONLY', 'MANUAL_SYNC');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "FeedSyncStatus" AS ENUM ('SUCCESS', 'FAILED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "JobEventLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- AlterTable
ALTER TABLE "NewsItem" ADD COLUMN "createdJobExecutionId" TEXT;

-- CreateTable
CREATE TABLE "JobExecution" (
    "id" TEXT NOT NULL,
    "jobType" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'RUNNING',
    "triggerSource" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "feedTotalCount" INTEGER NOT NULL DEFAULT 0,
    "feedSuccessCount" INTEGER NOT NULL DEFAULT 0,
    "feedFailureCount" INTEGER NOT NULL DEFAULT 0,
    "itemsFound" INTEGER NOT NULL DEFAULT 0,
    "itemsCreated" INTEGER NOT NULL DEFAULT 0,
    "itemsSkipped" INTEGER NOT NULL DEFAULT 0,
    "itemsFailed" INTEGER NOT NULL DEFAULT 0,
    "queuedCount" INTEGER NOT NULL DEFAULT 0,
    "queueFailureCount" INTEGER NOT NULL DEFAULT 0,
    "recoveredQueuedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "errorStack" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedSyncExecution" (
    "id" TEXT NOT NULL,
    "jobExecutionId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "status" "FeedSyncStatus" NOT NULL,
    "httpStatus" INTEGER,
    "durationMs" INTEGER,
    "itemsFound" INTEGER NOT NULL DEFAULT 0,
    "itemsCreated" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedSyncExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobEvent" (
    "id" TEXT NOT NULL,
    "jobExecutionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "level" "JobEventLevel" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NewsItem_createdJobExecutionId_idx" ON "NewsItem"("createdJobExecutionId");

-- CreateIndex
CREATE INDEX "JobExecution_startedAt_idx" ON "JobExecution"("startedAt");

-- CreateIndex
CREATE INDEX "JobExecution_status_idx" ON "JobExecution"("status");

-- CreateIndex
CREATE INDEX "FeedSyncExecution_jobExecutionId_idx" ON "FeedSyncExecution"("jobExecutionId");

-- CreateIndex
CREATE INDEX "FeedSyncExecution_status_idx" ON "FeedSyncExecution"("status");

-- CreateIndex
CREATE INDEX "JobEvent_jobExecutionId_idx" ON "JobEvent"("jobExecutionId");

-- CreateIndex
CREATE INDEX "JobEvent_level_idx" ON "JobEvent"("level");

-- CreateIndex
CREATE INDEX "JobEvent_createdAt_idx" ON "JobEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_createdJobExecutionId_fkey" FOREIGN KEY ("createdJobExecutionId") REFERENCES "JobExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedSyncExecution" ADD CONSTRAINT "FeedSyncExecution_jobExecutionId_fkey" FOREIGN KEY ("jobExecutionId") REFERENCES "JobExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEvent" ADD CONSTRAINT "JobEvent_jobExecutionId_fkey" FOREIGN KEY ("jobExecutionId") REFERENCES "JobExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
