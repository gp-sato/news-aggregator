import { send } from '@vercel/queue';

const QUEUE_DELAY_INTERVAL_SECONDS = 2; // 定数化（後から変更しやすくする）

/**
 * キュー投入の結果を表すインターフェース
 */
export interface EnqueueResult {
  successCount: number;
  failureCount: number;
  failedIds: string[];
}

/**
 * キューに投入する際のディレイ（秒）を計算します。
 * @param index キューへ投入する処理順インデックス
 * @param domain 記事URLのドメイン名（将来のドメイン単位のレート制限拡張用）
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function calculateQueueDelay(index: number, _domain: string): number {
  // 現時点では単純な delaySeconds = index * interval
  // 将来的にはドメイン単位のレート制限やランダムジッターに拡張しやすい設計にするため、ドメイン引数を受け取ります。
  return index * QUEUE_DELAY_INTERVAL_SECONDS;
}

/**
 * 指定されたニュース項目の一覧を Vercel Queues へ送信します。
 * @returns 成功件数、失敗件数、失敗した記事IDの一覧を含む結果オブジェクト
 */
export async function enqueueImageFetch(newsItems: { id: string; link: string }[]): Promise<EnqueueResult> {
  if (newsItems.length === 0) {
    return { successCount: 0, failureCount: 0, failedIds: [] };
  }

  const CHUNK_SIZE = 10; // チャンク分割サイズ
  const allResults: Array<PromiseSettledResult<{ id: string; success: boolean }>> = [];

  // チャンク分割並列送信
  for (let i = 0; i < newsItems.length; i += CHUNK_SIZE) {
    const chunk = newsItems.slice(i, i + CHUNK_SIZE);
    const chunkResults = await Promise.allSettled(
      chunk.map(async (item, chunkIndex) => {
        const globalIndex = i + chunkIndex;
        let domain = 'unknown';
        try {
          domain = new URL(item.link).hostname;
        } catch {
          // 不正なURLの場合はデフォルト値のまま
        }

        const delaySeconds = calculateQueueDelay(globalIndex, domain);

        // 'image-fetch' トピックにメッセージを送信
        await send('image-fetch', {
          newsItemId: item.id,
          link: item.link,
        }, {
          delaySeconds,
        });
        console.log(`Enqueued image fetch for newsItemId ${item.id} with ${delaySeconds}s delay.`);
        return { id: item.id, success: true };
      })
    );
    allResults.push(...chunkResults);
  }

  const successCount = allResults.filter((r) => r.status === 'fulfilled').length;
  const failureCount = allResults.length - successCount;
  const failedIds: string[] = [];

  allResults.forEach((result, index) => {
    if (result.status === 'rejected') {
      const failedId = newsItems[index].id;
      failedIds.push(failedId);
      console.error(`Failed to enqueue image fetch for newsItemId ${failedId}:`, result.reason);
    }
  });

  return { successCount, failureCount, failedIds };
}
