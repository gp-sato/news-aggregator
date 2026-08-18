import { prisma as defaultPrisma } from '../prisma';

export const DEFAULT_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface ClaimLockInput {
  itemId: string;
  messageId: string;
  timeoutMs?: number;
  now?: Date;
}

/**
 * Attempts to acquire or re-claim a PROCESSING lock for a NewsItem.
 * 
 * Succeeds if:
 * 1. Status is QUEUED
 * 2. Status is PROCESSING and messageId matches (same worker retry)
 * 3. Status is PROCESSING and lock has timed out (dead worker recovery)
 */
export async function claimImageFetchLock(
  input: ClaimLockInput,
  db = defaultPrisma
): Promise<{ acquired: boolean; count: number }> {
  const { itemId, messageId, timeoutMs = DEFAULT_PROCESSING_TIMEOUT_MS, now = new Date() } = input;
  const timeoutThreshold = new Date(now.getTime() - timeoutMs);

  const result = await db.newsItem.updateMany({
    where: {
      id: itemId,
      OR: [
        { imageFetchStatus: 'QUEUED' },
        { imageFetchStatus: 'PROCESSING', imageFetchMessageId: messageId },
        { imageFetchStatus: 'PROCESSING', imageFetchStartedAt: { lt: timeoutThreshold } },
      ],
    },
    data: {
      imageFetchStatus: 'PROCESSING',
      imageFetchStartedAt: now,
      imageFetchMessageId: messageId,
    },
  });

  return {
    acquired: result.count === 1,
    count: result.count,
  };
}
