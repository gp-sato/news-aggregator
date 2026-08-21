import { send } from '@vercel/queue';

const QUEUE_DELAY_INTERVAL_SECONDS = 2; // 定数化（後から変更しやすくする）
const DEFAULT_SEND_TIMEOUT_MS = 5000; // 1送信あたり最大5秒

/**
 * キュー投入の結果を表すインターフェース
 */
export interface EnqueueResult {
  successCount: number;
  failureCount: number;
  failedIds: string[];
}

export interface EnqueueOptions {
  timeoutMs?: number;
  deadline?: number; // Date.now() + 残り予算ミリ秒
}

/**
 * Promiseにタイムアウトを設定するラッパー
 */
async function sendWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage = 'Queue send timed out'
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(errorMessage);
      err.name = 'TimeoutError';
      reject(err);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
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
export async function enqueueImageFetch(
  newsItems: { id: string; link: string }[],
  options: EnqueueOptions = {}
): Promise<EnqueueResult> {
  if (newsItems.length === 0) {
    return { successCount: 0, failureCount: 0, failedIds: [] };
  }

  const { timeoutMs = DEFAULT_SEND_TIMEOUT_MS, deadline } = options;
  const CHUNK_SIZE = 10;
  const allResults: Array<PromiseSettledResult<{ id: string; success: boolean }>> = [];

  for (let i = 0; i < newsItems.length; i += CHUNK_SIZE) {
    // 全体締切（予算）をチェック: 残り時間が少なければ後続チャンクを中断
    if (deadline && Date.now() >= deadline) {
      console.warn(`[Queue Enqueue] Deadline reached at chunk starting index ${i}. Remaining items left in QUEUED state.`);
      // 残り全件を失敗（スキップ）として記録
      for (let j = i; j < newsItems.length; j++) {
        allResults.push({
          status: 'rejected',
          reason: new Error('Execution deadline exceeded; remaining items left for sweeper'),
        });
      }
      break;
    }

    const chunk = newsItems.slice(i, i + CHUNK_SIZE);
    const chunkResults = await Promise.allSettled(
      chunk.map(async (item, chunkIndex) => {
        const globalIndex = i + chunkIndex;
        let domain = 'unknown';
        try {
          domain = new URL(item.link).hostname;
        } catch {
          // 不正URLはデフォルト値のまま
        }

        const delaySeconds = calculateQueueDelay(globalIndex, domain);

        // タイムアウト付きで send 実行 & idempotencyKey を付与
        await sendWithTimeout(
          send(
            'image-fetch',
            {
              newsItemId: item.id,
              link: item.link,
            },
            {
              delaySeconds,
              idempotencyKey: `image-fetch-${item.id}`,
            }
          ),
          timeoutMs,
          `Send timed out for item ${item.id}`
        );

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
