import { NextRequest, NextResponse } from 'next/server';
import { getNewsFromDb } from '@/lib/news';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') || 'all';
  const source = searchParams.get('source') || 'all';
  const query = searchParams.get('q') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '20', 10);

  // Validate parameters
  const validatedPage = Math.max(1, isNaN(page) ? 1 : page);
  const validatedLimit = Math.max(1, Math.min(100, isNaN(limit) ? 20 : limit));

  const skip = (validatedPage - 1) * validatedLimit;

  try {
    const items = await getNewsFromDb({
      category,
      source: source !== 'all' ? source : undefined,
      query,
      skip,
      take: validatedLimit,
    });

    const cacheControl = process.env.NODE_ENV === 'production'
      ? 'public, s-maxage=60, stale-while-revalidate=30'
      : 'no-store, max-age=0, must-revalidate';

    return NextResponse.json(items, {
      headers: {
        'Cache-Control': cacheControl,
      },
    });
  } catch (error) {
    console.error('Failed to fetch news in API route:', error);
    return NextResponse.json({ error: 'Failed to fetch news items' }, { status: 500 });
  }
}
