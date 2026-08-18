import { handleCallback } from '@vercel/queue';
import {
  processImageFetchQueueMessage,
  type ImageFetchPayload,
} from '@/lib/services/process-image-fetch-queue-message';

export const POST = handleCallback<ImageFetchPayload>(processImageFetchQueueMessage);
