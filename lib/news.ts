import Parser from 'rss-parser'
import { prisma } from './prisma'

export interface FeedItem {
  guid?: string
  title: string
  link: string
  isoDate?: string
  pubDate?: string
  creator?: string
  summary?: string
  content?: string
  contentSnippet?: string
  categories?: string[]
  enclosure?: {
    url: string
    length?: string | number
    type?: string
  }
  sourceId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mediaThumbnail?: any
  hatenaImageUrl?: string
  contentEncoded?: string
}

/**
 * ドメインまたはソースIDに基づいて、ソースがGoogle Newsかどうか判定します。
 */
export function isGoogleNews(link: string, sourceId: string): boolean {
  return (
    sourceId.startsWith('google') ||
    link.includes('news.google.com')
  );
}

/**
 * 相対URLを記事のリンクを基準とした絶対URLに変換します。
 */
export function resolveArticleUrl(url: string, baseUrl: string): string {
  if (!url) return '';
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

/**
 * HTMLのメタタグから特定のプロパティ（og:imageやtwitter:image）のcontent属性の値を抽出します。
 */
function extractMetaTagContent(html: string, propertyOrName: string): string | null {
  const metaRegex = /<meta\s+[^>]*>/gi;
  let match;
  while ((match = metaRegex.exec(html)) !== null) {
    const metaTag = match[0];
    const hasPropertyOrName = new RegExp(`(?:property|name)=["']${propertyOrName}["']`, 'i').test(metaTag);
    if (hasPropertyOrName) {
      const contentMatch = metaTag.match(/content=["']([^"']+)["']/i);
      if (contentMatch && contentMatch[1]) {
        return contentMatch[1];
      }
    }
  }
  return null;
}

/**
 * 優先順位に基づいてRSS項目から画像を抽出します。
 */
export function extractRssImage(item: FeedItem): string | null {
  // 1. media:thumbnail
  if (item.mediaThumbnail) {
    let url = '';
    if (typeof item.mediaThumbnail === 'string') {
      url = item.mediaThumbnail;
    } else if (item.mediaThumbnail.$ && item.mediaThumbnail.$.url) {
      url = item.mediaThumbnail.$.url;
    } else if (item.mediaThumbnail.url) {
      url = item.mediaThumbnail.url;
    } else if (Array.isArray(item.mediaThumbnail) && item.mediaThumbnail.length > 0) {
      const first = item.mediaThumbnail[0];
      if (typeof first === 'string') {
        url = first;
      } else if (first?.$?.url) {
        url = first.$.url;
      } else if (first?.url) {
        url = first.url;
      }
    }
    if (url) {
      return resolveArticleUrl(url, item.link);
    }
  }

  // 2. hatena:imageurl
  if (item.hatenaImageUrl) {
    return resolveArticleUrl(item.hatenaImageUrl, item.link);
  }

  // 3. enclosure (image/* only)
  if (item.enclosure && item.enclosure.url && item.enclosure.type?.startsWith('image/')) {
    return resolveArticleUrl(item.enclosure.url, item.link);
  }

  // 4. first image inside content:encoded
  const contentForSearch = item.contentEncoded || item.content || '';
  if (contentForSearch) {
    const imgMatch = contentForSearch.match(/<img\s+[^>]*src=["']([^"']+)["']/i);
    if (imgMatch && imgMatch[1]) {
      return resolveArticleUrl(imgMatch[1], item.link);
    }
  }

  return null;
}

/**
 * 記事のURLからOGP画像（og:image / twitter:image）を取得します。
 */
export async function fetchOgImage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch article page. Status: ${res.status}`);
    }

    const html = await res.text();
    
    let imageUrl = extractMetaTagContent(html, 'og:image');
    if (!imageUrl) {
      imageUrl = extractMetaTagContent(html, 'twitter:image');
    }

    if (imageUrl) {
      return resolveArticleUrl(imageUrl, url);
    }

    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * データベースの画像情報とステータスを更新します。
 */
export async function updateImageStatus(
  id: string,
  imageUrl: string | null,
  status: 'SUCCESS' | 'NOT_FOUND' | 'FAILED' | 'PROCESSING' | 'PENDING'
) {
  return prisma.newsItem.update({
    where: { id },
    data: {
      imageUrl,
      imageFetchStatus: status,
    },
  });
}

/**
 * 並列実行数を制限しつつ非同期タスクを実行するヘルパー。
 */
async function runWithConcurrencyLimit<T>(
  limit: number,
  items: T[],
  fn: (item: T) => Promise<void>
) {
  const pool = new Set<Promise<void>>();
  for (const item of items) {
    const promise = fn(item).then(() => {
      pool.delete(promise);
    });
    pool.add(promise);
    if (pool.size >= limit) {
      await Promise.race(pool);
    }
  }
  await Promise.all(pool);
}

/**
 * PENDING 状態のニュース画像の OGP 取得を一括で非同期処理します（並列数5）。
 */
export async function processPendingNewsImages() {
  const pendingItems = await prisma.newsItem.findMany({
    where: {
      imageFetchStatus: 'PENDING',
    },
    take: 50,
  });

  if (pendingItems.length === 0) {
    return { processedCount: 0, successCount: 0, failedCount: 0, notFoundCount: 0 };
  }

  let successCount = 0;
  let failedCount = 0;
  let notFoundCount = 0;

  await runWithConcurrencyLimit(5, pendingItems, async (item) => {
    try {
      await prisma.newsItem.update({
        where: { id: item.id },
        data: { imageFetchStatus: 'PROCESSING' },
      });
    } catch (e) {
      console.error(`Failed to update status to PROCESSING for item ${item.id}:`, e);
      return;
    }

    try {
      const ogImageUrl = await fetchOgImage(item.link);
      if (ogImageUrl) {
        await updateImageStatus(item.id, ogImageUrl, 'SUCCESS');
        successCount++;
      } else {
        await updateImageStatus(item.id, null, 'NOT_FOUND');
        notFoundCount++;
      }
    } catch (error) {
      console.error(`Failed to fetch OGP image for item ${item.id} (${item.link}):`, error);
      await updateImageStatus(item.id, null, 'FAILED');
      failedCount++;
    }
  });

  return {
    processedCount: pendingItems.length,
    successCount,
    failedCount,
    notFoundCount,
  };
}

/**
 * 外部のRSSソースから最新のニュース記事を取得します。
 */
export async function fetchRssFeeds(): Promise<FeedItem[]> {
  const parser = new Parser({
    customFields: {
      item: [
        ['media:thumbnail', 'mediaThumbnail'],
        ['hatena:imageurl', 'hatenaImageUrl'],
        ['content:encoded', 'contentEncoded'],
      ]
    }
  })
  
  // データベースから有効なソースを取得
  const dbSources = await prisma.source.findMany({
    where: { enabled: true },
  })

  const feedPromises = dbSources.map(async (source) => {
    try {
      // 外部サーバーへの負荷軽減とアクセスの高速化のため、本番環境ではNext.jsのData Cache（10分間再検証）を適用してXMLを取得します。
      // 開発環境では常に最新データを取得するため、キャッシュを無効にします。
      const fetchOptions = process.env.NODE_ENV === 'production'
        ? { next: { revalidate: 60 * 10 } }
        : { cache: 'no-store' as const }
      const res = await fetch(source.url, fetchOptions)
      if (!res.ok) {
        throw new Error(`Failed to fetch XML. Status: ${res.status}`)
      }
      const xmlString = await res.text()
      const feed = await parser.parseString(xmlString)

      // 最終取得日時を更新
      await prisma.source.update({
        where: { id: source.id },
        data: { lastFetchedAt: new Date(), lastError: null },
      }).catch((err) => console.error(`Failed to update lastFetchedAt for source ${source.id}:`, err))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return feed.items.map((item: any) => ({
        guid: item.guid,
        title: item.title || '',
        link: item.link || '',
        isoDate: item.isoDate || item.pubDate,
        creator: item.creator,
        summary: item.summary,
        content: item.content,
        contentSnippet: item.contentSnippet,
        categories: item.categories || [],
        enclosure: item.enclosure ? {
          url: item.enclosure.url,
          length: item.enclosure.length,
          type: item.enclosure.type,
        } : undefined,
        sourceId: source.id,
        mediaThumbnail: item.mediaThumbnail,
        hatenaImageUrl: item.hatenaImageUrl,
        contentEncoded: item.contentEncoded,
      }))
    } catch (error) {
      console.error(`Failed to fetch RSS from ${source.name}:`, error)

      // エラー情報を記録
      await prisma.source.update({
        where: { id: source.id },
        data: { lastError: String(error) },
      }).catch((err) => console.error(`Failed to update lastError for source ${source.id}:`, err))

      return []
    }
  })

  const results = await Promise.allSettled(feedPromises)
  const flattenedItems = results
    .map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value
      } else {
        console.error(`Failed to fetch ${dbSources[index].name} feed promise:`, result.reason)
        return []
      }
    })
    .flat()

  // 日付順 (古い順) にソートして返す
  return flattenedItems.sort((a, b) => {
    const dateA = new Date(a.isoDate || 0)
    const dateB = new Date(b.isoDate || 0)
    return dateA.getTime() - dateB.getTime()
  })
}

/**
 * データベースから保存済みのニュース一覧を取得します。
 */
export async function getNewsFromDb(params: {
  category?: string
  source?: string
  query?: string
  skip?: number
  take?: number
}) {
  const { category, source, query, skip, take } = params
  const trimmedQuery = query?.trim()

  const whereCondition = {
    ...(source && source !== 'all' ? { sourceId: source } : {}),
    ...(trimmedQuery
      ? {
          title: {
            contains: trimmedQuery,
            mode: 'insensitive' as const,
          },
        }
      : {}),
    ...(category && category !== 'all'
      ? {
          categories: {
            some: {
              categoryId: category,
            },
          },
        }
      : {}),
  }

  return prisma.newsItem.findMany({
    where: whereCondition,
    include: {
      source: true,
      categories: {
        include: {
          category: true,
        },
      },
    },
    orderBy: {
      pubDate: 'desc',
    },
    skip,
    take,
  })
}

/**
 * 取得したニュース項目をデータベースに一括保存します。
 * 重複するURL（link）の記事は自動的にスキップされます。
 */
export async function saveNewsToDb(items: FeedItem[]) {
  if (items.length === 0) return { count: 0 }

  const data = items.map((item) => {
    const isGoogle = isGoogleNews(item.link, item.sourceId)
    let extractedUrl = null
    let status: 'SUCCESS' | 'NOT_FOUND' | 'PENDING' = 'PENDING'

    if (isGoogle) {
      status = 'NOT_FOUND'
    } else {
      extractedUrl = extractRssImage(item)
      if (extractedUrl) {
        status = 'SUCCESS'
      }
    }

    return {
      guid: item.guid,
      title: item.title,
      link: item.link,
      pubDate: item.isoDate ? new Date(item.isoDate) : null,
      creator: item.creator,
      summary: item.summary,
      content: item.content,
      contentSnippet: item.contentSnippet,
      rawCategories: item.categories || [],
      enclosureUrl: item.enclosure?.url,
      enclosureLength: item.enclosure?.length ? parseInt(String(item.enclosure.length)) : null,
      enclosureType: item.enclosure?.type,
      sourceId: item.sourceId,
      imageUrl: extractedUrl,
      imageFetchStatus: status,
    }
  })

  const result = await prisma.newsItem.createMany({
    data,
    skipDuplicates: true,
  })

  if (result.count === 0) return { count: 0 }

  // 新規追加された記事を特定してカテゴリリレーションを作成する
  const savedArticles = await prisma.newsItem.findMany({
    where: {
      link: {
        in: items.map((item) => item.link),
      },
    },
    select: {
      id: true,
      sourceId: true,
    },
  })

  const dbSources = await prisma.source.findMany({
    select: {
      id: true,
      defaultCategoryId: true,
    },
  })

  const sourceToCategoryMap = new Map(dbSources.map((s) => [s.id, s.defaultCategoryId]))

  const joinRows = savedArticles
    .map((article) => {
      const categoryId = sourceToCategoryMap.get(article.sourceId)
      if (!categoryId) return null
      return {
        newsItemId: article.id,
        categoryId,
        method: 'source-default',
      }
    })
    .filter((row): row is { newsItemId: string; categoryId: string; method: string } => row !== null)

  if (joinRows.length > 0) {
    await prisma.newsItemCategory.createMany({
      data: joinRows,
      skipDuplicates: true,
    })
  }

  return { count: result.count }
}

/**
 * RSSから最新ニュースを取得し、データベースに保存する一連の処理を実行します（Cronから呼び出す用）。
 */
export async function syncNews() {
  console.log('Starting RSS feed synchronization...')
  const latestItems = await fetchRssFeeds()

  if (latestItems.length === 0) {
    console.log('No items retrieved from RSS feeds.')
    return { count: 0 }
  }

  // RSSから取得したアイテムのリンク一覧を抽出
  const links = latestItems.map((item) => item.link).filter(Boolean)

  // DBに既に存在するリンクを取得（重複を避けるためピンポイントで検索）
  const existingItems = await prisma.newsItem.findMany({
    where: {
      link: {
        in: links,
      },
    },
    select: {
      link: true,
    },
  })

  const existingLinks = new Set(existingItems.map((item) => item.link))

  // DBに存在しない新規アイテムのみをフィルタリング
  const newItems = latestItems.filter((item) => !existingLinks.has(item.link))

  if (newItems.length === 0) {
    console.log('All retrieved items already exist in the database.')
    return { count: 0 }
  }

  console.log(`Fetched ${latestItems.length} items from RSS. Saving ${newItems.length} new items to DB...`)
  const result = await saveNewsToDb(newItems)
  console.log(`Synchronization complete. Saved ${result.count} new news items.`)

  return result
}
