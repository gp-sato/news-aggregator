import { NextRequest } from 'next/server'
import { syncNews } from '@/lib/news'
import {
  startJobExecution,
  completeJobExecution,
  completeJobExecutionAsFailed,
  failJobExecution,
  recordFeedSyncExecutions,
  recordJobEvent,
} from '@/lib/services/job-logger'
import { JobType, JobEventLevel } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Vercel Functionの最大実行時間を60秒に設定

export async function GET(request: NextRequest) {
  let jobExecutionId: string | null = null

  try {
    // Vercel Cronジョブのセキュリティ保護
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (process.env.NODE_ENV === 'production') {
      if (!cronSecret) {
        console.error('CRON_SECRET is not configured in production environment.')
        return Response.json({ error: 'Internal Server Error (Config)' }, { status: 500 })
      }
      if (authHeader !== `Bearer ${cronSecret}`) {
        console.warn('Unauthorized attempt to trigger news sync.')
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    // ジョブ実行記録を開始（即時INSERTでクラッシュ耐性を確保）
    jobExecutionId = await startJobExecution(JobType.RSS_SYNC, 'cron')

    try {
      // 50秒の内部タイムバジェットを指定して実行
      const result = await syncNews({
        deadlineBudgetMs: 50000,
        jobExecutionId,
      })

      // Feed同期結果を記録
      await recordFeedSyncExecutions(
        jobExecutionId,
        result.feedResults.map((feed) => ({
          sourceId: feed.sourceId,
          sourceName: feed.sourceName,
          sourceUrl: feed.sourceUrl,
          status: feed.status,
          httpStatus: feed.httpStatus,
          durationMs: feed.durationMs,
          itemsFound: feed.itemsFound,
          itemsCreated: feed.itemsCreated,
          errorCode: feed.errorCode,
          errorMessage: feed.errorMessage,
        }))
      )

      // 重要イベントを記録
      if (result.feedFailureCount > 0) {
        await recordJobEvent(
          jobExecutionId,
          'FEED_FAILURE',
          JobEventLevel.WARN,
          `${result.feedFailureCount} feeds failed to sync`,
          { feedFailureCount: result.feedFailureCount }
        )
      }

      if (result.queueFailureCount > 0) {
        await recordJobEvent(
          jobExecutionId,
          'QUEUE_FAILURE',
          JobEventLevel.ERROR,
          `${result.queueFailureCount} queue enqueue operations failed`,
          { queueFailureCount: result.queueFailureCount }
        )
      }

      if (result.errorTypes.phase) {
        const phaseErrors = result.errorDetails
          .filter((error) => error.type === 'phase')
          .map((error) => error.message)
        await recordJobEvent(
          jobExecutionId,
          'PHASE_ERROR',
          JobEventLevel.ERROR,
          `Sync completed with error(s): ${phaseErrors.join('; ')}`,
          { errors: phaseErrors }
        )
      }

      // ジョブ完了を記録
      // フェーズ障害（DB保存失敗・全Feed失敗など）はFAILED、Feed/Queueの部分失敗はPARTIAL_SUCCESS、それ以外はSUCCESS
      if (result.errorTypes.phase) {
        await completeJobExecutionAsFailed(jobExecutionId, {
          feedTotalCount: result.feedTotalCount,
          feedSuccessCount: result.feedSuccessCount,
          feedFailureCount: result.feedFailureCount,
          itemsFound: result.itemsFound,
          itemsCreated: result.addedCount,
          itemsSkipped: result.itemsSkipped,
          queuedCount: result.queuedCount,
          queueFailureCount: result.queueFailureCount,
          recoveredQueuedCount: result.recoveredCount,
        }, {
          errorCode: 'PHASE_ERROR',
          errorMessage: result.errorDetails
            .filter((error) => error.type === 'phase')
            .map((error) => error.message)
            .join('; '),
        })
      } else {
        await completeJobExecution(jobExecutionId, {
          feedTotalCount: result.feedTotalCount,
          feedSuccessCount: result.feedSuccessCount,
          feedFailureCount: result.feedFailureCount,
          itemsFound: result.itemsFound,
          itemsCreated: result.addedCount,
          itemsSkipped: result.itemsSkipped,
          queuedCount: result.queuedCount,
          queueFailureCount: result.queueFailureCount,
          recoveredQueuedCount: result.recoveredCount,
        })
      }

      // エラーが記録されている場合は 500 を返却してサイレント障害を防止
      if (result.errors.length > 0) {
        console.error(`Cron Job completed with ${result.errors.length} error(s):`, result.errors)
        return Response.json(
          {
            success: false,
            message: 'News sync completed with errors.',
            addedCount: result.addedCount,
            recoveredCount: result.recoveredCount,
            errors: result.errors,
          },
          { status: 500 }
        )
      }

      return Response.json({
        success: true,
        message: `News feed synchronized successfully.`,
        addedCount: result.addedCount,
        recoveredCount: result.recoveredCount,
      })
    } catch (syncError) {
      // 同期中のエラーを記録
      if (jobExecutionId) {
        await failJobExecution(jobExecutionId, syncError as Error, {
          feedTotalCount: 0,
          feedSuccessCount: 0,
          feedFailureCount: 0,
          itemsFound: 0,
          itemsCreated: 0,
          itemsSkipped: 0,
          queuedCount: 0,
          queueFailureCount: 0,
          recoveredQueuedCount: 0,
        })
      }
      throw syncError
    }
  } catch (error) {
    console.error('Error in Cron Job /api/cron/fetch-news:', error)
    return Response.json(
      { error: 'Internal Server Error', details: String(error) },
      { status: 500 }
    )
  }
}
