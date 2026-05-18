import { PrismaClient } from '@prisma/client'

import { PrismaPg } from '@prisma/adapter-pg'

// Prisma v7以降はDriver Adapter経由でデータベースに接続します
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL as string,
})
const prisma = new PrismaClient({ adapter })

// 受け取るニュースアイテムの型を定義します
interface FeedItem {
  guid?: string;
  title: string;
  link: string;
  isoDate?: string; // rss-parserの返す日付
  creator?: string;
  summary?: string;
  content?: string;
  contentSnippet?: string;
  categories?: string[];
  enclosure?: {
    url: string;
    length?: string | number;
    type?: string;
  };
  sourceId: string;
  sourceName: string;
}

export async function GET() {
  try {
    const items = await prisma.newsItem.findMany()
    return Response.json(items)
  } catch (error) {
    console.error("Failed to fetch news items:", error)
    return Response.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

// Next.js App RouterのPOSTメソッドは、引数に `Request` オブジェクトを受け取ります
export async function POST(request: Request) {
  try {
    // リクエストボディから JSON を取得し、型を当てはめます
    const items: FeedItem[] = await request.json()

    await prisma.newsItem.createMany({
      data: items.map(item => ({
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

    // 成功した場合は 200 OK のレスポンスを返します
    return Response.json({ success: true, count: items.length })
  } catch (error) {
    console.error("Failed to save news items:", error)
    // エラー時は 500 レスポンスを返します
    return Response.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
