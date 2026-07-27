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
import { fetchOgImage, updateImageStatus, PermanentFetchError } from '@/lib/news';

export const dynamic = 'force-dynamic';

const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;

export async function POST(request: NextRequest) {
  // 本番環境では無効化
  if (process.env.NODE_ENV === 'production') {
    return Response.json({ error: 'Not available in production' }, { status: 403 });
  }

  const body = await request.json();
  const { newsItemId, link, messageId } = body as { newsItemId: string; link: string; messageId?: string };

  if (!newsItemId || !link) {
    return Response.json({ error: 'newsItemId and link are required' }, { status: 400 });
  }

  const debugMessageId = messageId ?? 'debug-manual-trigger';
  const now = new Date();
  const expiredThreshold = new Date(now.getTime() - PROCESSING_TIMEOUT_MS);

  console.log(`[Debug] Processing image fetch for newsItemId: ${newsItemId}, link: ${link}`);

  // 1. 排他制御: QUEUED, 同一 messageId, または タイムアウトした PROCESSING から PROCESSING へ更新
  try {
    const updated = await prisma.newsItem.updateMany({
      where: {
        id: newsItemId,
        OR: [
          { imageFetchStatus: 'QUEUED' },
          {
            imageFetchStatus: 'PROCESSING',
            imageFetchMessageId: debugMessageId,
          },
          {
            imageFetchStatus: 'PROCESSING',
            imageFetchStartedAt: { lt: expiredThreshold },
          },
        ],
      },
      data: {
        imageFetchStatus: 'PROCESSING',
        imageFetchStartedAt: now,
        imageFetchMessageId: debugMessageId,
      },
    });

    if (updated.count === 0) {
      const item = await prisma.newsItem.findUnique({
        where: { id: newsItemId },
        select: { imageFetchStatus: true, imageFetchMessageId: true },
      });

      return Response.json({
        error: 'Item cannot be locked for processing',
        currentStatus: item?.imageFetchStatus ?? 'NOT_FOUND',
        messageId: item?.imageFetchMessageId ?? null,
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
    if (error instanceof PermanentFetchError) {
      console.error(`[Debug] Permanent failure:`, error);
      await updateImageStatus(newsItemId, null, 'FAILED');
      return Response.json({
        status: 'failed',
        reason: 'permanent_failure',
        newsItemId,
        details: error.message,
      }, { status: 400 });
    }

    console.error(`[Debug] Retryable error:`, error);
    return Response.json({
      status: 'retryable_error',
      newsItemId,
      details: String(error),
    }, { status: 500 });
  }
}
