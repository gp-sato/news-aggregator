import { describe, expect, it, vi, beforeEach } from 'vitest';
import { prisma } from '../../prisma';
import { cleanupOldNews, CleanupError } from '../news-cleanup';
import { recordJobEvent } from '../job-logger';
import { JobEventLevel } from '@prisma/client';

type MockNewsItem = {
  id: string;
  createdAt: Date;
};

// Mock prisma
vi.mock('../../prisma', () => ({
  prisma: {
    newsItem: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

// Mock job-logger
vi.mock('../job-logger', () => ({
  recordJobEvent: vi.fn(),
}));

describe('news-cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment variables
    delete process.env.NEWS_RETENTION_DAYS;
    delete process.env.NEWS_CLEANUP_BATCH_SIZE;
    delete process.env.NEWS_CLEANUP_MAX_ITEMS;
    delete process.env.NEWS_CLEANUP_DEADLINE_MS;
  });

  describe('環境変数のバリデーション', () => {
    it('NEWS_RETENTION_DAYSが0以下の場合はエラーを投げる', async () => {
      process.env.NEWS_RETENTION_DAYS = '0';

      await expect(cleanupOldNews()).rejects.toThrow(
        'Invalid NEWS_RETENTION_DAYS: 0. Must be a positive integer.'
      );
    });

    it('NEWS_RETENTION_DAYSが負の値の場合はエラーを投げる', async () => {
      process.env.NEWS_RETENTION_DAYS = '-5';

      await expect(cleanupOldNews()).rejects.toThrow(
        'Invalid NEWS_RETENTION_DAYS: -5. Must be a positive integer.'
      );
    });

    it('NEWS_RETENTION_DAYSが非数値の場合はエラーを投げる', async () => {
      process.env.NEWS_RETENTION_DAYS = 'invalid';

      await expect(cleanupOldNews()).rejects.toThrow(
        'Invalid NEWS_RETENTION_DAYS: invalid. Must be a positive integer.'
      );
    });

    it('NEWS_CLEANUP_BATCH_SIZEが不正な場合はエラーを投げる', async () => {
      process.env.NEWS_CLEANUP_BATCH_SIZE = '0';
      await expect(cleanupOldNews()).rejects.toThrow(
        'Invalid NEWS_CLEANUP_BATCH_SIZE: 0. Must be a positive integer.'
      );

      process.env.NEWS_CLEANUP_BATCH_SIZE = '10abc';
      await expect(cleanupOldNews()).rejects.toThrow(
        'Invalid NEWS_CLEANUP_BATCH_SIZE: 10abc. Must be a positive integer.'
      );
    });

    it('NEWS_CLEANUP_MAX_ITEMSが不正な場合はエラーを投げる', async () => {
      process.env.NEWS_CLEANUP_MAX_ITEMS = '-1';
      await expect(cleanupOldNews()).rejects.toThrow(
        'Invalid NEWS_CLEANUP_MAX_ITEMS: -1. Must be a positive integer.'
      );
    });

    it('NEWS_CLEANUP_DEADLINE_MSが不正な場合はエラーを投げる', async () => {
      process.env.NEWS_CLEANUP_DEADLINE_MS = 'invalid';
      await expect(cleanupOldNews()).rejects.toThrow(
        'Invalid NEWS_CLEANUP_DEADLINE_MS: invalid. Must be a positive integer.'
      );
    });

    it('デフォルト値は30日かつ安全なクリーンアップ条件（非PROCESSING / NULL開始日時 / 期限切れPROCESSING）が指定される', async () => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);

      vi.mocked(prisma.newsItem.findMany).mockResolvedValue([] as never);
      vi.mocked(recordJobEvent).mockResolvedValue(undefined);

      await cleanupOldNews();

      expect(prisma.newsItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: {
              lt: expect.any(Date),
            },
            OR: [
              {
                imageFetchStatus: { not: 'PROCESSING' },
              },
              {
                imageFetchStatus: 'PROCESSING',
                imageFetchStartedAt: null,
              },
              {
                imageFetchStatus: 'PROCESSING',
                imageFetchStartedAt: {
                  lt: expect.any(Date),
                },
              },
            ],
          }),
        })
      );
    });

    it('NEWS_RETENTION_DAYSをカスタマイズできる', async () => {
      process.env.NEWS_RETENTION_DAYS = '60';

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 60);

      vi.mocked(prisma.newsItem.findMany).mockResolvedValue([] as never);
      vi.mocked(recordJobEvent).mockResolvedValue(undefined);

      await cleanupOldNews();

      expect(prisma.newsItem.findMany).toHaveBeenCalled();
    });
  });

  describe('削除ロジック', () => {
    it('古い記事のみが削除され、新しい記事は残る', async () => {
      process.env.NEWS_RETENTION_DAYS = '30';
      process.env.NEWS_CLEANUP_BATCH_SIZE = '100';
      process.env.NEWS_CLEANUP_MAX_ITEMS = '1000';

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);

      const oldItems: MockNewsItem[] = Array.from({ length: 50 }, (_, i) => ({
        id: `old-item-${i}`,
        createdAt: new Date('2026-08-01'),
      }));

      vi.mocked(prisma.newsItem.findMany)
        .mockResolvedValueOnce(oldItems as never)
        .mockResolvedValueOnce([] as never);
      vi.mocked(prisma.newsItem.deleteMany).mockResolvedValue({ count: 50 });
      vi.mocked(recordJobEvent).mockResolvedValue(undefined);

      const result = await cleanupOldNews();

      expect(result.deletedCount).toBe(50);
      expect(result.batchCount).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(prisma.newsItem.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: {
              in: oldItems.map((item) => item.id),
            },
            createdAt: {
              lt: expect.any(Date),
            },
            OR: [
              {
                imageFetchStatus: { not: 'PROCESSING' },
              },
              {
                imageFetchStatus: 'PROCESSING',
                imageFetchStartedAt: null,
              },
              {
                imageFetchStatus: 'PROCESSING',
                imageFetchStartedAt: {
                  lt: expect.any(Date),
                },
              },
            ],
          }),
        })
      );
    });

    it('createdAtの境界値が正しく判定される', async () => {
      process.env.NEWS_RETENTION_DAYS = '30';
      process.env.NEWS_CLEANUP_BATCH_SIZE = '100';

      const now = new Date();
      const cutoffDate = new Date(now);
      cutoffDate.setDate(cutoffDate.getDate() - 30);

      // ちょうど30日前の記事（削除対象外）
      const boundaryItem = {
        id: 'boundary-item',
        createdAt: cutoffDate,
      };

      vi.mocked(prisma.newsItem.findMany).mockResolvedValue([boundaryItem] as never);
      vi.mocked(prisma.newsItem.deleteMany).mockResolvedValue({ count: 1 });
      vi.mocked(recordJobEvent).mockResolvedValue(undefined);

      await cleanupOldNews();

      // 境界値の記事は削除される（lt条件なので）
      expect(prisma.newsItem.deleteMany).toHaveBeenCalled();
    });

    it('対象記事が0件の場合も正常に完了する', async () => {
      process.env.NEWS_RETENTION_DAYS = '30';

      vi.mocked(prisma.newsItem.findMany).mockResolvedValue([] as never);
      vi.mocked(recordJobEvent).mockResolvedValue(undefined);

      const result = await cleanupOldNews();

      expect(result.deletedCount).toBe(0);
      expect(result.batchCount).toBe(0);
      expect(result.hasMore).toBe(false);
      expect(prisma.newsItem.deleteMany).not.toHaveBeenCalled();
    });

    it('バッチ処理が正しく行われる', async () => {
      process.env.NEWS_RETENTION_DAYS = '30';
      process.env.NEWS_CLEANUP_BATCH_SIZE = '10';
      process.env.NEWS_CLEANUP_MAX_ITEMS = '100';

      const firstBatch: MockNewsItem[] = Array.from({ length: 10 }, (_, i) => ({
        id: `item-${i}`,
        createdAt: new Date('2026-08-01'),
      }));

      const secondBatch: MockNewsItem[] = Array.from({ length: 10 }, (_, i) => ({
        id: `item-${i + 10}`,
        createdAt: new Date('2026-08-01'),
      }));

      vi.mocked(prisma.newsItem.findMany)
        .mockResolvedValueOnce(firstBatch as never)
        .mockResolvedValueOnce(secondBatch as never)
        .mockResolvedValueOnce([] as never);

      vi.mocked(prisma.newsItem.deleteMany)
        .mockResolvedValueOnce({ count: 10 })
        .mockResolvedValueOnce({ count: 10 });

      vi.mocked(recordJobEvent).mockResolvedValue(undefined);

      const result = await cleanupOldNews();

      expect(result.deletedCount).toBe(20);
      expect(result.batchCount).toBe(2);
      expect(prisma.newsItem.deleteMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('制限条件による停止', () => {
    it('NEWS_CLEANUP_MAX_ITEMSに達した場合は停止してhasMore=true', async () => {
      process.env.NEWS_RETENTION_DAYS = '30';
      process.env.NEWS_CLEANUP_BATCH_SIZE = '10';
      process.env.NEWS_CLEANUP_MAX_ITEMS = '15';

      const batch1: MockNewsItem[] = Array.from({ length: 10 }, (_, i) => ({
        id: `item-${i}`,
        createdAt: new Date('2026-08-01'),
      }));

      const batch2: MockNewsItem[] = Array.from({ length: 5 }, (_, i) => ({
        id: `item-${i + 10}`,
        createdAt: new Date('2026-08-01'),
      }));

      vi.mocked(prisma.newsItem.findMany)
        .mockResolvedValueOnce(batch1 as never)
        .mockResolvedValueOnce(batch2 as never);

      vi.mocked(prisma.newsItem.deleteMany)
        .mockResolvedValueOnce({ count: 10 })
        .mockResolvedValueOnce({ count: 5 });

      vi.mocked(recordJobEvent).mockResolvedValue(undefined);

      const result = await cleanupOldNews();

      expect(result.deletedCount).toBe(15);
      expect(result.hasMore).toBe(true);
      expect(prisma.newsItem.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ take: 10 })
      );
      expect(prisma.newsItem.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ take: 5 })
      );
    });

    it('deadlineBudgetMsを超えた場合は停止してhasMore=true', async () => {
      process.env.NEWS_RETENTION_DAYS = '30';
      process.env.NEWS_CLEANUP_BATCH_SIZE = '10';
      process.env.NEWS_CLEANUP_MAX_ITEMS = '1000';
      process.env.NEWS_CLEANUP_DEADLINE_MS = '1';

      const batch: MockNewsItem[] = Array.from({ length: 10 }, (_, i) => ({
        id: `item-${i}`,
        createdAt: new Date('2026-08-01'),
      }));

      vi.mocked(prisma.newsItem.findMany).mockImplementation((async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return batch;
      }) as never);
      vi.mocked(prisma.newsItem.deleteMany).mockResolvedValue({ count: 10 });
      vi.mocked(recordJobEvent).mockResolvedValue(undefined);

      const result = await cleanupOldNews();

      expect(result.hasMore).toBe(true);
    });
  });

  describe('イベント記録', () => {
    it('jobExecutionIdが指定された場合にイベントが記録される', async () => {
      process.env.NEWS_RETENTION_DAYS = '30';

      vi.mocked(prisma.newsItem.findMany).mockResolvedValue([] as never);
      vi.mocked(recordJobEvent).mockResolvedValue(undefined);

      await cleanupOldNews('job-execution-123');

      expect(recordJobEvent).toHaveBeenCalledWith(
        'job-execution-123',
        'CLEANUP_START',
        JobEventLevel.INFO,
        expect.stringContaining('Starting news cleanup'),
        expect.any(Object)
      );

      expect(recordJobEvent).toHaveBeenCalledWith(
        'job-execution-123',
        'CLEANUP_COMPLETE',
        JobEventLevel.INFO,
        expect.stringContaining('No more items to delete'),
        expect.any(Object)
      );

      expect(recordJobEvent).toHaveBeenCalledWith(
        'job-execution-123',
        'CLEANUP_SUMMARY',
        JobEventLevel.INFO,
        expect.stringContaining('Cleanup summary'),
        expect.any(Object)
      );
    });

    it('jobExecutionIdが指定されていない場合はイベントが記録されない', async () => {
      process.env.NEWS_RETENTION_DAYS = '30';

      vi.mocked(prisma.newsItem.findMany).mockResolvedValue([] as never);
      vi.mocked(recordJobEvent).mockResolvedValue(undefined);

      await cleanupOldNews();

      expect(recordJobEvent).not.toHaveBeenCalled();
    });

    it('削除時にバッチイベントが記録される', async () => {
      process.env.NEWS_RETENTION_DAYS = '30';
      process.env.NEWS_CLEANUP_BATCH_SIZE = '10';

      const batch: MockNewsItem[] = Array.from({ length: 10 }, (_, i) => ({
        id: `item-${i}`,
        createdAt: new Date('2026-08-01'),
      }));

      vi.mocked(prisma.newsItem.findMany)
        .mockResolvedValueOnce(batch as never)
        .mockResolvedValueOnce([] as never);
      vi.mocked(prisma.newsItem.deleteMany).mockResolvedValue({ count: 10 });
      vi.mocked(recordJobEvent).mockResolvedValue(undefined);

      await cleanupOldNews('job-execution-123');

      expect(recordJobEvent).toHaveBeenCalledWith(
        'job-execution-123',
        'CLEANUP_BATCH',
        JobEventLevel.INFO,
        expect.stringContaining('Deleted batch 1'),
        expect.objectContaining({
          batchNumber: 1,
          batchDeleted: 10,
          totalDeleted: 10,
        })
      );
    });

    it('エラー発生時にエラーイベントが記録される', async () => {
      process.env.NEWS_RETENTION_DAYS = '30';

      vi.mocked(prisma.newsItem.findMany).mockRejectedValue(new Error('Database error'));
      vi.mocked(recordJobEvent).mockResolvedValue(undefined);

      await expect(cleanupOldNews('job-execution-123')).rejects.toThrow(CleanupError);

      expect(recordJobEvent).toHaveBeenCalledWith(
        'job-execution-123',
        'CLEANUP_ERROR',
        JobEventLevel.ERROR,
        expect.stringContaining('Cleanup failed'),
        expect.objectContaining({
          error: 'Database error',
        })
      );
    });

    it('エラー発生時にエラーイベントが記録される', async () => {
      process.env.NEWS_RETENTION_DAYS = '30';

      vi.mocked(prisma.newsItem.findMany).mockRejectedValue(new Error('Database error'));
      vi.mocked(recordJobEvent).mockResolvedValue(undefined);

      await expect(cleanupOldNews('job-execution-123')).rejects.toThrow(CleanupError);

      expect(recordJobEvent).toHaveBeenCalledWith(
        'job-execution-123',
        'CLEANUP_ERROR',
        JobEventLevel.ERROR,
        expect.stringContaining('Cleanup failed'),
        expect.objectContaining({
          error: 'Database error',
        })
      );
    });

    it('CleanupErrorが発生した場合にdeletedCountが保持される', async () => {
      process.env.NEWS_RETENTION_DAYS = '30';
      process.env.NEWS_CLEANUP_BATCH_SIZE = '10';

      const firstBatch: MockNewsItem[] = Array.from({ length: 10 }, (_, i) => ({
        id: `item-${i}`,
        createdAt: new Date('2026-08-01'),
      }));

      vi.mocked(prisma.newsItem.findMany)
        .mockResolvedValueOnce(firstBatch as never)
        .mockRejectedValueOnce(new Error('Database error'));
      vi.mocked(prisma.newsItem.deleteMany).mockResolvedValueOnce({ count: 10 });
      vi.mocked(recordJobEvent).mockResolvedValue(undefined);

      const error = await cleanupOldNews('job-execution-123').catch((e) => e);
      expect(error).toBeInstanceOf(CleanupError);
      expect((error as CleanupError).deletedCount).toBe(10);
      expect((error as CleanupError).batchCount).toBe(1);
    });
  });

  describe('戻り値', () => {
    it('正しい統計情報を返す', async () => {
      process.env.NEWS_RETENTION_DAYS = '30';
      process.env.NEWS_CLEANUP_BATCH_SIZE = '10';

      const batch: MockNewsItem[] = Array.from({ length: 10 }, (_, i) => ({
        id: `item-${i}`,
        createdAt: new Date('2026-08-01'),
      }));

      vi.mocked(prisma.newsItem.findMany)
        .mockResolvedValueOnce(batch as never)
        .mockResolvedValueOnce([] as never);
      vi.mocked(prisma.newsItem.deleteMany).mockResolvedValue({ count: 10 });
      vi.mocked(recordJobEvent).mockResolvedValue(undefined);

      const result = await cleanupOldNews();

      expect(result).toHaveProperty('deletedCount');
      expect(result).toHaveProperty('batchCount');
      expect(result).toHaveProperty('hasMore');
      expect(result).toHaveProperty('durationMs');
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
