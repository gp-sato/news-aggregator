import { describe, expect, it, vi, beforeEach } from 'vitest';
import { enqueueImageFetch, calculateQueueDelay } from '../queue';

// Mock @vercel/queue
vi.mock('@vercel/queue', () => ({
  send: vi.fn(),
}));

import { send } from '@vercel/queue';

describe('calculateQueueDelay', () => {
  it('インデックスに基づいて適切な遅延を計算する', () => {
    expect(calculateQueueDelay(0, 'example.com')).toBe(0);
    expect(calculateQueueDelay(1, 'example.com')).toBe(2);
    expect(calculateQueueDelay(5, 'example.com')).toBe(10);
  });

  it('ドメイン引数を受け入れる（将来の拡張用）', () => {
    const delay = calculateQueueDelay(2, 'news.example.com');
    expect(delay).toBe(4);
  });
});

describe('enqueueImageFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('空の配列の場合は空の結果を返す', async () => {
    const result = await enqueueImageFetch([]);
    expect(result).toEqual({
      successCount: 0,
      failureCount: 0,
      failedIds: [],
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('すべての送信が成功した場合、成功件数を返す', async () => {
    vi.mocked(send).mockResolvedValue({ messageId: 'test-id' } as never);

    const items = [
      { id: 'item-1', link: 'https://example.com/article1' },
      { id: 'item-2', link: 'https://example.com/article2' },
    ];

    const result = await enqueueImageFetch(items);

    expect(result).toEqual({
      successCount: 2,
      failureCount: 0,
      failedIds: [],
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('一部の送信が失敗した場合、失敗情報を含めて返す', async () => {
    vi.mocked(send)
      .mockResolvedValueOnce({ messageId: 'test-id' } as never)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ messageId: 'test-id' } as never);

    const items = [
      { id: 'item-1', link: 'https://example.com/article1' },
      { id: 'item-2', link: 'https://example.com/article2' },
      { id: 'item-3', link: 'https://example.com/article3' },
    ];

    const result = await enqueueImageFetch(items);

    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(1);
    expect(result.failedIds).toEqual(['item-2']);
  });

  it('すべての送信が失敗した場合、すべてのIDを失敗リストに含める', async () => {
    vi.mocked(send).mockRejectedValue(new Error('Queue error'));

    const items = [
      { id: 'item-1', link: 'https://example.com/article1' },
      { id: 'item-2', link: 'https://example.com/article2' },
    ];

    const result = await enqueueImageFetch(items);

    expect(result).toEqual({
      successCount: 0,
      failureCount: 2,
      failedIds: ['item-1', 'item-2'],
    });
  });

  it('不正なURLの場合でもドメイン抽出をスキップして送信を試みる', async () => {
    vi.mocked(send).mockResolvedValue({ messageId: 'test-id' } as never);

    const items = [
      { id: 'item-1', link: 'not-a-valid-url' },
    ];

    const result = await enqueueImageFetch(items);

    expect(result.successCount).toBe(1);
    expect(send).toHaveBeenCalledWith(
      'image-fetch',
      { newsItemId: 'item-1', link: 'not-a-valid-url' },
      { delaySeconds: 0 }
    );
  });

  it('適切な遅延時間を計算して送信する', async () => {
    vi.mocked(send).mockResolvedValue({ messageId: 'test-id' } as never);

    const items = [
      { id: 'item-1', link: 'https://example.com/article1' },
      { id: 'item-2', link: 'https://example.com/article2' },
      { id: 'item-3', link: 'https://example.com/article3' },
    ];

    await enqueueImageFetch(items);

    expect(send).toHaveBeenNthCalledWith(
      1,
      'image-fetch',
      { newsItemId: 'item-1', link: 'https://example.com/article1' },
      { delaySeconds: 0 }
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      'image-fetch',
      { newsItemId: 'item-2', link: 'https://example.com/article2' },
      { delaySeconds: 2 }
    );
    expect(send).toHaveBeenNthCalledWith(
      3,
      'image-fetch',
      { newsItemId: 'item-3', link: 'https://example.com/article3' },
      { delaySeconds: 4 }
    );
  });
});
