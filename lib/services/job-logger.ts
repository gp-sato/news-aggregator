import { prisma } from '../prisma'
import { JobType, JobStatus, FeedSyncStatus, JobEventLevel, Prisma } from '@prisma/client'

export interface JobExecutionSummary {
  feedTotalCount?: number
  feedSuccessCount?: number
  feedFailureCount?: number
  itemsFound?: number
  itemsCreated?: number
  itemsSkipped?: number
  itemsFailed?: number
  queuedCount?: number
  queueFailureCount?: number
  recoveredQueuedCount?: number
  errorCode?: string
  errorMessage?: string
  errorStack?: string
}

export interface FeedSyncResult {
  sourceId: string
  sourceName: string
  sourceUrl: string
  status: FeedSyncStatus
  httpStatus?: number
  durationMs: number
  itemsFound: number
  itemsCreated?: number
  errorCode?: string
  errorMessage?: string
}

export interface JobEventMetadata {
  [key: string]: unknown
}

/**
 * Start a new job execution record with RUNNING status.
 * Returns the job execution ID, or null if creation failed.
 */
export async function startJobExecution(
  jobType: JobType,
  triggerSource?: string
): Promise<string | null> {
  try {
    const jobExecution = await prisma.jobExecution.create({
      data: {
        jobType,
        status: JobStatus.RUNNING,
        triggerSource,
        startedAt: new Date(),
      },
    })
    return jobExecution.id
  } catch (error) {
    console.error('Failed to start job execution log:', error)
    return null
  }
}

/**
 * Complete a job execution with SUCCESS or PARTIAL_SUCCESS status.
 */
export async function completeJobExecution(
  id: string | null,
  summaryData: JobExecutionSummary
): Promise<void> {
  if (!id) return

  try {
    const startedAt = await prisma.jobExecution
      .findUnique({
        where: { id },
        select: { startedAt: true },
      })
      .then((result) => result?.startedAt || new Date())
      .catch(() => new Date())

    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()

    const hasFailures =
      (summaryData.feedFailureCount || 0) > 0 ||
      (summaryData.queueFailureCount || 0) > 0 ||
      (summaryData.itemsFailed || 0) > 0

    const status = hasFailures ? JobStatus.PARTIAL_SUCCESS : JobStatus.SUCCESS

    await prisma.jobExecution.update({
      where: { id },
      data: {
        status,
        finishedAt,
        durationMs,
        ...summaryData,
      },
    })
  } catch (error) {
    console.error('Failed to complete job execution log:', error)
  }
}

/**
 * Complete a job execution with FAILED status when job completed with errors.
 */
export async function completeJobExecutionAsFailed(
  id: string | null,
  summaryData: JobExecutionSummary,
  errorSummary?: { errorCode?: string; errorMessage?: string }
): Promise<void> {
  if (!id) return

  try {
    const startedAt = await prisma.jobExecution
      .findUnique({
        where: { id },
        select: { startedAt: true },
      })
      .then((result) => result?.startedAt || new Date())
      .catch(() => new Date())

    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()

    await prisma.jobExecution.update({
      where: { id },
      data: {
        status: JobStatus.FAILED,
        finishedAt,
        durationMs,
        errorCode: errorSummary?.errorCode,
        errorMessage: errorSummary?.errorMessage,
        ...summaryData,
      },
    })
  } catch (error) {
    console.error('Failed to complete job execution as failed log:', error)
  }
}

/**
 * Mark a job execution as FAILED or TIMEOUT with error details.
 */
export async function failJobExecution(
  id: string | null,
  error: Error,
  summaryData: JobExecutionSummary = {}
): Promise<void> {
  if (!id) return

  try {
    const startedAt = await prisma.jobExecution
      .findUnique({
        where: { id },
        select: { startedAt: true },
      })
      .then((result) => result?.startedAt || new Date())
      .catch(() => new Date())

    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()

    const isTimeout = error.name === 'AbortError' || error.name === 'TimeoutError'
    const status = isTimeout ? JobStatus.TIMEOUT : JobStatus.FAILED

    await prisma.jobExecution.update({
      where: { id },
      data: {
        status,
        finishedAt,
        durationMs,
        errorCode: error.name,
        errorMessage: error.message,
        errorStack: error.stack,
        ...summaryData,
      },
    })
  } catch (logError) {
    console.error('Failed to record job failure log:', logError)
  }
}

/**
 * Record feed sync execution results in batch.
 */
export async function recordFeedSyncExecutions(
  jobExecutionId: string | null,
  feedResults: FeedSyncResult[]
): Promise<void> {
  if (!jobExecutionId || feedResults.length === 0) return

  try {
    await prisma.feedSyncExecution.createMany({
      data: feedResults.map((result) => ({
        jobExecutionId,
        sourceId: result.sourceId,
        sourceName: result.sourceName,
        sourceUrl: result.sourceUrl,
        status: result.status,
        httpStatus: result.httpStatus,
        durationMs: result.durationMs,
        itemsFound: result.itemsFound,
        itemsCreated: result.itemsCreated,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      })),
    })
  } catch (error) {
    console.error('Failed to record feed sync executions:', error)
    // Do not throw - logging failures should not break the main job
  }
}

/**
 * Record a job event.
 */
export async function recordJobEvent(
  jobExecutionId: string | null,
  eventType: string,
  level: JobEventLevel,
  message: string,
  metadata?: JobEventMetadata
): Promise<void> {
  if (!jobExecutionId) return

  try {
    await prisma.jobEvent.create({
      data: {
        jobExecutionId,
        eventType,
        level,
        message,
        metadata: metadata as Prisma.InputJsonValue,
      },
    })
  } catch (error) {
    console.error('Failed to record job event:', error)
    // Do not throw - logging failures should not break the main job
  }
}

/**
 * Clean up old job execution records older than retentionDays.
 * Returns the number of deleted records.
 *
 * Note: This should be called from a separate cron job to avoid
 * interfering with the main news sync deadline budget.
 *
 * @throws {Error} If database operation fails (to allow cron job to detect failures)
 */
export async function cleanupOldJobExecutions(
  retentionDays: number = 60
): Promise<number> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays)

  const result = await prisma.jobExecution.deleteMany({
    where: {
      createdAt: {
        lt: cutoffDate,
      },
    },
  })
  return result.count
}
