import type { ImageFetchStatus } from '@prisma/client';
import {
  fetchOgImage,
  PermanentFetchError,
  updateImageStatus,
} from '../news';
import { prisma } from '../prisma';
import { RobotsTxtCache } from '../robots';
import {
  claimImageFetchLock,
  type ClaimLockInput,
} from './image-fetch-lock';

export interface ProcessImageFetchJobInput {
  newsItemId: string;
  link: string;
  messageId: string;
  now?: Date;
  timeoutMs?: number;
}

export interface ImageFetchJobDependencies {
  claimLock: (
    input: ClaimLockInput
  ) => Promise<{ acquired: boolean; count: number }>;
  getState: (itemId: string) => Promise<{
    imageFetchStatus: ImageFetchStatus;
    imageFetchMessageId: string | null;
  } | null>;
  isAllowed: (link: string) => Promise<boolean>;
  fetchImage: (link: string) => Promise<string | null>;
  updateStatus: (
    itemId: string,
    imageUrl: string | null,
    status: ImageFetchStatus
  ) => Promise<unknown>;
}

export type ImageFetchJobResult =
  | {
      kind: 'success';
      newsItemId: string;
      imageUrl: string;
    }
  | {
      kind: 'skipped';
      reason: 'lock_not_acquired';
      newsItemId: string;
      currentStatus: ImageFetchStatus | null;
      currentMessageId: string | null;
    }
  | {
      kind: 'not_found';
      newsItemId: string;
      imageUrl: null;
    }
  | {
      kind: 'failed';
      reason: 'disallowed_by_robots_txt';
      newsItemId: string;
    }
  | {
      kind: 'failed';
      reason: 'permanent_failure';
      newsItemId: string;
      details: string;
    };

const defaultDependencies: ImageFetchJobDependencies = {
  claimLock: claimImageFetchLock,
  getState: (itemId) => prisma.newsItem.findUnique({
    where: { id: itemId },
    select: {
      imageFetchStatus: true,
      imageFetchMessageId: true,
    },
  }),
  isAllowed: (link) => RobotsTxtCache.isAllowed(link),
  fetchImage: fetchOgImage,
  updateStatus: updateImageStatus,
};

export async function processImageFetchJob(
  input: ProcessImageFetchJobInput,
  dependencies: ImageFetchJobDependencies = defaultDependencies
): Promise<ImageFetchJobResult> {
  const lock = await dependencies.claimLock({
    itemId: input.newsItemId,
    messageId: input.messageId,
    now: input.now,
    timeoutMs: input.timeoutMs,
  });

  if (!lock.acquired) {
    const currentState = await dependencies.getState(input.newsItemId);
    return {
      kind: 'skipped',
      reason: 'lock_not_acquired',
      newsItemId: input.newsItemId,
      currentStatus: currentState?.imageFetchStatus ?? null,
      currentMessageId: currentState?.imageFetchMessageId ?? null,
    };
  }

  let isAllowed = true;
  try {
    isAllowed = await dependencies.isAllowed(input.link);
  } catch (error) {
    console.error(`[Image Fetch] Error checking robots.txt for ${input.link}:`, error);
  }

  if (!isAllowed) {
    await dependencies.updateStatus(input.newsItemId, null, 'FAILED');
    return {
      kind: 'failed',
      reason: 'disallowed_by_robots_txt',
      newsItemId: input.newsItemId,
    };
  }

  try {
    const imageUrl = await dependencies.fetchImage(input.link);

    if (!imageUrl) {
      await dependencies.updateStatus(input.newsItemId, null, 'NOT_FOUND');
      return {
        kind: 'not_found',
        newsItemId: input.newsItemId,
        imageUrl: null,
      };
    }

    await dependencies.updateStatus(input.newsItemId, imageUrl, 'SUCCESS');

    return {
      kind: 'success',
      newsItemId: input.newsItemId,
      imageUrl,
    };
  } catch (error) {
    if (error instanceof PermanentFetchError) {
      await dependencies.updateStatus(input.newsItemId, null, 'FAILED');
      return {
        kind: 'failed',
        reason: 'permanent_failure',
        newsItemId: input.newsItemId,
        details: error.message,
      };
    }

    throw error;
  }
}
