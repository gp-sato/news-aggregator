import { handleCallback } from '@vercel/queue';
import { prisma } from '@/lib/prisma';
import { RobotsTxtCache } from '@/lib/robots';
import { fetchOgImage, updateImageStatus, PermanentFetchError } from '@/lib/news';

// PROCESSING のタイムアウト閾値 (5分)
const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;

export const POST = handleCallback(async (
  payload: { newsItemId: string; link: string },
  metadata
) => {
  const { newsItemId, link } = payload;
  const messageId = metadata?.messageId ?? null;
  const now = new Date();
  const expiredThreshold = new Date(now.getTime() - PROCESSING_TIMEOUT_MS);

  console.log(`[Queue Worker] Processing image fetch for newsItemId: ${newsItemId}, link: ${link}, messageId: ${messageId}`);

  // 1. 排他制御: QUEUED、同一 messageId の再配信、またはタイムアウトした PROCESSING から PROCESSING へ移行
  // DBエラーが発生した場合は catch せず throw することで Queue にリトライさせる
  const updated = await prisma.newsItem.updateMany({
    where: {
      id: newsItemId,
      OR: [
        { imageFetchStatus: 'QUEUED' },
        {
          imageFetchStatus: 'PROCESSING',
          imageFetchMessageId: messageId ?? undefined,
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
      imageFetchMessageId: messageId,
    },
  });

  if (updated.count === 0) {
    // 既に更新されなかった場合、現在のステータスを確認して安全にスキップ（ACK）
    const item = await prisma.newsItem.findUnique({
      where: { id: newsItemId },
      select: { imageFetchStatus: true, imageFetchMessageId: true },
    });

    if (item) {
      if (['SUCCESS', 'NOT_FOUND', 'FAILED'].includes(item.imageFetchStatus)) {
        console.log(`[Queue Worker] Item ${newsItemId} is already finished with status ${item.imageFetchStatus}. Skipping.`);
        return;
      }
      if (item.imageFetchStatus === 'PROCESSING') {
        console.log(`[Queue Worker] Item ${newsItemId} is currently being processed by another active worker (messageId: ${item.imageFetchMessageId}). Skipping.`);
        return;
      }
    }
    console.log(`[Queue Worker] Item ${newsItemId} not found or skipped.`);
    return;
  }

  // 2. robots.txt の確認
  try {
    const isAllowed = await RobotsTxtCache.isAllowed(link);
    if (!isAllowed) {
      console.log(`[Queue Worker] Access to ${link} is disallowed by robots.txt`);
      await updateImageStatus(newsItemId, null, 'FAILED');
      return;
    }
  } catch (error) {
    // robots.txt 判定自体のエラーは Fail Open として続行
    console.error(`[Queue Worker] Error checking robots.txt for ${link}:`, error);
  }

  // 3. OGP画像の取得と更新
  try {
    const ogImageUrl = await fetchOgImage(link);
    if (ogImageUrl) {
      await updateImageStatus(newsItemId, ogImageUrl, 'SUCCESS');
      console.log(`[Queue Worker] Successfully fetched image for newsItemId ${newsItemId}: ${ogImageUrl}`);
    } else {
      await updateImageStatus(newsItemId, null, 'NOT_FOUND');
      console.log(`[Queue Worker] No image found for newsItemId ${newsItemId}`);
    }
  } catch (error) {
    if (error instanceof PermanentFetchError) {
      console.error(`[Queue Worker] Permanent failure for ${link}:`, error.message);
      await updateImageStatus(newsItemId, null, 'FAILED');
      return; // ACK (再試行しない)
    }

    // 429, 5xx, タイムアウト, ネットワークエラー等の再試行可能な障害、または DB エラーは throw
    console.error(`[Queue Worker] Retryable error occurred for ${link}:`, error);
    throw error; // Queue にエラーを投げてリトライさせる
  }
});
