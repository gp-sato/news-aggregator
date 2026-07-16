import { NextRequest } from 'next/server'
import { processPendingNewsImages } from '@/lib/news'

export const dynamic = 'force-dynamic'

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
        console.warn('Unauthorized attempt to trigger image fetch.')
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    // 画像取得バッチ処理の実行
    const result = await processPendingNewsImages()

    return Response.json({
      success: true,
      message: `Image fetch completed.`,
      ...result,
    })
  } catch (error) {
    console.error('Error in Cron Job /api/cron/fetch-images:', error)
    return Response.json(
      { error: 'Internal Server Error', details: String(error) },
      { status: 500 }
    )
  }
}
