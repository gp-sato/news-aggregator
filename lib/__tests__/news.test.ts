import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../prisma';

// Mock prisma
vi.mock('../prisma', () => ({
  prisma: {
    newsItem: {
      findMany: vi.fn(),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    source: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    newsItemCategory: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn().mockImplementation(async (callback) => {
      return callback(prisma);
    }),
  },
}));

// Mock queue
vi.mock('../queue', () => ({
  enqueueImageFetch: vi.fn(),
}));

import { fetchRssFeeds, recoverOrphanedQueuedItems, saveNewsToDb, syncNews, shouldRetryFetchError, fetchSingleRssFeed, HttpError } from '../news';
import { enqueueImageFetch } from '../queue';
import Parser from 'rss-parser';

describe('recoverOrphanedQueuedItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('孤立したQUEUEDアイテムが存在しない場合、回収数0を返す', async () => {
    vi.mocked(prisma.newsItem.findMany).mockResolvedValue([]);

    const result = await recoverOrphanedQueuedItems();

    expect(result).toEqual({ recoveredCount: 0, queueFailureCount: 0, errors: [], errorDetails: [] });
    expect(prisma.newsItem.findMany).toHaveBeenCalledWith({
      where: {
        imageFetchStatus: 'QUEUED',
        updatedAt: {
          lt: expect.any(Date),
        },
      },
      select: {
        id: true,
        link: true,
        updatedAt: true,
      },
      take: 50,
      orderBy: {
        updatedAt: 'asc',
      },
    });
    expect(enqueueImageFetch).not.toHaveBeenCalled();
  });

  it('孤立したQUEUEDアイテムを発見し、Queueへ再投入する', async () => {
    const orphanedItems = [
      {
        id: 'item-1',
        guid: null,
        title: 'Article 1',
        link: 'https://example.com/article1',
        pubDate: null,
        creator: null,
        summary: null,
        content: null,
        contentSnippet: null,
        rawCategories: [],
        enclosureUrl: null,
        enclosureLength: null,
        enclosureType: null,
        sourceId: 'source-1',
        imageUrl: null,
        imageFetchStatus: 'QUEUED',
        updatedAt: new Date('2026-08-01T00:00:00Z'),
      },
      {
        id: 'item-2',
        guid: null,
        title: 'Article 2',
        link: 'https://example.com/article2',
        pubDate: null,
        creator: null,
        summary: null,
        content: null,
        contentSnippet: null,
        rawCategories: [],
        enclosureUrl: null,
        enclosureLength: null,
        enclosureType: null,
        sourceId: 'source-1',
        imageUrl: null,
        imageFetchStatus: 'QUEUED',
        updatedAt: new Date('2026-08-01T00:00:00Z'),
      },
    ];

    vi.mocked(prisma.newsItem.findMany).mockResolvedValue(orphanedItems as never);
    vi.mocked(enqueueImageFetch).mockResolvedValue({
      successCount: 2,
      failureCount: 0,
      failedIds: [],
    });

    const result = await recoverOrphanedQueuedItems();

    expect(result).toEqual({ recoveredCount: 2, queueFailureCount: 0, errors: [], errorDetails: [] });
    expect(enqueueImageFetch).toHaveBeenCalledWith([
      { id: 'item-1', link: 'https://example.com/article1' },
      { id: 'item-2', link: 'https://example.com/article2' },
    ], { deadline: undefined });
  });

  it('一部の再投入が失敗した場合、成功数とQueueエラーを返す', async () => {
    const orphanedItems = [
      {
        id: 'item-1',
        guid: null,
        title: 'Article 1',
        link: 'https://example.com/article1',
        pubDate: null,
        creator: null,
        summary: null,
        content: null,
        contentSnippet: null,
        rawCategories: [],
        enclosureUrl: null,
        enclosureLength: null,
        enclosureType: null,
        sourceId: 'source-1',
        imageUrl: null,
        imageFetchStatus: 'QUEUED',
        updatedAt: new Date('2026-08-01T00:00:00Z'),
      },
      {
        id: 'item-2',
        guid: null,
        title: 'Article 2',
        link: 'https://example.com/article2',
        pubDate: null,
        creator: null,
        summary: null,
        content: null,
        contentSnippet: null,
        rawCategories: [],
        enclosureUrl: null,
        enclosureLength: null,
        enclosureType: null,
        sourceId: 'source-1',
        imageUrl: null,
        imageFetchStatus: 'QUEUED',
        updatedAt: new Date('2026-08-01T00:00:00Z'),
      },
      {
        id: 'item-3',
        guid: null,
        title: 'Article 3',
        link: 'https://example.com/article3',
        pubDate: null,
        creator: null,
        summary: null,
        content: null,
        contentSnippet: null,
        rawCategories: [],
        enclosureUrl: null,
        enclosureLength: null,
        enclosureType: null,
        sourceId: 'source-1',
        imageUrl: null,
        imageFetchStatus: 'QUEUED',
        updatedAt: new Date('2026-08-01T00:00:00Z'),
      },
    ];

    vi.mocked(prisma.newsItem.findMany).mockResolvedValue(orphanedItems as never);
    vi.mocked(enqueueImageFetch).mockResolvedValue({
      successCount: 2,
      failureCount: 1,
      failedIds: ['item-2'],
    });

    const result = await recoverOrphanedQueuedItems();

    expect(result).toEqual({
      recoveredCount: 2,
      queueFailureCount: 1,
      errors: ['Queue enqueue failed: item-2'],
      errorDetails: [{ type: 'queue', message: 'Queue enqueue failed: item-2' }],
    });
  });

  it('Queue再投入の失敗をerrorsに記録する', async () => {
    vi.mocked(prisma.newsItem.findMany).mockResolvedValue([
      {
        id: 'orphaned-1',
        link: 'https://example.com/orphaned-1',
        updatedAt: new Date('2026-08-01T00:00:00Z'),
      } as never,
    ]);
    vi.mocked(enqueueImageFetch).mockResolvedValue({
      successCount: 0,
      failureCount: 1,
      failedIds: ['orphaned-1'],
    });

    const result = await recoverOrphanedQueuedItems();

    expect(result.recoveredCount).toBe(0);
    expect(result.errors).toContain('Queue enqueue failed: orphaned-1');
    expect(result.errorDetails).toEqual([
      { type: 'queue', message: 'Queue enqueue failed: orphaned-1' },
    ]);
  });

  it('カスタムの閾値（分）を指定できる', async () => {
    vi.mocked(prisma.newsItem.findMany).mockResolvedValue([]);

    await recoverOrphanedQueuedItems(10);

    expect(prisma.newsItem.findMany).toHaveBeenCalledWith({
      where: {
        imageFetchStatus: 'QUEUED',
        updatedAt: {
          lt: expect.any(Date),
        },
      },
      select: {
        id: true,
        link: true,
        updatedAt: true,
      },
      take: 50,
      orderBy: {
        updatedAt: 'asc',
      },
    });
  });

  it('デフォルトの閾値は5分', async () => {
    vi.mocked(prisma.newsItem.findMany).mockResolvedValue([]);

    await recoverOrphanedQueuedItems();

    expect(prisma.newsItem.findMany).toHaveBeenCalledWith({
      where: {
        imageFetchStatus: 'QUEUED',
        updatedAt: {
          lt: expect.any(Date),
        },
      },
      select: {
        id: true,
        link: true,
        updatedAt: true,
      },
      take: 50,
      orderBy: {
        updatedAt: 'asc',
      },
    });
  });
});

describe('fetchRssFeeds', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('RSS取得時にタイムアウト設定とUser-Agentヘッダーを渡す', async () => {
    const mockSource = {
      id: 'source-1',
      name: 'Test Source',
      url: 'https://example.com/rss.xml',
      enabled: true,
      defaultCategoryId: 'tech',
      language: 'ja',
      country: 'JP',
      lastFetchedAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.source.findMany).mockResolvedValue([mockSource]);

    const sampleRssXml = `
      <?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Test Feed</title>
          <link>https://example.com</link>
          <item>
            <title>Test Article</title>
            <link>https://example.com/article-1</link>
            <pubDate>Thu, 20 Aug 2026 12:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>
    `;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(sampleRssXml),
    } as never);

    const result = await fetchRssFeeds();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/rss.xml',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          'User-Agent': expect.stringContaining('Mozilla/5.0'),
        }),
      })
    );

    expect(result.items.length).toBe(1);
    expect(result.items[0].title).toBe('Test Article');
    expect(result.items[0].link).toBe('https://example.com/article-1');
    expect(result.feedResults.length).toBe(1);
    expect(result.feedResults[0].status).toBe('SUCCESS');

    global.fetch = originalFetch;
  });

  it('タイムアウト(TimeoutError)発生時、エラーを記録して安全に空配列を返す', async () => {
    const mockSource = {
      id: 'source-timeout',
      name: 'Slow Source',
      url: 'https://slow.example.com/rss.xml',
      enabled: true,
      defaultCategoryId: 'tech',
      language: 'ja',
      country: 'JP',
      lastFetchedAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.source.findMany).mockResolvedValue([mockSource]);

    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';

    global.fetch = vi.fn().mockRejectedValue(timeoutError);

    const result = await fetchRssFeeds();

    expect(result.items).toEqual([]);
    expect(result.feedResults.length).toBe(1);
    expect(result.feedResults[0].status).toBe('TIMEOUT');
    expect(prisma.source.update).toHaveBeenCalledWith({
      where: { id: 'source-timeout' },
      data: { lastError: expect.stringContaining('TimeoutError') },
    });

    global.fetch = originalFetch;
  });
});

describe('saveNewsToDb', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueueOptions(deadline)をenqueueImageFetchに正しく伝播する', async () => {
    vi.mocked(prisma.newsItem.createMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.newsItem.findMany).mockResolvedValue([
      {
        id: 'new-item-1',
        sourceId: 'source-1',
        link: 'https://example.com/article-1',
        imageFetchStatus: 'QUEUED',
      } as never,
    ]);
    vi.mocked(prisma.source.findMany).mockResolvedValue([
      {
        id: 'source-1',
        defaultCategoryId: 'tech',
      } as never,
    ]);
    vi.mocked(enqueueImageFetch).mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      failedIds: [],
    });

    const testDeadline = Date.now() + 45000;
    const items = [
      {
        title: 'Article 1',
        link: 'https://example.com/article-1',
        sourceId: 'source-1',
      },
    ];

    await saveNewsToDb(items, {
      enqueueOptions: { deadline: testDeadline },
    });

    expect(enqueueImageFetch).toHaveBeenCalledWith(
      [{ id: 'new-item-1', link: 'https://example.com/article-1' }],
      { deadline: testDeadline }
    );
  });

  it('Queue送信の失敗をerrorsに記録する', async () => {
    vi.mocked(prisma.newsItem.createMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.newsItem.findMany).mockResolvedValue([
      {
        id: 'new-item-1',
        sourceId: 'source-1',
        link: 'https://example.com/article-1',
        imageFetchStatus: 'QUEUED',
      } as never,
    ]);
    vi.mocked(prisma.source.findMany).mockResolvedValue([
      {
        id: 'source-1',
        defaultCategoryId: 'tech',
      } as never,
    ]);
    vi.mocked(enqueueImageFetch).mockResolvedValue({
      successCount: 0,
      failureCount: 1,
      failedIds: ['new-item-1'],
    });

    const result = await saveNewsToDb([
      {
        title: 'Article 1',
        link: 'https://example.com/article-1',
        sourceId: 'source-1',
      },
    ]);

    expect(result.errors).toContain('Queue enqueue failed: new-item-1');
    expect(result.errorDetails).toEqual([
      { type: 'queue', message: 'Queue enqueue failed: new-item-1' },
    ]);
  });

  it('jobExecutionIdをNewsItemに付与して保存する', async () => {
    vi.mocked(prisma.newsItem.createMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.newsItem.findMany).mockResolvedValue([
      {
        id: 'new-item-1',
        sourceId: 'source-1',
        link: 'https://example.com/article-1',
        imageFetchStatus: 'QUEUED',
      } as never,
    ]);
    vi.mocked(prisma.source.findMany).mockResolvedValue([
      {
        id: 'source-1',
        defaultCategoryId: 'tech',
      } as never,
    ]);
    vi.mocked(enqueueImageFetch).mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      failedIds: [],
    });

    const items = [
      {
        title: 'Article 1',
        link: 'https://example.com/article-1',
        sourceId: 'source-1',
      },
    ];

    await saveNewsToDb(items, {
      jobExecutionId: 'test-job-execution-id',
    });

    expect(prisma.newsItem.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          createdJobExecutionId: 'test-job-execution-id',
        }),
      ]),
      skipDuplicates: true,
    });
  });
});

describe('syncNews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('RSSで新着記事が0件の場合でも、孤立キュー回収(Sweeper)を必ず実行する', async () => {
    vi.mocked(prisma.source.findMany).mockResolvedValue([]);
    vi.mocked(prisma.newsItem.findMany).mockResolvedValue([]);
    vi.mocked(enqueueImageFetch).mockResolvedValue({
      successCount: 0,
      failureCount: 0,
      failedIds: [],
    });

    const result = await syncNews();

    expect(result).toHaveProperty('addedCount');
    expect(result).toHaveProperty('recoveredCount');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('itemsFound');
    expect(result).toHaveProperty('itemsSkipped');
    expect(result).toHaveProperty('feedTotalCount');
    expect(result).toHaveProperty('feedSuccessCount');
    expect(result).toHaveProperty('feedFailureCount');
    expect(result).toHaveProperty('queuedCount');
    expect(result).toHaveProperty('queueFailureCount');
    expect(result).toHaveProperty('feedResults');
    expect(result).toHaveProperty('errorDetails');
    expect(result).toHaveProperty('errorTypes');
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.errorTypes).toEqual({ phase: false, feed: false, queue: false });
  });

  it('RSSフェーズでエラーが発生した場合でも、errors配列に記録しSweeperを実行する', async () => {
    // RSS取得でエラーを発生させる
    vi.mocked(prisma.source.findMany).mockRejectedValue(new Error('Database connection failed'));
    // Sweeper対象アイテムが1件
    vi.mocked(prisma.newsItem.findMany).mockResolvedValue([
      {
        id: 'orphaned-1',
        link: 'https://example.com/orphaned-1',
        updatedAt: new Date('2026-08-01T00:00:00Z'),
      } as never,
    ]);
    vi.mocked(enqueueImageFetch).mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      failedIds: [],
    });

    const result = await syncNews();

    expect(result.addedCount).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Database connection failed');
    expect(result.errorTypes.phase).toBe(true);
    expect(result.errorTypes.feed).toBe(false);
    expect(result.errorTypes.queue).toBe(false);
  });

  it('SweeperのQueue再投入失敗をerrors配列に記録する', async () => {
    vi.mocked(prisma.source.findMany).mockResolvedValue([]);
    vi.mocked(prisma.newsItem.findMany).mockResolvedValue([
      {
        id: 'orphaned-1',
        link: 'https://example.com/orphaned-1',
        updatedAt: new Date('2026-08-01T00:00:00Z'),
      } as never,
    ]);
    vi.mocked(enqueueImageFetch).mockResolvedValue({
      successCount: 0,
      failureCount: 1,
      failedIds: ['orphaned-1'],
    });

    const result = await syncNews();

    expect(result.errors).toContain('Queue enqueue failed: orphaned-1');
    expect(result.errorTypes.queue).toBe(true);
    expect(result.errorTypes.phase).toBe(false);
    expect(result.errorDetails).toEqual([
      { type: 'queue', message: 'Queue enqueue failed: orphaned-1' },
    ]);
  });

  it('全Feedが失敗した場合、errors配列にエラーを記録する', async () => {
    vi.mocked(prisma.source.findMany).mockResolvedValue([
      {
        id: 'source-1',
        name: 'Source 1',
        url: 'https://example.com/feed1.xml',
        enabled: true,
        defaultCategoryId: 'tech',
      } as never,
    ]);
    vi.mocked(prisma.newsItem.findMany).mockResolvedValue([]);
    // global.fetch をモックして失敗させる
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    try {
      const result = await syncNews();

      expect(result.feedTotalCount).toBe(1);
      expect(result.feedSuccessCount).toBe(0);
      expect(result.feedFailureCount).toBe(1);
      expect(result.errors).toContain('All 1 feeds failed to sync');
      expect(result.errorTypes.phase).toBe(true);
      expect(result.errorTypes.feed).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('shouldRetryFetchError', () => {
  it('4xxエラーはリトライしない', () => {
    const httpError = new HttpError('Not Found', 404);
    
    expect(shouldRetryFetchError(httpError)).toBe(false);
  });

  it('429はリトライする', () => {
    const httpError = new HttpError('Too Many Requests', 429);
    
    expect(shouldRetryFetchError(httpError)).toBe(true);
  });

  it('AbortErrorはリトライする', () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    
    expect(shouldRetryFetchError(abortError)).toBe(true);
  });

  it('TimeoutErrorはリトライする', () => {
    const timeoutError = new Error('Request timeout');
    timeoutError.name = 'TimeoutError';
    
    expect(shouldRetryFetchError(timeoutError)).toBe(true);
  });

  it('terminatedエラーはリトライする', () => {
    const terminatedError = new Error('The operation was terminated');
    
    expect(shouldRetryFetchError(terminatedError)).toBe(true);
  });

  it('networkエラーはリトライする', () => {
    const networkError = new Error('Network error occurred');
    
    expect(shouldRetryFetchError(networkError)).toBe(true);
  });

  it('fetchエラーはリトライする', () => {
    const fetchError = new Error('fetch failed');
    
    expect(shouldRetryFetchError(fetchError)).toBe(true);
  });

  it('未知のエラーはリトライしない', () => {
    const unknownError = new Error('Unknown error');
    
    expect(shouldRetryFetchError(unknownError)).toBe(false);
  });
});

describe('fetchSingleRssFeed', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('404エラーはリトライしない', async () => {
    const mockSource = {
      id: 'source-404',
      name: '404 Source',
      url: 'https://example.com/notfound.xml',
    };

    const parser = new Parser();

    global.fetch = vi.fn()
      .mockRejectedValueOnce(new HttpError('Failed to fetch XML. Status: 404', 404))
      .mockRejectedValueOnce(new HttpError('Failed to fetch XML. Status: 404', 404));

    const result = await fetchSingleRssFeed(mockSource, parser, 1);

    expect(result.items).toEqual([]);
    expect(result.feedResult.status).toBe('FAILED');
    expect(global.fetch).toHaveBeenCalledTimes(1); // リトライなし
  });

  it('タイムアウトエラーは1回リトライする', async () => {
    const mockSource = {
      id: 'source-timeout',
      name: 'Timeout Source',
      url: 'https://example.com/timeout.xml',
    };

    const parser = new Parser();

    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';

    global.fetch = vi.fn()
      .mockRejectedValueOnce(timeoutError)
      .mockRejectedValueOnce(timeoutError);

    const result = await fetchSingleRssFeed(mockSource, parser, 1);

    expect(result.items).toEqual([]);
    expect(result.feedResult.status).toBe('TIMEOUT');
    expect(global.fetch).toHaveBeenCalledTimes(2); // 1回リトライ
  });

  it('terminatedエラーは1回リトライする', async () => {
    const mockSource = {
      id: 'source-terminated',
      name: 'Terminated Source',
      url: 'https://example.com/terminated.xml',
    };

    const parser = new Parser();

    const terminatedError = new Error('The operation was terminated');

    global.fetch = vi.fn()
      .mockRejectedValueOnce(terminatedError)
      .mockRejectedValueOnce(terminatedError);

    const result = await fetchSingleRssFeed(mockSource, parser, 1);

    expect(result.items).toEqual([]);
    expect(result.feedResult.status).toBe('FAILED');
    expect(global.fetch).toHaveBeenCalledTimes(2); // 1回リトライ
  });

  it('正常取得時はリトライしない', async () => {
    const mockSource = {
      id: 'source-success',
      name: 'Success Source',
      url: 'https://example.com/success.xml',
    };

    const parser = new Parser();

    const sampleRssXml = `
      <?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Test Feed</title>
          <link>https://example.com</link>
          <item>
            <title>Test Article</title>
            <link>https://example.com/article-1</link>
            <pubDate>Thu, 20 Aug 2026 12:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>
    `;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(sampleRssXml),
    } as never);

    const result = await fetchSingleRssFeed(mockSource, parser, 1);

    expect(result.items.length).toBe(1);
    expect(result.feedResult.status).toBe('SUCCESS');
    expect(global.fetch).toHaveBeenCalledTimes(1); // リトライなし
  });
});

describe('RSS source URL updates', () => {
  it('foodrink_gourmetは新しいURLを使用する', async () => {
    const mockSource = {
      id: 'foodrink_gourmet',
      name: 'フードリンクニュース',
      url: 'https://www.foodrink.co.jp/rss.xml',
      enabled: true,
      defaultCategoryId: 'gourmet',
      language: 'ja',
      country: 'JP',
      lastFetchedAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.source.findMany).mockResolvedValue([mockSource]);

    const sampleRssXml = `
      <?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Foodrink News</title>
          <link>https://www.foodrink.co.jp</link>
          <item>
            <title>Foodrink Article</title>
            <link>https://www.foodrink.co.jp/article-1</link>
            <pubDate>Thu, 20 Aug 2026 12:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>
    `;

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(sampleRssXml),
    } as never);

    try {
      await fetchRssFeeds();
      
      expect(global.fetch).toHaveBeenCalledWith(
        'https://www.foodrink.co.jp/rss.xml',
        expect.any(Object)
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('hatena_politicsは経済フィードを使用する', async () => {
    const mockSource = {
      id: 'hatena_politics',
      name: 'はてなブックマーク（経済）',
      url: 'https://b.hatena.ne.jp/hotentry/economics.rss',
      enabled: true,
      defaultCategoryId: 'business',
      language: 'ja',
      country: 'JP',
      lastFetchedAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.source.findMany).mockResolvedValue([mockSource]);

    const sampleRssXml = `
      <?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>はてなブックマーク - 経済</title>
          <link>https://b.hatena.ne.jp</link>
          <item>
            <title>Economics Article</title>
            <link>https://example.com/economics-1</link>
            <pubDate>Thu, 20 Aug 2026 12:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>
    `;

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(sampleRssXml),
    } as never);

    try {
      await fetchRssFeeds();
      
      expect(global.fetch).toHaveBeenCalledWith(
        'https://b.hatena.ne.jp/hotentry/economics.rss',
        expect.any(Object)
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('astroarts_scienceはHTTPS URLを使用する', async () => {
    const mockSource = {
      id: 'astroarts_science',
      name: 'AstroArts',
      url: 'https://www.astroarts.co.jp/article/feed.atom',
      enabled: true,
      defaultCategoryId: 'science',
      language: 'ja',
      country: 'JP',
      lastFetchedAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.source.findMany).mockResolvedValue([mockSource]);

    const sampleAtomXml = `
      <?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>AstroArts Articles</title>
        <link href="https://www.astroarts.co.jp"/>
        <entry>
          <title>AstroArts Article</title>
          <link href="https://www.astroarts.co.jp/article-1"/>
          <published>2026-08-20T12:00:00Z</published>
        </entry>
      </feed>
    `;

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(sampleAtomXml),
    } as never);

    try {
      await fetchRssFeeds();
      
      expect(global.fetch).toHaveBeenCalledWith(
        'https://www.astroarts.co.jp/article/feed.atom',
        expect.any(Object)
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('全フィード並列取得と集計結果', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('複数フィードを並列取得し、集計結果が正しく記録される', async () => {
    const mockSources = [
      {
        id: 'source-1',
        name: 'Source 1',
        url: 'https://example.com/feed1.xml',
        enabled: true,
        defaultCategoryId: 'tech',
        language: 'ja',
        country: 'JP',
        lastFetchedAt: null,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'source-2',
        name: 'Source 2',
        url: 'https://example.com/feed2.xml',
        enabled: true,
        defaultCategoryId: 'business',
        language: 'ja',
        country: 'JP',
        lastFetchedAt: null,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'source-3',
        name: 'Source 3',
        url: 'https://example.com/feed3.xml',
        enabled: true,
        defaultCategoryId: 'sports',
        language: 'ja',
        country: 'JP',
        lastFetchedAt: null,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    vi.mocked(prisma.source.findMany).mockResolvedValue(mockSources);

    const sampleRssXml1 = `
      <?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Feed 1</title>
          <item>
            <title>Article 1-1</title>
            <link>https://example.com/article-1-1</link>
            <pubDate>Thu, 20 Aug 2026 12:00:00 GMT</pubDate>
          </item>
          <item>
            <title>Article 1-2</title>
            <link>https://example.com/article-1-2</link>
            <pubDate>Thu, 20 Aug 2026 13:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>
    `;

    const sampleRssXml2 = `
      <?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Feed 2</title>
          <item>
            <title>Article 2-1</title>
            <link>https://example.com/article-2-1</link>
            <pubDate>Thu, 20 Aug 2026 14:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>
    `;

    const sampleRssXml3 = `
      <?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Feed 3</title>
          <item>
            <title>Article 3-1</title>
            <link>https://example.com/article-3-1</link>
            <pubDate>Thu, 20 Aug 2026 15:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>
    `;

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(sampleRssXml1),
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(sampleRssXml2),
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(sampleRssXml3),
      } as never);

    const result = await fetchRssFeeds();

    expect(result.items.length).toBe(4);
    expect(result.feedResults.length).toBe(3);
    expect(result.feedResults[0].status).toBe('SUCCESS');
    expect(result.feedResults[0].itemsFound).toBe(2);
    expect(result.feedResults[1].status).toBe('SUCCESS');
    expect(result.feedResults[1].itemsFound).toBe(1);
    expect(result.feedResults[2].status).toBe('SUCCESS');
    expect(result.feedResults[2].itemsFound).toBe(1);
  });

  it('一部フィードが失敗しても他のフィードは正常に取得される', async () => {
    const mockSources = [
      {
        id: 'source-success',
        name: 'Success Source',
        url: 'https://example.com/success.xml',
        enabled: true,
        defaultCategoryId: 'tech',
        language: 'ja',
        country: 'JP',
        lastFetchedAt: null,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'source-fail',
        name: 'Fail Source',
        url: 'https://example.com/fail.xml',
        enabled: true,
        defaultCategoryId: 'business',
        language: 'ja',
        country: 'JP',
        lastFetchedAt: null,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    vi.mocked(prisma.source.findMany).mockResolvedValue(mockSources);

    const sampleRssXml = `
      <?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Success Feed</title>
          <item>
            <title>Success Article</title>
            <link>https://example.com/success-article</link>
            <pubDate>Thu, 20 Aug 2026 12:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>
    `;

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(sampleRssXml),
      } as never)
      .mockRejectedValueOnce(new HttpError('Failed to fetch XML. Status: 404', 404));

    const result = await fetchRssFeeds();

    expect(result.items.length).toBe(1);
    expect(result.feedResults.length).toBe(2);
    expect(result.feedResults[0].status).toBe('SUCCESS');
    expect(result.feedResults[0].itemsFound).toBe(1);
    expect(result.feedResults[1].status).toBe('FAILED');
    expect(result.feedResults[1].itemsFound).toBe(0);
  });
});


