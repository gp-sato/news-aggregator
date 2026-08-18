/**
 * デバッグ用エンドポイント: OGP画像の手動取得
 * 本番環境では無効化されます。
 *
 * 使い方:
 * curl -X POST http://localhost:3000/api/debug/fetch-image \
 *   -H "Content-Type: application/json" \
 *   -d '{"newsItemId":"","link":""}'
 */
import type { NextRequest } from 'next/server';
import { processImageFetchJob } from '@/lib/services/process-image-fetch';

export const dynamic = 'force-dynamic';

interface DebugImageFetchRequest {
  newsItemId: string;
  link: string;
  messageId?: string;
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return Response.json({ error: 'Not available in production' }, { status: 403 });
  }

  const body = await request.json() as DebugImageFetchRequest;
  const { newsItemId, link, messageId } = body;

  if (!newsItemId || !link) {
    return Response.json(
      { error: 'newsItemId and link are required' },
      { status: 400 }
    );
  }

  console.log(`[Debug] Processing image fetch for newsItemId: ${newsItemId}, link: ${link}`);

  try {
    const result = await processImageFetchJob({
      newsItemId,
      link,
      messageId: messageId ?? 'debug-manual-trigger',
    });

    switch (result.kind) {
      case 'success':
        console.log(`[Debug] Successfully fetched image: ${result.imageUrl}`);
        return Response.json({
          status: 'success',
          newsItemId,
          imageUrl: result.imageUrl,
        });
      case 'not_found':
        console.log('[Debug] No OGP image found');
        return Response.json({
          status: 'not_found',
          newsItemId,
          imageUrl: null,
        });
      case 'failed':
        if (result.reason === 'disallowed_by_robots_txt') {
          return Response.json({
            status: 'failed',
            reason: result.reason,
            newsItemId,
          });
        }
        return Response.json(
          {
            status: 'failed',
            reason: result.reason,
            newsItemId,
            details: result.details,
          },
          { status: 400 }
        );
      case 'skipped':
        return Response.json(
          {
            error: 'Item cannot be locked for processing',
            currentStatus: result.currentStatus ?? 'NOT_FOUND',
            messageId: result.currentMessageId,
            newsItemId,
          },
          { status: 409 }
        );
    }
  } catch (error) {
    console.error('[Debug] Retryable image fetch error:', error);
    return Response.json(
      {
        status: 'retryable_error',
        newsItemId,
        details: String(error),
      },
      { status: 500 }
    );
  }
}
