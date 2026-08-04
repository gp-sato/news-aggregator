import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockDeep, mockReset, DeepMockProxy } from 'vitest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { claimImageFetchLock, DEFAULT_PROCESSING_TIMEOUT_MS } from '../image-fetch-lock';

// Create deep mock of PrismaClient
const prismaMock = mockDeep<PrismaClient>();

describe('claimImageFetchLock', () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it('Case 1: Should grant lock when messageId matches (same message retry)', async () => {
    prismaMock.newsItem.updateMany.mockResolvedValue({ count: 1 });

    const now = new Date();
    const result = await claimImageFetchLock(
      {
        itemId: 'item-1',
        messageId: 'msg-retry-1',
        now,
      },
      prismaMock as unknown as typeof import('../../prisma').prisma
    );

    expect(result.acquired).toBe(true);
    expect(result.count).toBe(1);
    expect(prismaMock.newsItem.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'item-1',
        OR: [
          { imageFetchStatus: 'QUEUED' },
          { imageFetchStatus: 'PROCESSING', imageFetchMessageId: 'msg-retry-1' },
          { imageFetchStatus: 'PROCESSING', imageFetchStartedAt: { lt: expect.any(Date) } },
        ],
      },
      data: {
        imageFetchStatus: 'PROCESSING',
        imageFetchStartedAt: now,
        imageFetchMessageId: 'msg-retry-1',
      },
    });
  });

  it('Case 2: Should recover lock from abandoned/timed-out worker', async () => {
    prismaMock.newsItem.updateMany.mockResolvedValue({ count: 1 });

    const now = new Date();
    const result = await claimImageFetchLock(
      {
        itemId: 'item-1',
        messageId: 'new-worker-msg-100',
        now,
      },
      prismaMock as unknown as typeof import('../../prisma').prisma
    );

    expect(result.acquired).toBe(true);
    expect(prismaMock.newsItem.updateMany).toHaveBeenCalledOnce();
  });

  it('Case 3: Should refuse lock when another worker is actively processing', async () => {
    // DB returns 0 count when update conditions are not met
    prismaMock.newsItem.updateMany.mockResolvedValue({ count: 0 });

    const now = new Date();
    const result = await claimImageFetchLock(
      {
        itemId: 'item-1',
        messageId: 'other-worker-msg-2',
        now,
      },
      prismaMock as unknown as typeof import('../../prisma').prisma
    );

    expect(result.acquired).toBe(false);
    expect(result.count).toBe(0);
  });
});
