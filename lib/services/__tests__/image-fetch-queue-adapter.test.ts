import { describe, expect, it } from 'vitest';
import type { MessageMetadata } from '@vercel/queue';
import { RetryableFetchError } from '../../news';
import type { ImageFetchJobDependencies } from '../process-image-fetch';
import { processImageFetchQueueMessage } from '../process-image-fetch-queue-message';

describe('processImageFetchQueueMessage', () => {
  it('一時障害を握り潰さずQueueの再配信対象にする', async () => {
    const retryableError = new RetryableFetchError('temporary network failure');
    const dependencies: ImageFetchJobDependencies = {
      claimLock: async () => ({ acquired: true, count: 1 }),
      getState: async () => null,
      isAllowed: async () => true,
      fetchImage: async () => {
        throw retryableError;
      },
      updateStatus: async () => undefined,
    };
    const metadata: MessageMetadata = {
      messageId: 'message-1',
      deliveryCount: 2,
      createdAt: new Date('2026-08-05T00:00:00.000Z'),
      expiresAt: new Date('2026-08-05T01:00:00.000Z'),
      topicName: 'image-fetch',
      consumerGroup: 'image-fetch-consumer',
      region: 'iad1',
    };

    await expect(
      processImageFetchQueueMessage(
        {
          newsItemId: 'item-1',
          link: 'https://example.com/article',
        },
        metadata,
        dependencies
      )
    ).rejects.toBe(retryableError);
  });
});
