import { NextRequest } from 'next/server'
import { syncNews } from '@/lib/news'

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
        console.warn('Unauthorized attempt to trigger news sync.')
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    // 50秒の内部タイムバジェットを指定して実行
    const result = await syncNews({ deadlineBudgetMs: 50000 })

    return Response.json({
      success: true,
      message: `News feed synchronized successfully.`,
      addedCount: result.addedCount,
      recoveredCount: result.recoveredCount,
    })
  } catch (error) {
    console.error('Error in Cron Job /api/cron/fetch-news:', error)
    return Response.json(
      { error: 'Internal Server Error', details: String(error) },
      { status: 500 }
    )
  }
}
