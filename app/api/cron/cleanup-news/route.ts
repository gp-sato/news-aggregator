import { NextRequest } from 'next/server'
import { cleanupOldNews, CleanupError } from '@/lib/services/news-cleanup'
import {
  startJobExecution,
  completeJobExecution,
  failJobExecution,
} from '@/lib/services/job-logger'
import { JobType } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  let jobExecutionId: string | null = null

  try {
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (process.env.NODE_ENV === 'production') {
      if (!cronSecret) {
        console.error('CRON_SECRET is not configured in production environment.')
        return Response.json({ error: 'Internal Server Error (Config)' }, { status: 500 })
      }
      if (authHeader !== `Bearer ${cronSecret}`) {
        console.warn('Unauthorized attempt to trigger news cleanup.')
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    jobExecutionId = await startJobExecution(JobType.NEWS_CLEANUP, 'cron')

    const result = await cleanupOldNews(jobExecutionId)

    await completeJobExecution(jobExecutionId, {
      deletedNewsCount: result.deletedCount,
    })

    return Response.json({
      success: true,
      message: `News cleanup completed. Deleted ${result.deletedCount} items in ${result.batchCount} batches.`,
      deletedCount: result.deletedCount,
      batchCount: result.batchCount,
      hasMore: result.hasMore,
      durationMs: result.durationMs,
    })
  } catch (error) {
    const deletedNewsCount = error instanceof CleanupError ? error.deletedCount : 0
    if (jobExecutionId) {
      await failJobExecution(jobExecutionId, error as Error, {
        deletedNewsCount,
      })
    }
    console.error('Error in Cron Job /api/cron/cleanup-news:', error)
    return Response.json(
      { error: 'Internal Server Error', details: String(error) },
      { status: 500 }
    )
  }
}
