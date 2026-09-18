import { prisma } from '../prisma'
import { recordJobEvent, JobEventMetadata } from './job-logger'
import { JobEventLevel } from '@prisma/client'

export interface CleanupResult {
  deletedCount: number
  batchCount: number
  hasMore: boolean
  durationMs: number
}

export class CleanupError extends Error {
  deletedCount: number
  batchCount: number
  durationMs: number
  cause?: unknown

  constructor(
    message: string,
    stats: { deletedCount: number; batchCount: number; durationMs: number },
    cause?: unknown
  ) {
    super(message)
    this.name = 'CleanupError'
    this.deletedCount = stats.deletedCount
    this.batchCount = stats.batchCount
    this.durationMs = stats.durationMs
    this.cause = cause
  }
}

/**
 * Cleanup old news items based on retention period.
 *
 * @param jobExecutionId - Optional job execution ID for event logging
 * @returns CleanupResult with statistics
 * @throws {Error} If NEWS_RETENTION_DAYS is invalid or database operation fails
 */
/**
 * Validate and parse a positive integer from environment variable.
 */
function validatePositiveInteger(
  value: string | undefined,
  defaultValue: number,
  envName: string
): number {
  const strValue = value || String(defaultValue)
  
  // Check if it's a valid positive integer string
  if (!/^\d+$/.test(strValue)) {
    throw new Error(
      `Invalid ${envName}: ${strValue}. Must be a positive integer.`
    )
  }
  
  const numValue = parseInt(strValue, 10)
  
  if (numValue <= 0) {
    throw new Error(
      `Invalid ${envName}: ${strValue}. Must be a positive integer.`
    )
  }
  
  return numValue
}

export async function cleanupOldNews(
  jobExecutionId?: string | null
): Promise<CleanupResult> {
  const startTime = Date.now()

  // Validate and get configuration
  const retentionDays = validatePositiveInteger(
    process.env.NEWS_RETENTION_DAYS,
    30,
    'NEWS_RETENTION_DAYS'
  )
  const batchSize = validatePositiveInteger(
    process.env.NEWS_CLEANUP_BATCH_SIZE,
    500,
    'NEWS_CLEANUP_BATCH_SIZE'
  )
  const maxItems = validatePositiveInteger(
    process.env.NEWS_CLEANUP_MAX_ITEMS,
    5000,
    'NEWS_CLEANUP_MAX_ITEMS'
  )
  const deadlineBudgetMs = validatePositiveInteger(
    process.env.NEWS_CLEANUP_DEADLINE_MS,
    45000,
    'NEWS_CLEANUP_DEADLINE_MS'
  )

  // Calculate cutoff date
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays)

  let deletedCount = 0
  let batchCount = 0
  let hasMore = false

  // Log start event
  if (jobExecutionId) {
    await recordJobEvent(
      jobExecutionId,
      'CLEANUP_START',
      JobEventLevel.INFO,
      `Starting news cleanup. Retention: ${retentionDays} days, Batch size: ${batchSize}, Max items: ${maxItems}`,
      {
        retentionDays,
        batchSize,
        maxItems,
        deadlineBudgetMs,
        cutoffDate: cutoffDate.toISOString(),
      } as JobEventMetadata
    )
  }

  try {
    while (true) {
      // Check deadline
      const elapsedMs = Date.now() - startTime
      if (elapsedMs >= deadlineBudgetMs) {
        hasMore = true
        if (jobExecutionId) {
          await recordJobEvent(
            jobExecutionId,
            'CLEANUP_TIMEOUT',
            JobEventLevel.INFO,
            `Reached deadline budget (${elapsedMs}ms >= ${deadlineBudgetMs}ms). Stopping cleanup.`,
            {
              elapsedMs,
              deadlineBudgetMs,
              deletedCount,
              batchCount,
            } as JobEventMetadata
          )
        }
        break
      }

      // Check max items
      if (deletedCount >= maxItems) {
        hasMore = true
        if (jobExecutionId) {
          await recordJobEvent(
            jobExecutionId,
            'CLEANUP_MAX_ITEMS',
            JobEventLevel.INFO,
            `Reached max items limit (${deletedCount} >= ${maxItems}). Stopping cleanup.`,
            {
              deletedCount,
              maxItems,
              batchCount,
            } as JobEventMetadata
          )
        }
        break
      }

      // Calculate remaining items we can delete
      const remainingItems = maxItems - deletedCount
      const currentTake = Math.min(batchSize, remainingItems)

      if (currentTake <= 0) {
        hasMore = true
        if (jobExecutionId) {
          await recordJobEvent(
            jobExecutionId,
            'CLEANUP_MAX_ITEMS',
            JobEventLevel.INFO,
            `Reached max items limit (no remaining quota). Stopping cleanup.`,
            {
              deletedCount,
              maxItems,
              batchCount,
            } as JobEventMetadata
          )
        }
        break
      }

      // Exclude actively processing items (PROCESSING status with recent start time)
      // Use explicit OR conditions to safely handle NULL in imageFetchStartedAt under SQL 3-valued logic
      const activeProcessingThreshold = new Date(Date.now() - 5 * 60 * 1000) // 5 minutes ago

      const cleanupEligibilityCondition = {
        createdAt: {
          lt: cutoffDate,
        },
        OR: [
          {
            imageFetchStatus: { not: 'PROCESSING' as const },
          },
          {
            imageFetchStatus: 'PROCESSING' as const,
            imageFetchStartedAt: null,
          },
          {
            imageFetchStatus: 'PROCESSING' as const,
            imageFetchStartedAt: {
              lt: activeProcessingThreshold,
            },
          },
        ],
      }

      // Fetch IDs of items to delete
      const itemsToDelete = await prisma.newsItem.findMany({
        where: cleanupEligibilityCondition,
        select: {
          id: true,
        },
        orderBy: [
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
        take: currentTake,
      })

      if (itemsToDelete.length === 0) {
        hasMore = false
        if (jobExecutionId) {
          await recordJobEvent(
            jobExecutionId,
            'CLEANUP_COMPLETE',
            JobEventLevel.INFO,
            `No more items to delete. Cleanup complete.`,
            {
              deletedCount,
              batchCount,
            } as JobEventMetadata
          )
        }
        break
      }

      const ids = itemsToDelete.map((item) => item.id)

      // Delete items by IDs with atomic guard against concurrently processing items
      const deleteResult = await prisma.newsItem.deleteMany({
        where: {
          id: {
            in: ids,
          },
          ...cleanupEligibilityCondition,
        },
      })

      deletedCount += deleteResult.count
      batchCount++

      if (jobExecutionId) {
        await recordJobEvent(
          jobExecutionId,
          'CLEANUP_BATCH',
          JobEventLevel.INFO,
          `Deleted batch ${batchCount}: ${deleteResult.count} items (total: ${deletedCount})`,
          {
            batchNumber: batchCount,
            batchDeleted: deleteResult.count,
            totalDeleted: deletedCount,
          } as JobEventMetadata
        )
      }
    }

    const durationMs = Date.now() - startTime

    if (jobExecutionId) {
      await recordJobEvent(
        jobExecutionId,
        'CLEANUP_SUMMARY',
        JobEventLevel.INFO,
        `Cleanup summary: ${deletedCount} items deleted in ${batchCount} batches (${durationMs}ms). hasMore: ${hasMore}`,
        {
          deletedCount,
          batchCount,
          durationMs,
          hasMore,
        } as JobEventMetadata
      )
    }

    return {
      deletedCount,
      batchCount,
      hasMore,
      durationMs,
    }
  } catch (error) {
    const durationMs = Date.now() - startTime
    if (jobExecutionId) {
      await recordJobEvent(
        jobExecutionId,
        'CLEANUP_ERROR',
        JobEventLevel.ERROR,
        `Cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          deletedCount,
          batchCount,
          durationMs,
          error: error instanceof Error ? error.message : String(error),
        } as JobEventMetadata
      )
    }
    throw new CleanupError(
      `Cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      { deletedCount, batchCount, durationMs },
      error
    )
  }
}
