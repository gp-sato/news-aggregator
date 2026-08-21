import { describe, expect, it, vi, beforeEach } from 'vitest';
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

import { fetchRssFeeds, recoverOrphanedQueuedItems, saveNewsToDb, syncNews } from '../news';
import { enqueueImageFetch } from '../queue';

describe('recoverOrphanedQueuedItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('孤立したQUEUEDアイテムが存在しない場合、回収数0を返す', async () => {
    vi.mocked(prisma.newsItem.findMany).mockResolvedValue([]);

    const result = await recoverOrphanedQueuedItems();

    expect(result).toEqual({ recoveredCount: 0, errors: [] });
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

    expect(result).toEqual({ recoveredCount: 2, errors: [] });
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
      errors: ['Queue enqueue failed: item-2'],
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

    const items = await fetchRssFeeds();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/rss.xml',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          'User-Agent': expect.stringContaining('Mozilla/5.0'),
        }),
      })
    );

    expect(items.length).toBe(1);
    expect(items[0].title).toBe('Test Article');
    expect(items[0].link).toBe('https://example.com/article-1');

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

    const items = await fetchRssFeeds();

    expect(items).toEqual([]);
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
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.errors.length).toBe(0);
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
  });
});



