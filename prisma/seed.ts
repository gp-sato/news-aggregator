import 'dotenv/config'
import { prisma } from '../lib/prisma'

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
    // --- domestic (国内) ---
    {
      id: 'nhk',
      name: 'NHK ニュース (主要)',
      url: 'https://www3.nhk.or.jp/rss/news/cat0.xml',
      defaultCategoryId: 'domestic',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'google_domestic',
      name: 'Google ニュース (国内)',
      url: 'https://news.google.com/rss/headlines/section/topic/NATION?hl=ja&gl=JP&ceid=JP:ja',
      defaultCategoryId: 'domestic',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'livedoor_domestic',
      name: 'ライブドアニュース (国内)',
      url: 'http://news.livedoor.com/topics/rss/dom.xml',
      defaultCategoryId: 'domestic',
      language: 'ja',
      country: 'JP',
    },

    // --- world (国際) ---
    {
      id: 'bbc',
      name: 'BBC News (JP)',
      url: 'https://feeds.bbci.co.uk/japanese/rss.xml',
      defaultCategoryId: 'world',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'nhk_world',
      name: 'NHK ニュース (国際)',
      url: 'https://www3.nhk.or.jp/rss/news/cat6.xml',
      defaultCategoryId: 'world',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'livedoor_world',
      name: 'ライブドアニュース (国際)',
      url: 'http://news.livedoor.com/topics/rss/int.xml',
      defaultCategoryId: 'world',
      language: 'ja',
      country: 'JP',
    },

    // --- business (経済) ---
    {
      id: 'nhk_business',
      name: 'NHK ニュース (経済)',
      url: 'https://www3.nhk.or.jp/rss/news/cat5.xml',
      defaultCategoryId: 'business',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'google_business',
      name: 'Google ニュース (ビジネス)',
      url: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=ja&gl=JP&ceid=JP:ja',
      defaultCategoryId: 'business',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'livedoor_business',
      name: 'ライブドアニュース (経済)',
      url: 'http://news.livedoor.com/topics/rss/eco.xml',
      defaultCategoryId: 'business',
      language: 'ja',
      country: 'JP',
    },

    // --- technology (テクノロジー) ---
    {
      id: 'itmedia',
      name: 'ITmedia',
      url: 'https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml',
      defaultCategoryId: 'technology',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'google_tech',
      name: 'Google ニュース (テクノロジー)',
      url: 'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=ja&gl=JP&ceid=JP:ja',
      defaultCategoryId: 'technology',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'hatena_tech',
      name: 'はてなブックマーク (テクノロジー)',
      url: 'https://b.hatena.ne.jp/hotentry/it.rss',
      defaultCategoryId: 'technology',
      language: 'ja',
      country: 'JP',
    },

    // --- politics (政治) ---
    {
      id: 'nhk_politics',
      name: 'NHK ニュース (政治)',
      url: 'https://www3.nhk.or.jp/rss/news/cat4.xml',
      defaultCategoryId: 'politics',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'google_politics',
      name: 'Google ニュース (政治)',
      url: 'https://news.google.com/rss/search?q=%E6%94%BF%E6%B2%BB&hl=ja&gl=JP&ceid=JP:ja',
      defaultCategoryId: 'politics',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'hatena_politics',
      name: 'はてなブックマーク（経済）',
      url: 'https://b.hatena.ne.jp/hotentry/economics.rss',
      defaultCategoryId: 'business',
      language: 'ja',
      country: 'JP',
    },

    // --- sports (スポーツ) ---
    {
      id: 'nhk_sports',
      name: 'NHK ニュース (スポーツ)',
      url: 'https://www3.nhk.or.jp/rss/news/cat7.xml',
      defaultCategoryId: 'sports',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'google_sports',
      name: 'Google ニュース (スポーツ)',
      url: 'https://news.google.com/rss/headlines/section/topic/SPORTS?hl=ja&gl=JP&ceid=JP:ja',
      defaultCategoryId: 'sports',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'livedoor_sports',
      name: 'ライブドアニュース (スポーツ)',
      url: 'http://news.livedoor.com/topics/rss/spo.xml',
      defaultCategoryId: 'sports',
      language: 'ja',
      country: 'JP',
    },

    // --- entertainment (エンタメ) ---
    {
      id: 'nhk_entertainment',
      name: 'NHK ニュース (エンタメ)',
      url: 'https://www3.nhk.or.jp/rss/news/cat2.xml',
      defaultCategoryId: 'entertainment',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'google_entertainment',
      name: 'Google ニュース (エンタメ)',
      url: 'https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=ja&gl=JP&ceid=JP:ja',
      defaultCategoryId: 'entertainment',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'livedoor_entertainment',
      name: 'ライブドアニュース (芸能・エンタメ)',
      url: 'http://news.livedoor.com/topics/rss/ent.xml',
      defaultCategoryId: 'entertainment',
      language: 'ja',
      country: 'JP',
    },

    // --- science (科学) ---
    {
      id: 'nhk_science',
      name: 'NHK ニュース (科学)',
      url: 'https://www3.nhk.or.jp/rss/news/cat3.xml',
      defaultCategoryId: 'science',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'google_science',
      name: 'Google ニュース (科学)',
      url: 'https://news.google.com/rss/headlines/section/topic/SCIENCE?hl=ja&gl=JP&ceid=JP:ja',
      defaultCategoryId: 'science',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'astroarts_science',
      name: 'AstroArts',
      url: 'https://www.astroarts.co.jp/article/feed.atom',
      defaultCategoryId: 'science',
      language: 'ja',
      country: 'JP',
    },

    // --- health (健康) ---
    {
      id: 'mhlw_health',
      name: '厚生労働省 (新着)',
      url: 'https://www.mhlw.go.jp/stf/news.rdf',
      defaultCategoryId: 'health',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'google_health',
      name: 'Google ニュース (健康)',
      url: 'https://news.google.com/rss/headlines/section/topic/HEALTH?hl=ja&gl=JP&ceid=JP:ja',
      defaultCategoryId: 'health',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'hatena_health',
      name: 'はてなブックマーク (生活・ヘルスケア)',
      url: 'https://b.hatena.ne.jp/hotentry/life.rss',
      defaultCategoryId: 'health',
      language: 'ja',
      country: 'JP',
    },

    // --- gourmet (グルメ) ---
    {
      id: 'gourmetpress',
      name: 'グルメプレス',
      url: 'https://gourmetpress.net/feed/',
      defaultCategoryId: 'gourmet',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'google_gourmet',
      name: 'Google ニュース (グルメ)',
      url: 'https://news.google.com/rss/search?q=%E3%82%B0%E3%83%AB%E3%83%A1&hl=ja&gl=JP&ceid=JP:ja',
      defaultCategoryId: 'gourmet',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'foodrink_gourmet',
      name: 'フードリンクニュース',
      url: 'https://www.foodrink.co.jp/rss.xml',
      defaultCategoryId: 'gourmet',
      language: 'ja',
      country: 'JP',
    },

    // --- other (その他) ---
    {
      id: 'google',
      name: 'Google News (総合)',
      url: 'https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja',
      defaultCategoryId: 'other',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'hatena_other',
      name: 'はてなブックマーク (総合)',
      url: 'https://b.hatena.ne.jp/hotentry.rss',
      defaultCategoryId: 'other',
      language: 'ja',
      country: 'JP',
    },
    {
      id: 'livedoor_other',
      name: 'ライブドアニュース (主要)',
      url: 'http://news.livedoor.com/topics/rss/top.xml',
      defaultCategoryId: 'other',
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
