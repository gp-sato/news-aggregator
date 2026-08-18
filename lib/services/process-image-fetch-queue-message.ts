import type { MessageMetadata } from '@vercel/queue';
import {
  processImageFetchJob,
  type ImageFetchJobDependencies,
} from './process-image-fetch';

export interface ImageFetchPayload {
  newsItemId: string;
  link: string;
}

export async function processImageFetchQueueMessage(
  payload: ImageFetchPayload,
  metadata: MessageMetadata,
  dependencies?: ImageFetchJobDependencies
): Promise<void> {
  const { newsItemId, link } = payload;
  const { messageId } = metadata;

  console.log(
    `[Queue Worker] Processing image fetch for newsItemId: ${newsItemId}, link: ${link}, messageId: ${messageId}`
  );

  try {
    const result = await processImageFetchJob(
      {
        newsItemId,
        link,
        messageId,
      },
      dependencies
    );

    switch (result.kind) {
      case 'success':
        console.log(
          `[Queue Worker] Successfully fetched image for newsItemId ${newsItemId}: ${result.imageUrl}`
        );
        return;
      case 'not_found':
        console.log(`[Queue Worker] No image found for newsItemId ${newsItemId}`);
        return;
      case 'failed':
        console.log(
          `[Queue Worker] Image fetch failed permanently for newsItemId ${newsItemId}: ${result.reason}`
        );
        return;
      case 'skipped':
        if (result.currentStatus === 'PROCESSING') {
          console.log(
            `[Queue Worker] Item ${newsItemId} is currently being processed by another active worker (messageId: ${result.currentMessageId}). Skipping.`
          );
          return;
        }
        if (
          result.currentStatus &&
          ['SUCCESS', 'NOT_FOUND', 'FAILED'].includes(result.currentStatus)
        ) {
          console.log(
            `[Queue Worker] Item ${newsItemId} is already finished with status ${result.currentStatus}. Skipping.`
          );
          return;
        }
        console.log(`[Queue Worker] Item ${newsItemId} not found or skipped.`);
        return;
    }
  } catch (error) {
    console.error(`[Queue Worker] Retryable error occurred for ${link}:`, error);
    throw error;
  }
}
