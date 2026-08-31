import Parser from 'rss-parser'
import { prisma } from './prisma'
import { ImageFetchStatus, FeedSyncStatus } from '@prisma/client'
import { enqueueImageFetch, EnqueueOptions } from './queue'

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

export interface FeedFetchResult {
  sourceId: string
  sourceName: string
  sourceUrl: string
  status: FeedSyncStatus
  httpStatus?: number
  durationMs: number
  itemsFound: number
  itemsCreated?: number
  errorCode?: string
  errorMessage?: string
}

export type SyncErrorType = 'phase' | 'queue'

export interface SyncErrorDetail {
  type: SyncErrorType
  message: string
}

/**
 * HTTPエラー情報を含むカスタムエラー型
 */
class HttpError extends Error {
  httpStatus?: number

  constructor(message: string, httpStatus?: number) {
    super(message)
    this.name = 'HttpError'
    this.httpStatus = httpStatus
  }
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
 * 恒久的な失敗を表すエラー（4xxステータス、不正URL等。再試行不要）
 */
export class PermanentFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentFetchError';
  }
}

/**
 * 再試行可能な一時的障害を表すエラー（429, 5xx, タイムアウト, ネットワークエラー等）
 */
export class RetryableFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableFetchError';
  }
}

/**
 * 記事のURLからOGP画像（og:image / twitter:image）を取得します。
 */
export async function fetchOgImage(url: string): Promise<string | null> {
  try {
    new URL(url);
  } catch {
    throw new PermanentFetchError(`Invalid URL format: ${url}`);
  }

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
      if (res.status === 429 || res.status >= 500) {
        throw new RetryableFetchError(`Retryable HTTP error ${res.status} when fetching ${url}`);
      } else {
        throw new PermanentFetchError(`Permanent HTTP error ${res.status} when fetching ${url}`);
      }
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
  } catch (error) {
    if (error instanceof PermanentFetchError || error instanceof RetryableFetchError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new RetryableFetchError(`Request timed out while fetching ${url}`);
    }
    throw new RetryableFetchError(`Network error while fetching ${url}: ${String(error)}`);
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
  status: ImageFetchStatus
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
 * 外部のRSSソースから最新のニュース記事を取得します。
 */
export async function fetchRssFeeds(): Promise<{ items: FeedItem[]; feedResults: FeedFetchResult[] }> {
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
    const startTime = Date.now()
    try {
      // 外部サーバーへの負荷軽減とアクセスの高速化のため、本番環境ではNext.jsのData Cache（10分間再検証）を適用してXMLを取得します。
      // 開発環境では常に最新データを取得するため、キャッシュを無効にします。
      const fetchOptions = process.env.NODE_ENV === 'production'
        ? { next: { revalidate: 60 * 10 } }
        : { cache: 'no-store' as const }
      const res = await fetch(source.url, {
        ...fetchOptions,
        signal: AbortSignal.timeout(8000), // 8秒でタイムアウト
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      })
      if (!res.ok) {
        throw new HttpError(`Failed to fetch XML. Status: ${res.status}`, res.status)
      }
      const xmlString = await res.text()
      const feed = await parser.parseString(xmlString)

      // 最終取得日時を更新
      await prisma.source.update({
        where: { id: source.id },
        data: { lastFetchedAt: new Date(), lastError: null },
      }).catch((err) => console.error(`Failed to update lastFetchedAt for source ${source.id}:`, err))

      const durationMs = Date.now() - startTime

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items = feed.items.map((item: any) => ({
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

      const feedResult: FeedFetchResult = {
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.url,
        status: FeedSyncStatus.SUCCESS,
        httpStatus: res.status,
        durationMs,
        itemsFound: items.length,
        itemsCreated: 0, // Will be updated after saving to DB
      }

      return { items, feedResult }
    } catch (error) {
      const durationMs = Date.now() - startTime

      // タイムアウトまたはネットワークエラーの場合は安全にスキップ
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        console.error(`RSS fetch timeout for ${source.name}:`, error)
      } else {
        console.error(`Failed to fetch RSS from ${source.name}:`, error)
      }

      // エラー情報を記録
      await prisma.source.update({
        where: { id: source.id },
        data: { lastError: String(error) },
      }).catch((err) => console.error(`Failed to update lastError for source ${source.id}:`, err))

      const isTimeout = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
      const httpStatus = error instanceof HttpError ? error.httpStatus : undefined
      const feedResult: FeedFetchResult = {
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.url,
        status: isTimeout ? FeedSyncStatus.TIMEOUT : FeedSyncStatus.FAILED,
        httpStatus,
        durationMs,
        itemsFound: 0,
        itemsCreated: 0,
        errorCode: error instanceof Error ? error.name : 'UNKNOWN',
        errorMessage: error instanceof Error ? error.message : String(error),
      }

      return { items: [], feedResult }
    }
  })

  const results = await Promise.allSettled(feedPromises)
  const allItems: FeedItem[] = []
  const allFeedResults: FeedFetchResult[] = []

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      allItems.push(...result.value.items)
      allFeedResults.push(result.value.feedResult)
    } else {
      console.error(`Failed to fetch ${dbSources[index].name} feed promise:`, result.reason)
      allFeedResults.push({
        sourceId: dbSources[index].id,
        sourceName: dbSources[index].name,
        sourceUrl: dbSources[index].url,
        status: FeedSyncStatus.FAILED,
        durationMs: 0,
        itemsFound: 0,
        itemsCreated: 0,
        errorCode: 'PROMISE_REJECTED',
        errorMessage: String(result.reason),
      })
    }
  })

  // 日付順 (古い順) にソートして返す
  const sortedItems = allItems.sort((a, b) => {
    const dateA = new Date(a.isoDate || 0)
    const dateB = new Date(b.isoDate || 0)
    return dateA.getTime() - dateB.getTime()
  })

  return { items: sortedItems, feedResults: allFeedResults }
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

export interface SaveNewsResult {
  count: number
  queuedCount: number
  queueFailureCount: number
  sourceCreatedCounts: Record<string, number>
  errors: string[]
  errorDetails: SyncErrorDetail[]
}

/**
 * 取得したニュース項目をデータベースに一括保存します。
 * 重複するURL（link）の記事は自動的にスキップされます。
 */
export async function saveNewsToDb(
  items: FeedItem[],
  options?: { enqueueOptions?: EnqueueOptions; jobExecutionId?: string | null }
): Promise<SaveNewsResult> {
  if (items.length === 0) {
    return {
      count: 0,
      queuedCount: 0,
      queueFailureCount: 0,
      sourceCreatedCounts: {},
      errors: [],
      errorDetails: [],
    }
  }

  const data = items.map((item) => {
    const isGoogle = isGoogleNews(item.link, item.sourceId)
    let extractedUrl: string | null = null
    let status: ImageFetchStatus = 'QUEUED'

    if (isGoogle) {
      extractedUrl = '/images/placeholder.png' // プロジェクト独自のプレースホルダー画像
      status = 'SUCCESS'
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
      createdJobExecutionId: options?.jobExecutionId || null,
    }
  })

  // DBトランザクション内で記事保存とカテゴリリレーション作成をアトミックに実行
  const result = await prisma.$transaction(async (tx) => {
    const createResult = await tx.newsItem.createMany({
      data,
      skipDuplicates: true,
    })

    if (createResult.count === 0) {
      return { count: 0, queuedArticles: [] as { id: string; link: string }[], sourceCreatedCounts: {} as Record<string, number> }
    }

    // 新規追加された記事を特定してカテゴリリレーションを作成する
    const savedArticles = await tx.newsItem.findMany({
      where: {
        link: {
          in: items.map((item) => item.link),
        },
      },
      select: {
        id: true,
        sourceId: true,
        link: true,
        imageFetchStatus: true,
        createdJobExecutionId: true,
      },
    })

    // 実際に保存された記事のソース別件数を集計
    const sourceCreatedCounts: Record<string, number> = {}
    for (const article of savedArticles) {
      if (!options?.jobExecutionId || article.createdJobExecutionId === options.jobExecutionId) {
        sourceCreatedCounts[article.sourceId] = (sourceCreatedCounts[article.sourceId] || 0) + 1
      }
    }

    const dbSources = await tx.source.findMany({
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
      await tx.newsItemCategory.createMany({
        data: joinRows,
        skipDuplicates: true,
      })
    }

    // キューイング対象（imageFetchStatus が QUEUED のもの）を抽出
    const queuedArticles = savedArticles
      .filter((article) => article.imageFetchStatus === 'QUEUED')
      .map((a) => ({ id: a.id, link: a.link }))

    return { count: createResult.count, queuedArticles, sourceCreatedCounts }
  })

  if (result.count === 0) {
    return {
      count: 0,
      queuedCount: 0,
      queueFailureCount: 0,
      sourceCreatedCounts: {},
      errors: [],
      errorDetails: [],
    }
  }

  const errors: string[] = []
  const errorDetails: SyncErrorDetail[] = []
  let queuedCount = 0
  let queueFailureCount = 0

  // トランザクション完了後、Vercel Queues へ送信（全体締切オプションを必ず伝播）
  if (result.queuedArticles.length > 0) {
    const enqueueResult = await enqueueImageFetch(result.queuedArticles, options?.enqueueOptions)
    queuedCount = enqueueResult.successCount
    queueFailureCount = enqueueResult.failureCount
    if (enqueueResult.failureCount > 0) {
      const queueError = `Queue enqueue failed: ${enqueueResult.failedIds.join(', ')}`
      console.warn(
        `Queue enqueue completed with ${enqueueResult.successCount} successes and ${enqueueResult.failureCount} failures. Failed IDs: ${enqueueResult.failedIds.join(', ')}`
      )
      errors.push(queueError)
      errorDetails.push({ type: 'queue', message: queueError })
    }
  }

  return {
    count: result.count,
    queuedCount,
    queueFailureCount,
    sourceCreatedCounts: result.sourceCreatedCounts,
    errors,
    errorDetails,
  }
}

/**
 * 孤立したQUEUED状態の記事を回収し、Queueへ再投入します。
 * @param thresholdMinutes QUEUED状態とみなす経過時間（分）。デフォルトは5分
 * @param options オプション（deadline等）
 */
export interface OrphanedQueueRecoveryResult {
  recoveredCount: number
  queueFailureCount: number
  errors: string[]
  errorDetails: SyncErrorDetail[]
}

export async function recoverOrphanedQueuedItems(
  thresholdMinutes: number = 5,
  options?: { deadline?: number }
): Promise<OrphanedQueueRecoveryResult> {
  const thresholdDate = new Date(Date.now() - thresholdMinutes * 60 * 1000)

  const orphanedItems = await prisma.newsItem.findMany({
    where: {
      imageFetchStatus: 'QUEUED',
      updatedAt: {
        lt: thresholdDate,
      },
    },
    select: {
      id: true,
      link: true,
      updatedAt: true,
    },
    take: 50, // 1回あたりの最大回収件数を50件に制限
    orderBy: {
      updatedAt: 'asc', // 古いものから優先回収
    },
  })

  if (orphanedItems.length === 0) {
    console.log('No orphaned QUEUED items found.')
    return { recoveredCount: 0, queueFailureCount: 0, errors: [], errorDetails: [] }
  }

  console.log(
    `Found ${orphanedItems.length} orphaned QUEUED items (older than ${thresholdMinutes} minutes). Attempting to re-enqueue...`
  )

  const itemsToEnqueue = orphanedItems.map((item) => ({ id: item.id, link: item.link }))
  const enqueueResult = await enqueueImageFetch(itemsToEnqueue, { deadline: options?.deadline })

  console.log(
    `Recovery completed: ${enqueueResult.successCount} re-enqueued successfully, ${enqueueResult.failureCount} failed.`
  )

  const errors: string[] = []
  const errorDetails: SyncErrorDetail[] = []
  if (enqueueResult.failureCount > 0) {
    const queueError = `Queue enqueue failed: ${enqueueResult.failedIds.join(', ')}`
    console.warn(`Failed to re-enqueue orphaned items with IDs: ${enqueueResult.failedIds.join(', ')}`)
    errors.push(queueError)
    errorDetails.push({ type: 'queue', message: queueError })
  }

  return {
    recoveredCount: enqueueResult.successCount,
    queueFailureCount: enqueueResult.failureCount,
    errors,
    errorDetails,
  }
}

export interface SyncNewsResult {
  addedCount: number;
  recoveredCount: number;
  errors: string[];
  itemsFound: number;
  itemsSkipped: number;
  feedTotalCount: number;
  feedSuccessCount: number;
  feedFailureCount: number;
  queuedCount: number;
  queueFailureCount: number;
  feedResults: FeedFetchResult[];
  errorDetails: SyncErrorDetail[];
  errorTypes: {
    phase: boolean;      // フェーズ障害（DB接続失敗・全Feed失敗など）
    feed: boolean;       // Feed失敗
    queue: boolean;      // Queue失敗
  };
}

/**
 * エラーの種別を管理するクラス
 */
class ErrorTracker {
  private readonly errorTypes = {
    phase: false,
    feed: false,
    queue: false,
  }
  private readonly errors: SyncErrorDetail[] = []

  addError(error: SyncErrorDetail) {
    this.errorTypes[error.type] = true
    this.errors.push(error)
  }

  addPhaseError(message: string) {
    this.addError({ type: 'phase', message })
  }

  markFeedFailure() {
    this.errorTypes.feed = true
  }

  addQueueError(message: string) {
    this.addError({ type: 'queue', message })
  }

  getErrorTypes() {
    return { ...this.errorTypes }
  }

  getErrors(): string[] {
    return this.errors.map((error) => error.message)
  }

  getErrorDetails(): SyncErrorDetail[] {
    return [...this.errors]
  }
}

/**
 * RSSから最新ニュースを取得し、データベースに保存する一連の処理を実行します（Cronから呼び出す用）。
 * RSSフェーズとSweeperフェーズのエラーを追跡し、結果を返却します。
 */
export async function syncNews(options?: { deadlineBudgetMs?: number; jobExecutionId?: string | null }): Promise<SyncNewsResult> {
  const deadline = options?.deadlineBudgetMs ? Date.now() + options.deadlineBudgetMs : Date.now() + 50000 // デフォルト50秒予算
  console.log('Starting RSS feed synchronization...')
  let addedCount = 0
  const errorTracker = new ErrorTracker()
  let itemsFound = 0
  let itemsSkipped = 0
  let feedTotalCount = 0
  let feedSuccessCount = 0
  let feedFailureCount = 0
  let queuedCount = 0
  let queueFailureCount = 0
  let feedResults: FeedFetchResult[] = []

  // 1. RSS取得と新着記事の保存（エラーがあっても記録してSweeperへ進む）
  try {
    const { items: latestItems, feedResults: fetchedFeedResults } = await fetchRssFeeds()

    feedResults = fetchedFeedResults
    feedTotalCount = feedResults.length
    feedSuccessCount = feedResults.filter((r) => r.status === FeedSyncStatus.SUCCESS).length
    feedFailureCount = feedResults.filter((r) => r.status !== FeedSyncStatus.SUCCESS).length

    // Feed失敗があれば記録
    if (feedFailureCount > 0) {
      errorTracker.markFeedFailure()
    }

    // 全Feedが失敗した場合は明示的にエラーとして記録
    if (feedTotalCount > 0 && feedSuccessCount === 0) {
      const allFeedsError = `All ${feedTotalCount} feeds failed to sync`
      console.error(allFeedsError)
      errorTracker.addPhaseError(allFeedsError)
    }

    if (latestItems.length > 0) {
      itemsFound = latestItems.length

      // 同一実行内での重複を事前に除外
      const uniqueItemsMap = new Map<string, FeedItem>()
      latestItems.forEach((item) => {
        if (!uniqueItemsMap.has(item.link)) {
          uniqueItemsMap.set(item.link, item)
        }
      })
      const uniqueItems = Array.from(uniqueItemsMap.values())
      const internalDuplicates = latestItems.length - uniqueItems.length

      const links = uniqueItems.map((item) => item.link).filter(Boolean)
      const existingItems = await prisma.newsItem.findMany({
        where: { link: { in: links } },
        select: { link: true },
      })
      const existingLinks = new Set(existingItems.map((item) => item.link))
      const newItems = uniqueItems.filter((item) => !existingLinks.has(item.link))
      itemsSkipped = internalDuplicates + (uniqueItems.length - newItems.length)

      if (newItems.length > 0) {
        console.log(`Fetched ${latestItems.length} items from RSS. Saving ${newItems.length} new items to DB...`)
        // 【重要】saveNewsToDb に全体締切 options を渡す
        const result = await saveNewsToDb(newItems, {
          enqueueOptions: { deadline },
          jobExecutionId: options?.jobExecutionId,
        })
        addedCount = result.count
        queuedCount += result.queuedCount
        queueFailureCount += result.queueFailureCount
        result.errorDetails.forEach((error) => errorTracker.addError(error))

        // 実際のDB保存成功件数を Feed ごとに反映
        feedResults = feedResults.map((feed) => ({
          ...feed,
          itemsCreated: result.sourceCreatedCounts[feed.sourceId] || 0,
        }))

        console.log(`Synchronization complete. Saved ${result.count} new news items.`)
      } else {
        console.log('All retrieved items already exist in the database.')
      }
    } else {
      console.log('No items retrieved from RSS feeds.')
    }
  } catch (rssError) {
    console.error('Error during RSS fetch / save phase:', rssError)
    errorTracker.addPhaseError(`RSS/Save Phase Error: ${rssError instanceof Error ? rssError.message : String(rssError)}`)
  }

  // 2. RSSの成否に関わらず、孤立キューの回収 Sweeper を必ず実行
  let recoveredCount = 0
  try {
    console.log('Running orphaned QUEUED items recovery...')
    const recoveryResult = await recoverOrphanedQueuedItems(5, { deadline })
    recoveredCount = recoveryResult.recoveredCount
    queueFailureCount += recoveryResult.queueFailureCount
    recoveryResult.errorDetails.forEach((error) => errorTracker.addError(error))
    console.log(`Recovery complete. Re-enqueued ${recoveredCount} orphaned items.`)
  } catch (sweeperError) {
    console.error('Error during orphaned QUEUED items recovery:', sweeperError)
    errorTracker.addPhaseError(`Sweeper Phase Error: ${sweeperError instanceof Error ? sweeperError.message : String(sweeperError)}`)
  }

  return {
    addedCount,
    recoveredCount,
    errors: errorTracker.getErrors(),
    itemsFound,
    itemsSkipped,
    feedTotalCount,
    feedSuccessCount,
    feedFailureCount,
    queuedCount,
    queueFailureCount,
    feedResults,
    errorDetails: errorTracker.getErrorDetails(),
    errorTypes: errorTracker.getErrorTypes(),
  }
}
