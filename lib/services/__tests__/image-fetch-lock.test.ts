import { describe, it, expect, beforeEach } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import type { prisma } from '../../prisma';
import { claimImageFetchLock } from '../image-fetch-lock';

type PrismaClient = typeof prisma;

const prismaMock = mockDeep<PrismaClient>();

describe('claimImageFetchLock', () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it('QUEUED・同一messageId・期限切れを原子的にclaimする', async () => {
    prismaMock.newsItem.updateMany.mockResolvedValue({ count: 1 });

    const now = new Date('2026-08-05T12:00:00.000Z');
    const timeoutMs = 60_000;
    const result = await claimImageFetchLock(
      {
        itemId: 'item-1',
        messageId: 'msg-retry-1',
        now,
        timeoutMs,
      },
      prismaMock
    );

    expect(result.acquired).toBe(true);
    expect(result.count).toBe(1);
    expect(prismaMock.newsItem.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'item-1',
        OR: [
          { imageFetchStatus: 'QUEUED' },
          { imageFetchStatus: 'PROCESSING', imageFetchMessageId: 'msg-retry-1' },
          {
            imageFetchStatus: 'PROCESSING',
            imageFetchStartedAt: {
              lt: new Date('2026-08-05T11:59:00.000Z'),
            },
          },
        ],
      },
      data: {
        imageFetchStatus: 'PROCESSING',
        imageFetchStartedAt: now,
        imageFetchMessageId: 'msg-retry-1',
      },
    });
  });

  it('条件に合う記事がなければclaim失敗を返す', async () => {
    prismaMock.newsItem.updateMany.mockResolvedValue({ count: 0 });

    const result = await claimImageFetchLock(
      {
        itemId: 'item-1',
        messageId: 'other-worker-msg-2',
        now: new Date('2026-08-05T12:00:00.000Z'),
      },
      prismaMock
    );

    expect(result.acquired).toBe(false);
    expect(result.count).toBe(0);
  });
});
