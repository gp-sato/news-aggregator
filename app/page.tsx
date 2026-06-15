import { Metadata } from 'next';
import Link from 'next/link';
import { ThemeToggle } from '@/components/theme-toggle';
import { getNewsFromDb } from '@/lib/news';
import { NewsList } from '@/components/news-list';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'NexusFeed - Premium Feed',
  description: 'A curated list of news from multiple Japanese sources, updated in real-time.',
};

async function getNews(category?: string, skip?: number, take?: number) {
  try {
    const items = await getNewsFromDb({
      category: category !== 'all' ? category : undefined,
      skip,
      take,
    });
    return {
      items: items.map((item) => ({
        ...item,
        pubDate: item.pubDate ? item.pubDate.toISOString() : null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        source: {
          id: item.source.id,
          name: item.source.name,
        },
        categories: item.categories.map((c) => ({
          categoryId: c.categoryId,
          method: c.method,
          confidence: c.confidence,
          category: {
            id: c.category.id,
            label: c.category.label,
          },
        })),
      })),
    };
  } catch (error) {
    console.error("Failed to load news from database:", error);
    return { items: [] };
  }
}

interface PageProps {
  searchParams: Promise<{ category?: string }> | { category?: string };
}

export default async function NewsPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const currentCategory = resolvedSearchParams.category || 'all';

  // DBからカテゴリ一覧を取得
  const dbCategories = await prisma.category.findMany({
    orderBy: { sortOrder: 'asc' },
  });

  const tabs = [
    { id: 'all', label: 'すべて' },
    ...dbCategories.map((c) => ({ id: c.id, label: c.label })),
  ];

  const { items } = await getNews(currentCategory, 0, 20);

  return (
    <main className="min-h-screen w-full max-w-4xl mx-auto px-3 py-8 sm:px-4 sm:py-10 md:px-8 md:py-12 overflow-x-hidden">
      <div className="flex justify-end mb-4">
        <ThemeToggle />
      </div>

      <header className="mb-8 text-center sm:mb-12">
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold mb-3 sm:mb-4 text-gradient tracking-tight break-words">
          NexusFeed
        </h1>
        <p className="text-foreground/60 text-sm sm:text-base md:text-lg">
          複数のソースから統合された最新のニュース
        </p>
      </header>

      <div className='flex space-x-2 border-b border-card-border mb-6 overflow-x-auto overflow-y-hidden'>
        {tabs.map((tab) => {
          const isActive = currentCategory === tab.id;
          return (
            <Link
              key={tab.id}
              href={tab.id === 'all' ? '/' : `/?category=${tab.id}`}
              className={`px-4 py-2 text-sm font-medium transition-colors duration-200 -mb-px whitespace-nowrap ${isActive
                ? 'border-b-2 border-accent text-accent'
                : 'text-foreground/50 hover:text-foreground/80 border-b-2 border-transparent'
                }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <NewsList key={currentCategory} initialItems={items as any} currentCategory={currentCategory} />

      <footer className="mt-16 text-center text-foreground/30 text-sm border-t border-card-border pt-8">
        &copy; {new Date().getFullYear()} NexusFeed. Crafted with precision.
      </footer>
    </main>
  );
}
