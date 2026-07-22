/**
 * デバッグ用エンドポイント: OGP画像の手動取得
 * 本番環境では無効化されます。
 *
 * 使い方:
 * curl -X POST http://localhost:3000/api/debug/fetch-image \
 *   -H "Content-Type: application/json" \
 *   -d '{"newsItemId":"","link":""}'
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { RobotsTxtCache } from '@/lib/robots';
import { fetchOgImage, updateImageStatus } from '@/lib/news';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // 本番環境では無効化
  if (process.env.NODE_ENV === 'production') {
    return Response.json({ error: 'Not available in production' }, { status: 403 });
  }

  const body = await request.json();
  const { newsItemId, link } = body as { newsItemId: string; link: string };

  if (!newsItemId || !link) {
    return Response.json({ error: 'newsItemId and link are required' }, { status: 400 });
  }

  console.log(`[Debug] Processing image fetch for newsItemId: ${newsItemId}, link: ${link}`);

  // 1. 排他制御: QUEUED -> PROCESSING へ条件付き更新
  try {
    const updated = await prisma.newsItem.updateMany({
      where: {
        id: newsItemId,
        imageFetchStatus: 'QUEUED',
      },
      data: {
        imageFetchStatus: 'PROCESSING',
      },
    });

    if (updated.count === 0) {
      return Response.json({
        error: 'Item is not in QUEUED status (already processed or processing)',
        newsItemId,
      }, { status: 409 });
    }
  } catch (error) {
    console.error(`[Debug] Failed to update status to PROCESSING:`, error);
    return Response.json({ error: 'Failed to update status', details: String(error) }, { status: 500 });
  }

  // 2. robots.txt の確認
  try {
    const isAllowed = await RobotsTxtCache.isAllowed(link);
    if (!isAllowed) {
      console.log(`[Debug] Access to ${link} is disallowed by robots.txt`);
      await updateImageStatus(newsItemId, null, 'FAILED');
      return Response.json({
        status: 'failed',
        reason: 'disallowed_by_robots_txt',
        newsItemId,
      });
    }
  } catch (error) {
    console.error(`[Debug] Error checking robots.txt:`, error);
    // Fail Open: robots.txt チェックのエラーは続行
  }

  // 3. OGP画像の取得と更新
  try {
    const ogImageUrl = await fetchOgImage(link);
    if (ogImageUrl) {
      await updateImageStatus(newsItemId, ogImageUrl, 'SUCCESS');
      console.log(`[Debug] Successfully fetched image: ${ogImageUrl}`);
      return Response.json({
        status: 'success',
        newsItemId,
        imageUrl: ogImageUrl,
      });
    } else {
      await updateImageStatus(newsItemId, null, 'NOT_FOUND');
      console.log(`[Debug] No OGP image found`);
      return Response.json({
        status: 'not_found',
        newsItemId,
        imageUrl: null,
      });
    }
  } catch (error) {
    console.error(`[Debug] Failed to fetch OGP image:`, error);
    await updateImageStatus(newsItemId, null, 'FAILED');
    return Response.json({
      status: 'failed',
      reason: 'fetch_error',
      newsItemId,
      details: String(error),
    }, { status: 500 });
  }
}
