import 'dotenv/config'
import { prisma } from '../lib/prisma'

/**
 * Data migration script to update RSS source URLs
 * 
 * This script updates the following sources without changing their IDs:
 * - foodrink_gourmet: URL to https://www.foodrink.co.jp/rss.xml
 * - hatena_politics: Name to "はてなブックマーク（経済）", URL to https://b.hatena.ne.jp/hotentry/economics.rss, defaultCategoryId to business
 * - astroarts_science: URL to https://www.astroarts.co.jp/article/feed.atom
 * 
 * Run with: npx tsx scripts/migrate-rss-sources.ts
 */

async function main() {
  console.log('Starting RSS source URL migration...')

  // Update foodrink_gourmet
  const foodrinkResult = await prisma.source.update({
    where: { id: 'foodrink_gourmet' },
    data: {
      url: 'https://www.foodrink.co.jp/rss.xml',
    },
  })
  console.log(`Updated foodrink_gourmet:`, foodrinkResult)

  // Update hatena_politics (name, URL, and defaultCategoryId)
  const hatenaResult = await prisma.source.update({
    where: { id: 'hatena_politics' },
    data: {
      name: 'はてなブックマーク（経済）',
      url: 'https://b.hatena.ne.jp/hotentry/economics.rss',
      defaultCategoryId: 'business',
    },
  })
  console.log(`Updated hatena_politics:`, hatenaResult)

  // Update astroarts_science
  const astroartsResult = await prisma.source.update({
    where: { id: 'astroarts_science' },
    data: {
      url: 'https://www.astroarts.co.jp/article/feed.atom',
    },
  })
  console.log(`Updated astroarts_science:`, astroartsResult)

  console.log('RSS source URL migration completed successfully.')
}

main()
  .catch((e) => {
    console.error('Migration failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
