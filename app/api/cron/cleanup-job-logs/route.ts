import { NextRequest } from 'next/server'
import { cleanupOldJobExecutions } from '@/lib/services/job-logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Vercel Functionの最大実行時間を60秒に設定

export async function GET(request: NextRequest) {
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
        console.warn('Unauthorized attempt to trigger job log cleanup.')
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    // 60日経過した古い実行ログを削除
    const deletedCount = await cleanupOldJobExecutions(60)

    if (deletedCount > 0) {
      console.log(`Cleaned up ${deletedCount} old job execution logs.`)
    }

    return Response.json({
      success: true,
      message: `Job log cleanup completed. Deleted ${deletedCount} old logs.`,
      deletedCount,
    })
  } catch (error) {
    console.error('Error in Cron Job /api/cron/cleanup-job-logs:', error)
    return Response.json(
      { error: 'Internal Server Error', details: String(error) },
      { status: 500 }
    )
  }
}
