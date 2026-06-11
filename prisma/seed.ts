import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding categories...')
  const categories = [
    { id: 'domestic', label: '国内', sortOrder: 10 },
    { id: 'world', label: '国際', sortOrder: 20 },
    { id: 'business', label: '経済', sortOrder: 30 },
    { id: 'technology', label: 'テクノロジー', sortOrder: 40 },
    { id: 'politics', label: '政治', sortOrder: 50 },
    { id: 'sports', label: 'スポーツ', sortOrder: 60 },
    { id: 'entertainment', label: 'エンタメ', sortOrder: 70 },
    { id: 'science', label: '科学', sortOrder: 80 },
    { id: 'health', label: '健康', sortOrder: 90 },
    { id: 'gourmet', label: 'グルメ', sortOrder: 100 },
    { id: 'other', label: 'その他', sortOrder: 999 },
  ]

  for (const category of categories) {
    await prisma.category.upsert({
      where: { id: category.id },
      update: {
        label: category.label,
        sortOrder: category.sortOrder,
      },
      create: {
        id: category.id,
        label: category.label,
        sortOrder: category.sortOrder,
      },
    })
  }

  console.log('Seeding sources...')
  const sources = [
    {
      id: 'google',
      name: 'Google News',
      url: 'https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja',
      defaultCategoryId: 'other',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'nhk',
      name: 'NHK ニュース',
      url: 'https://news.web.nhk/n-data/conf/na/rss/cat0.xml',
      defaultCategoryId: 'domestic',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'bbc',
      name: 'BBC News (JP)',
      url: 'https://feeds.bbci.co.uk/japanese/rss.xml',
      defaultCategoryId: 'world',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'itmedia',
      name: 'ITmedia',
      url: 'https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml',
      defaultCategoryId: 'technology',
      language: 'ja',
      country: 'JP',
    },
  ]

  for (const source of sources) {
    await prisma.source.upsert({
      where: { id: source.id },
      update: {
        name: source.name,
        url: source.url,
        defaultCategoryId: source.defaultCategoryId,
        language: source.language,
        country: source.country,
      },
      create: {
        id: source.id,
        name: source.name,
        url: source.url,
        defaultCategoryId: source.defaultCategoryId,
        language: source.language,
        country: source.country,
      },
    })
  }

  console.log('Seeding completed successfully.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
