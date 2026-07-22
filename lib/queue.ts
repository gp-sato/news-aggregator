import { send } from '@vercel/queue';

const QUEUE_DELAY_INTERVAL_SECONDS = 2; // 定数化（後から変更しやすくする）

/**
 * キューに投入する際のディレイ（秒）を計算します。
 * @param index キューへ投入する処理順インデックス
 * @param domain 記事URLのドメイン名（将来のドメイン単位のレート制限拡張用）
 */
export function calculateQueueDelay(index: number, domain: string): number {
  // 現時点では単純な delaySeconds = index * interval
  // 将来的にはドメイン単位のレート制限やランダムジッターに拡張しやすい設計にするため、ドメイン引数を受け取ります。
  return index * QUEUE_DELAY_INTERVAL_SECONDS;
}

/**
 * 指定されたニュース項目の一覧を Vercel Queues へ送信します。
 */
export async function enqueueImageFetch(newsItems: { id: string; link: string }[]) {
  if (newsItems.length === 0) return;

  const promises = newsItems.map(async (item, index) => {
    let domain = 'unknown';
    try {
      domain = new URL(item.link).hostname;
    } catch {
      // 不正なURLの場合はデフォルト値のまま
    }

    const delaySeconds = calculateQueueDelay(index, domain);

    try {
      // 'image-fetch' トピックにメッセージを送信
      await send('image-fetch', {
        newsItemId: item.id,
        link: item.link,
      }, {
        delaySeconds,
      });
      console.log(`Enqueued image fetch for newsItemId ${item.id} with ${delaySeconds}s delay.`);
    } catch (error) {
      console.error(`Failed to enqueue image fetch for newsItemId ${item.id}:`, error);
    }
  });

  await Promise.all(promises);
}
