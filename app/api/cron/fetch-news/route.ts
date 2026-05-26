import { NextRequest } from 'next/server'
import { syncNews } from '@/lib/news'

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

    // 同期処理の実行
    const result = await syncNews()

    return Response.json({
      success: true,
      message: `News feed synchronized successfully.`,
      addedCount: result.count,
    })
  } catch (error) {
    console.error('Error in Cron Job /api/cron/fetch-news:', error)
    return Response.json(
      { error: 'Internal Server Error', details: String(error) },
      { status: 500 }
    )
  }
}
