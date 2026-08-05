import { describe, expect, it } from 'vitest';
import type { ImageFetchStatus } from '@prisma/client';
import { PermanentFetchError, RetryableFetchError } from '../../news';
import { processImageFetchJob } from '../process-image-fetch';

describe('processImageFetchJob', () => {
  it('画像取得に成功すると記事をSUCCESSにする', async () => {
    const state: {
      status: ImageFetchStatus;
      messageId: string | null;
      imageUrl: string | null;
    } = {
      status: 'QUEUED',
      messageId: null,
      imageUrl: null,
    };

    const result = await processImageFetchJob(
      {
        newsItemId: 'item-1',
        link: 'https://example.com/article',
        messageId: 'message-1',
      },
      {
        claimLock: async ({ messageId }) => {
          state.status = 'PROCESSING';
          state.messageId = messageId;
          return { acquired: true, count: 1 };
        },
        getState: async () => ({
          imageFetchStatus: state.status,
          imageFetchMessageId: state.messageId,
        }),
        isAllowed: async () => true,
        fetchImage: async () => 'https://example.com/image.jpg',
        updateStatus: async (_itemId, imageUrl, status) => {
          state.status = status;
          state.imageUrl = imageUrl;
        },
      }
    );

    expect(result).toEqual({
      kind: 'success',
      newsItemId: 'item-1',
      imageUrl: 'https://example.com/image.jpg',
    });
    expect(state).toEqual({
      status: 'SUCCESS',
      messageId: 'message-1',
      imageUrl: 'https://example.com/image.jpg',
    });
  });

  it('別ワーカーが処理中なら画像取得を行わない', async () => {
    let imageFetchStarted = false;

    const result = await processImageFetchJob(
      {
        newsItemId: 'item-1',
        link: 'https://example.com/article',
        messageId: 'message-2',
      },
      {
        claimLock: async () => ({ acquired: false, count: 0 }),
        getState: async () => ({
          imageFetchStatus: 'PROCESSING',
          imageFetchMessageId: 'message-1',
        }),
        isAllowed: async () => true,
        fetchImage: async () => {
          imageFetchStarted = true;
          return 'https://example.com/image.jpg';
        },
        updateStatus: async () => undefined,
      }
    );

    expect(result).toEqual({
      kind: 'skipped',
      reason: 'lock_not_acquired',
      newsItemId: 'item-1',
      currentStatus: 'PROCESSING',
      currentMessageId: 'message-1',
    });
    expect(imageFetchStarted).toBe(false);
  });

  it('OGP画像がないときはNOT_FOUNDで完了する', async () => {
    let status: ImageFetchStatus = 'QUEUED';

    const result = await processImageFetchJob(
      {
        newsItemId: 'item-1',
        link: 'https://example.com/article',
        messageId: 'message-1',
      },
      {
        claimLock: async () => {
          status = 'PROCESSING';
          return { acquired: true, count: 1 };
        },
        getState: async () => null,
        isAllowed: async () => true,
        fetchImage: async () => null,
        updateStatus: async (_itemId, _imageUrl, nextStatus) => {
          status = nextStatus;
        },
      }
    );

    expect(result).toEqual({
      kind: 'not_found',
      newsItemId: 'item-1',
      imageUrl: null,
    });
    expect(status).toBe('NOT_FOUND');
  });

  it('robots.txtで拒否されたらHTMLを取得せずFAILEDにする', async () => {
    let status: ImageFetchStatus = 'QUEUED';
    let imageFetchStarted = false;

    const result = await processImageFetchJob(
      {
        newsItemId: 'item-1',
        link: 'https://example.com/article',
        messageId: 'message-1',
      },
      {
        claimLock: async () => {
          status = 'PROCESSING';
          return { acquired: true, count: 1 };
        },
        getState: async () => null,
        isAllowed: async () => false,
        fetchImage: async () => {
          imageFetchStarted = true;
          return 'https://example.com/image.jpg';
        },
        updateStatus: async (_itemId, _imageUrl, nextStatus) => {
          status = nextStatus;
        },
      }
    );

    expect(result).toEqual({
      kind: 'failed',
      reason: 'disallowed_by_robots_txt',
      newsItemId: 'item-1',
    });
    expect(status).toBe('FAILED');
    expect(imageFetchStarted).toBe(false);
  });

  it('恒久的な画像取得エラーはFAILEDで完了する', async () => {
    let status: ImageFetchStatus = 'QUEUED';

    const result = await processImageFetchJob(
      {
        newsItemId: 'item-1',
        link: 'invalid-url',
        messageId: 'message-1',
      },
      {
        claimLock: async () => {
          status = 'PROCESSING';
          return { acquired: true, count: 1 };
        },
        getState: async () => null,
        isAllowed: async () => true,
        fetchImage: async () => {
          throw new PermanentFetchError('Invalid URL format');
        },
        updateStatus: async (_itemId, _imageUrl, nextStatus) => {
          status = nextStatus;
        },
      }
    );

    expect(result).toEqual({
      kind: 'failed',
      reason: 'permanent_failure',
      newsItemId: 'item-1',
      details: 'Invalid URL format',
    });
    expect(status).toBe('FAILED');
  });

  it('robots.txtの確認に失敗しても画像取得を続行する', async () => {
    let status: ImageFetchStatus = 'QUEUED';

    const result = await processImageFetchJob(
      {
        newsItemId: 'item-1',
        link: 'https://example.com/article',
        messageId: 'message-1',
      },
      {
        claimLock: async () => {
          status = 'PROCESSING';
          return { acquired: true, count: 1 };
        },
        getState: async () => null,
        isAllowed: async () => {
          throw new Error('robots.txt request failed');
        },
        fetchImage: async () => 'https://example.com/image.jpg',
        updateStatus: async (_itemId, _imageUrl, nextStatus) => {
          status = nextStatus;
        },
      }
    );

    expect(result.kind).toBe('success');
    expect(status).toBe('SUCCESS');
  });

  it('一時障害でPROCESSINGのまま停止しても同じメッセージの再実行で完了する', async () => {
    const state: {
      status: ImageFetchStatus;
      messageId: string | null;
      imageUrl: string | null;
    } = {
      status: 'QUEUED',
      messageId: null,
      imageUrl: null,
    };
    const retryableError = new RetryableFetchError('temporary network failure');
    let fetchAttempts = 0;

    const dependencies = {
      claimLock: async ({ messageId }: { messageId: string }) => {
        const canClaim =
          state.status === 'QUEUED' ||
          (state.status === 'PROCESSING' && state.messageId === messageId);
        if (canClaim) {
          state.status = 'PROCESSING';
          state.messageId = messageId;
        }
        return { acquired: canClaim, count: canClaim ? 1 : 0 };
      },
      getState: async () => ({
        imageFetchStatus: state.status,
        imageFetchMessageId: state.messageId,
      }),
      isAllowed: async () => true,
      fetchImage: async () => {
        fetchAttempts += 1;
        if (fetchAttempts === 1) {
          throw retryableError;
        }
        return 'https://example.com/image.jpg';
      },
      updateStatus: async (
        _itemId: string,
        imageUrl: string | null,
        status: ImageFetchStatus
      ) => {
        state.status = status;
        state.imageUrl = imageUrl;
      },
    };
    const input = {
      newsItemId: 'item-1',
      link: 'https://example.com/article',
      messageId: 'message-1',
    };

    await expect(processImageFetchJob(input, dependencies)).rejects.toBe(retryableError);
    expect(state.status).toBe('PROCESSING');

    const result = await processImageFetchJob(input, dependencies);

    expect(result.kind).toBe('success');
    expect(state).toEqual({
      status: 'SUCCESS',
      messageId: 'message-1',
      imageUrl: 'https://example.com/image.jpg',
    });
    expect(fetchAttempts).toBe(2);
  });
});
