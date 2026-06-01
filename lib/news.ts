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
  sourceName: string
}

export const SOURCES = [
  {
    id: 'google',
    name: 'Google News',
    url: 'https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja',
  },
  {
    id: 'nhk',
    name: 'NHK ニュース',
    url: 'https://news.web.nhk/n-data/conf/na/rss/cat0.xml',
  },
  {
    id: 'bbc',
    name: 'BBC News (JP)',
    url: 'https://feeds.bbci.co.uk/japanese/rss.xml',
  },
  {
    id: 'itmedia',
    name: 'ITmedia',
    url: 'https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml',
  },
]

/**
 * 外部のRSSソースから最新のニュース記事を取得します。
 */
export async function fetchRssFeeds(): Promise<FeedItem[]> {
  const parser = new Parser()
  const feedPromises = SOURCES.map(async (source) => {
    try {
      // 外部サーバーへの負荷軽減とアクセスの高速化のため、Next.jsのData Cache（10分間再検証）を適用してXMLを取得します
      const res = await fetch(source.url, { next: { revalidate: 60 * 10 } })
      if (!res.ok) {
        throw new Error(`Failed to fetch XML. Status: ${res.status}`)
      }
      const xmlString = await res.text()
      const feed = await parser.parseString(xmlString)
      return feed.items.map((item) => ({
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
        sourceName: source.name,
      }))
    } catch (error) {
      console.error(`Failed to fetch RSS from ${source.name}:`, error)
      return []
    }
  })

  const results = await Promise.allSettled(feedPromises)
  const flattenedItems = results
    .map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value
      } else {
        console.error(`Failed to fetch ${SOURCES[index].name} feed promise:`, result.reason)
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
export async function getNewsFromDb(source?: string) {
  const whereCondition = source && source !== 'all' ? { sourceId: source } : undefined;

  return prisma.newsItem.findMany({
    where: whereCondition,
    orderBy: {
      pubDate: 'desc',
    },
  })
}

/**
 * 取得したニュース項目をデータベースに一括保存します。
 * 重複するURL（link）の記事は自動的にスキップされます。
 */
export async function saveNewsToDb(items: FeedItem[]) {
  if (items.length === 0) return { count: 0 }

  const result = await prisma.newsItem.createMany({
    data: items.map((item) => ({
      guid: item.guid,
      title: item.title,
      link: item.link,
      pubDate: item.isoDate ? new Date(item.isoDate) : null,
      creator: item.creator,
      summary: item.summary,
      content: item.content,
      contentSnippet: item.contentSnippet,
      categories: item.categories || [],
      enclosureUrl: item.enclosure?.url,
      enclosureLength: item.enclosure?.length ? parseInt(String(item.enclosure.length)) : null,
      enclosureType: item.enclosure?.type,
      sourceId: item.sourceId,
      sourceName: item.sourceName,
    })),
    skipDuplicates: true,
  })

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

  console.log(`Fetched ${latestItems.length} items from RSS. Saving to DB...`)
  const result = await saveNewsToDb(latestItems)
  console.log(`Synchronization complete. Saved ${result.count} new news items.`)

  return result
}
