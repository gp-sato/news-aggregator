import { describe, expect, it, vi, beforeEach } from 'vitest';
import { prisma } from '../../prisma';
import {
  startJobExecution,
  completeJobExecution,
  failJobExecution,
  recordFeedSyncExecutions,
  recordJobEvent,
  cleanupOldJobExecutions,
} from '../job-logger';
import { JobType, JobEventLevel } from '@prisma/client';

// Mock prisma
vi.mock('../../prisma', () => ({
  prisma: {
    jobExecution: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    feedSyncExecution: {
      createMany: vi.fn(),
    },
    jobEvent: {
      create: vi.fn(),
    },
  },
}));

describe('job-logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('startJobExecution', () => {
    it('JobExecutionレコードを作成し、IDを返す', async () => {
      const mockJobExecution = {
        id: 'job-execution-1',
        jobType: JobType.RSS_SYNC,
        status: 'RUNNING',
        triggerSource: 'cron',
        startedAt: new Date(),
      };

      vi.mocked(prisma.jobExecution.create).mockResolvedValue(mockJobExecution as never);

      const jobExecutionId = await startJobExecution(JobType.RSS_SYNC, 'cron');

      expect(jobExecutionId).toBe('job-execution-1');
      expect(prisma.jobExecution.create).toHaveBeenCalledWith({
        data: {
          jobType: JobType.RSS_SYNC,
          status: 'RUNNING',
          triggerSource: 'cron',
          startedAt: expect.any(Date),
        },
      });
    });

    it('triggerSourceを省略できる', async () => {
      const mockJobExecution = {
        id: 'job-execution-2',
        jobType: JobType.MANUAL_SYNC,
        status: 'RUNNING',
        triggerSource: null,
        startedAt: new Date(),
      };

      vi.mocked(prisma.jobExecution.create).mockResolvedValue(mockJobExecution as never);

      const jobExecutionId = await startJobExecution(JobType.MANUAL_SYNC);

      expect(jobExecutionId).toBe('job-execution-2');
      expect(prisma.jobExecution.create).toHaveBeenCalledWith({
        data: {
          jobType: JobType.MANUAL_SYNC,
          status: 'RUNNING',
          triggerSource: undefined,
          startedAt: expect.any(Date),
        },
      });
    });

    it('DBエラー時はnullを返し、例外を投げない', async () => {
      vi.mocked(prisma.jobExecution.create).mockRejectedValue(new Error('DB connection failed'));

      const jobExecutionId = await startJobExecution(JobType.RSS_SYNC);

      expect(jobExecutionId).toBeNull();
    });
  });

  describe('completeJobExecution', () => {
    it('idがnullの場合は何もしない', async () => {
      await expect(completeJobExecution(null, {})).resolves.not.toThrow();
      expect(prisma.jobExecution.update).not.toHaveBeenCalled();
    });

    it('DB更新エラーが発生しても例外を投げない', async () => {
      vi.mocked(prisma.jobExecution.findUnique).mockResolvedValue({
        startedAt: new Date(),
      } as never);
      vi.mocked(prisma.jobExecution.update).mockRejectedValue(new Error('Update failed'));

      await expect(
        completeJobExecution('job-execution-1', { feedTotalCount: 1 })
      ).resolves.not.toThrow();
    });
    it('成功時はSUCCESSステータスで完了する', async () => {
      const startedAt = new Date('2026-08-28T10:00:00Z');
      vi.mocked(prisma.jobExecution.findUnique).mockResolvedValue({
        startedAt,
      } as never);

      await completeJobExecution('job-execution-1', {
        feedTotalCount: 10,
        feedSuccessCount: 10,
        feedFailureCount: 0,
        itemsFound: 50,
        itemsCreated: 30,
        itemsSkipped: 20,
        queuedCount: 30,
        queueFailureCount: 0,
        recoveredQueuedCount: 5,
      });

      expect(prisma.jobExecution.update).toHaveBeenCalledWith({
        where: { id: 'job-execution-1' },
        data: expect.objectContaining({
          status: 'SUCCESS',
          finishedAt: expect.any(Date),
          durationMs: expect.any(Number),
          feedTotalCount: 10,
          feedSuccessCount: 10,
          feedFailureCount: 0,
          itemsFound: 50,
          itemsCreated: 30,
          itemsSkipped: 20,
          queuedCount: 30,
          queueFailureCount: 0,
          recoveredQueuedCount: 5,
        }),
      });
    });

    it('失敗がある場合はPARTIAL_SUCCESSステータスで完了する', async () => {
      const startedAt = new Date('2026-08-28T10:00:00Z');
      vi.mocked(prisma.jobExecution.findUnique).mockResolvedValue({
        startedAt,
      } as never);

      await completeJobExecution('job-execution-1', {
        feedTotalCount: 10,
        feedSuccessCount: 8,
        feedFailureCount: 2,
        itemsFound: 50,
        itemsCreated: 30,
        itemsSkipped: 20,
        queuedCount: 30,
        queueFailureCount: 5,
        recoveredQueuedCount: 5,
      });

      expect(prisma.jobExecution.update).toHaveBeenCalledWith({
        where: { id: 'job-execution-1' },
        data: expect.objectContaining({
          status: 'PARTIAL_SUCCESS',
        }),
      });
    });
  });

  describe('failJobExecution', () => {
    it('idがnullの場合は何もしない', async () => {
      await expect(failJobExecution(null, new Error('Test error'))).resolves.not.toThrow();
      expect(prisma.jobExecution.update).not.toHaveBeenCalled();
    });

    it('DB更新エラーが発生しても例外を投げない', async () => {
      vi.mocked(prisma.jobExecution.findUnique).mockResolvedValue({
        startedAt: new Date(),
      } as never);
      vi.mocked(prisma.jobExecution.update).mockRejectedValue(new Error('Update failed'));

      await expect(
        failJobExecution('job-execution-1', new Error('Test error'))
      ).resolves.not.toThrow();
    });

    it('通常エラーはFAILEDステータスで失敗する', async () => {
      const startedAt = new Date('2026-08-28T10:00:00Z');
      vi.mocked(prisma.jobExecution.findUnique).mockResolvedValue({
        startedAt,
      } as never);

      const error = new Error('Database connection failed');

      await failJobExecution('job-execution-1', error, {
        feedTotalCount: 0,
        feedSuccessCount: 0,
        feedFailureCount: 0,
        itemsFound: 0,
        itemsCreated: 0,
        itemsSkipped: 0,
        queuedCount: 0,
        queueFailureCount: 0,
        recoveredQueuedCount: 0,
      });

      expect(prisma.jobExecution.update).toHaveBeenCalledWith({
        where: { id: 'job-execution-1' },
        data: expect.objectContaining({
          status: 'FAILED',
          errorCode: 'Error',
          errorMessage: 'Database connection failed',
          errorStack: expect.any(String),
        }),
      });
    });

    it('タイムアウトエラーはTIMEOUTステータスで失敗する', async () => {
      const startedAt = new Date('2026-08-28T10:00:00Z');
      vi.mocked(prisma.jobExecution.findUnique).mockResolvedValue({
        startedAt,
      } as never);

      const timeoutError = new Error('Request timeout');
      timeoutError.name = 'AbortError';

      await failJobExecution('job-execution-1', timeoutError);

      expect(prisma.jobExecution.update).toHaveBeenCalledWith({
        where: { id: 'job-execution-1' },
        data: expect.objectContaining({
          status: 'TIMEOUT',
          errorCode: 'AbortError',
        }),
      });
    });
  });

  describe('recordFeedSyncExecutions', () => {
    it('jobExecutionIdがnullの場合は何もしない', async () => {
      await recordFeedSyncExecutions(null, [
        {
          sourceId: 'source-1',
          sourceName: 'Source 1',
          sourceUrl: 'https://example.com/feed1.xml',
          status: 'SUCCESS' as const,
          durationMs: 100,
          itemsFound: 5,
        },
      ]);

      expect(prisma.feedSyncExecution.createMany).not.toHaveBeenCalled();
    });

    it('Feed同期結果を一括記録する', async () => {
      vi.mocked(prisma.feedSyncExecution.createMany).mockResolvedValue({ count: 2 } as never);

      const feedResults = [
        {
          sourceId: 'source-1',
          sourceName: 'Source 1',
          sourceUrl: 'https://example.com/feed1.xml',
          status: 'SUCCESS' as const,
          httpStatus: 200,
          durationMs: 1000,
          itemsFound: 10,
          itemsCreated: 8,
        },
        {
          sourceId: 'source-2',
          sourceName: 'Source 2',
          sourceUrl: 'https://example.com/feed2.xml',
          status: 'FAILED' as const,
          httpStatus: 500,
          durationMs: 2000,
          itemsFound: 0,
          itemsCreated: 0,
          errorCode: 'HTTP_ERROR',
          errorMessage: 'Internal Server Error',
        },
      ];

      await recordFeedSyncExecutions('job-execution-1', feedResults);

      expect(prisma.feedSyncExecution.createMany).toHaveBeenCalledWith({
        data: [
          {
            jobExecutionId: 'job-execution-1',
            sourceId: 'source-1',
            sourceName: 'Source 1',
            sourceUrl: 'https://example.com/feed1.xml',
            status: 'SUCCESS',
            httpStatus: 200,
            durationMs: 1000,
            itemsFound: 10,
            itemsCreated: 8,
            errorCode: undefined,
            errorMessage: undefined,
          },
          {
            jobExecutionId: 'job-execution-1',
            sourceId: 'source-2',
            sourceName: 'Source 2',
            sourceUrl: 'https://example.com/feed2.xml',
            status: 'FAILED',
            httpStatus: 500,
            durationMs: 2000,
            itemsFound: 0,
            itemsCreated: 0,
            errorCode: 'HTTP_ERROR',
            errorMessage: 'Internal Server Error',
          },
        ],
      });
    });

    it('空配列の場合は何もしない', async () => {
      await recordFeedSyncExecutions('job-execution-1', []);

      expect(prisma.feedSyncExecution.createMany).not.toHaveBeenCalled();
    });

    it('DBエラーが発生しても例外を投げない', async () => {
      vi.mocked(prisma.feedSyncExecution.createMany).mockRejectedValue(
        new Error('Database error')
      );

      const feedResults = [
        {
          sourceId: 'source-1',
          sourceName: 'Source 1',
          sourceUrl: 'https://example.com/feed1.xml',
          status: 'SUCCESS' as const,
          httpStatus: 200,
          durationMs: 1000,
          itemsFound: 10,
          itemsCreated: 8,
        },
      ];

      await expect(
        recordFeedSyncExecutions('job-execution-1', feedResults)
      ).resolves.not.toThrow();
    });
  });

  describe('recordJobEvent', () => {
    it('jobExecutionIdがnullの場合は何もしない', async () => {
      await recordJobEvent(null, 'TEST_EVENT', JobEventLevel.INFO, 'Test message');

      expect(prisma.jobEvent.create).not.toHaveBeenCalled();
    });

    it('イベントを記録する', async () => {
      vi.mocked(prisma.jobEvent.create).mockResolvedValue({} as never);

      await recordJobEvent(
        'job-execution-1',
        'FEED_FAILURE',
        JobEventLevel.WARN,
        '2 feeds failed to sync',
        { feedFailureCount: 2 }
      );

      expect(prisma.jobEvent.create).toHaveBeenCalledWith({
        data: {
          jobExecutionId: 'job-execution-1',
          eventType: 'FEED_FAILURE',
          level: JobEventLevel.WARN,
          message: '2 feeds failed to sync',
          metadata: { feedFailureCount: 2 },
        },
      });
    });

    it('metadataを省略できる', async () => {
      vi.mocked(prisma.jobEvent.create).mockResolvedValue({} as never);

      await recordJobEvent(
        'job-execution-1',
        'JOB_STARTED',
        JobEventLevel.INFO,
        'Job started'
      );

      expect(prisma.jobEvent.create).toHaveBeenCalledWith({
        data: {
          jobExecutionId: 'job-execution-1',
          eventType: 'JOB_STARTED',
          level: JobEventLevel.INFO,
          message: 'Job started',
          metadata: undefined,
        },
      });
    });

    it('DBエラーが発生しても例外を投げない', async () => {
      vi.mocked(prisma.jobEvent.create).mockRejectedValue(
        new Error('Database error')
      );

      await expect(
        recordJobEvent(
          'job-execution-1',
          'TEST_EVENT',
          JobEventLevel.INFO,
          'Test message'
        )
      ).resolves.not.toThrow();
    });
  });

  describe('cleanupOldJobExecutions', () => {
    it('指定日数より古いJobExecutionを削除する', async () => {
      vi.mocked(prisma.jobExecution.deleteMany).mockResolvedValue({ count: 10 } as never);

      const deletedCount = await cleanupOldJobExecutions(60);

      expect(deletedCount).toBe(10);
      expect(prisma.jobExecution.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: {
            lt: expect.any(Date),
          },
        },
      });
    });

    it('デフォルトの保持期間は60日', async () => {
      vi.mocked(prisma.jobExecution.deleteMany).mockResolvedValue({ count: 5 } as never);

      await cleanupOldJobExecutions();

      expect(prisma.jobExecution.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: {
            lt: expect.any(Date),
          },
        },
      });
    });

    it('DBエラーが発生すると例外を投げる', async () => {
      vi.mocked(prisma.jobExecution.deleteMany).mockRejectedValue(
        new Error('Database error')
      );

      await expect(cleanupOldJobExecutions(30)).rejects.toThrow('Database error');
    });
  });
});
