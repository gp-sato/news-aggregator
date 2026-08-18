import { describe, expect, it, vi, beforeEach } from 'vitest';
import { recoverOrphanedQueuedItems } from '../news';
import { prisma } from '../prisma';

// Mock prisma
vi.mock('../prisma', () => ({
  prisma: {
    newsItem: {
      findMany: vi.fn(),
    },
  },
}));

// Mock queue
vi.mock('../queue', () => ({
  enqueueImageFetch: vi.fn(),
}));

import { enqueueImageFetch } from '../queue';

describe('recoverOrphanedQueuedItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('孤立したQUEUEDアイテムが存在しない場合、回収数0を返す', async () => {
    vi.mocked(prisma.newsItem.findMany).mockResolvedValue([]);

    const result = await recoverOrphanedQueuedItems();

    expect(result).toEqual({ recoveredCount: 0 });
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

    expect(result).toEqual({ recoveredCount: 2 });
    expect(enqueueImageFetch).toHaveBeenCalledWith([
      { id: 'item-1', link: 'https://example.com/article1' },
      { id: 'item-2', link: 'https://example.com/article2' },
    ]);
  });

  it('一部の再投入が失敗した場合、成功数のみを返す', async () => {
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

    expect(result).toEqual({ recoveredCount: 2 });
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
    });
  });
});
