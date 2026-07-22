import { handleCallback } from '@vercel/queue';
import { prisma } from '@/lib/prisma';
import { RobotsTxtCache } from '@/lib/robots';
import { fetchOgImage, updateImageStatus } from '@/lib/news';

export const POST = handleCallback(async (payload: { newsItemId: string; link: string }) => {
  const { newsItemId, link } = payload;
  console.log(`[Queue Worker] Processing image fetch for newsItemId: ${newsItemId}, link: ${link}`);

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
      console.log(`[Queue Worker] Item ${newsItemId} is already processed or processing. Skipping.`);
      return;
    }
  } catch (error) {
    console.error(`[Queue Worker] Failed to update status to PROCESSING for newsItemId ${newsItemId}:`, error);
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
    console.error(`[Queue Worker] Failed to fetch OGP image for ${link}:`, error);
    await updateImageStatus(newsItemId, null, 'FAILED');
  }
});
