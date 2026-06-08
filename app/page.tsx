import { Metadata } from 'next';
import Link from 'next/link';
import { ThemeToggle } from '@/components/theme-toggle';
import { getNewsFromDb } from '@/lib/news';
import { TABS } from '@/lib/sources';
import { NewsList } from '@/components/news-list';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'NexusFeed - Premium Feed',
  description: 'A curated list of news from multiple Japanese sources, updated in real-time.',
};

async function getNews(source?: string, skip?: number, take?: number) {
  try {
    const items = await getNewsFromDb(source, skip, take);
    return {
      items: items.map((item) => ({
        ...item,
        pubDate: item.pubDate ? item.pubDate.toISOString() : null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
    };
  } catch (error) {
    console.error("Failed to load news from database:", error);
    return { items: [] };
  }
}

interface PageProps {
  searchParams: Promise<{ source?: string }> | { source?: string };
}


export default async function NewsPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const currentSource = resolvedSearchParams.source || 'all';

  const { items } = await getNews(currentSource, 0, 20);

  return (
    <main className="min-h-screen py-12 px-4 md:px-8 max-w-4xl mx-auto">
      <div className="flex justify-end mb-4">
        <ThemeToggle />
      </div>

      <header className="mb-12 text-center">
        <h1 className="text-4xl md:text-6xl font-bold mb-4 text-gradient tracking-tight">
          NexusFeed
        </h1>
        <p className="text-foreground/60 text-lg">
          複数のソースから統合された最新のニュース
        </p>
      </header>

      <div className='flex space-x-2 border-b border-card-border mb-6 overflow-x-auto overflow-y-hidden'>
        {TABS.map((tab) => {
          const isActive = currentSource === tab.id;
          return (
            <Link
              key={tab.id}
              href={tab.id === 'all' ? '/' : `/?source=${tab.id}`}
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

      <NewsList key={currentSource} initialItems={items} currentSource={currentSource} />

      <footer className="mt-16 text-center text-foreground/30 text-sm border-t border-card-border pt-8">
        &copy; {new Date().getFullYear()} NexusFeed. Crafted with precision.
      </footer>
    </main>
  );
}
