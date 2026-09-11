import { Metadata } from 'next';
import { ThemeToggle } from '@/components/theme-toggle';
import { NewsContainer } from '@/components/news-container';
import { prisma } from '@/lib/prisma';

export const revalidate = 3600; // Revalidate every hour for categories (rarely change)

export const metadata: Metadata = {
  title: 'NexusFeed - Premium Feed',
  description: 'A curated list of news from multiple Japanese sources, updated in real-time.',
};

export default async function NewsPage() {
  // カテゴリ一覧のみ取得（軽量・頻繁変更なし）
  const dbCategories = await prisma.category.findMany({
    orderBy: { sortOrder: 'asc' },
  });

  const categories = [
    { id: 'all', label: 'すべて' },
    { id: 'bookmarks', label: '後で読む' },
    ...dbCategories.map((c) => ({ id: c.id, label: c.label })),
  ];

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

      {/* カテゴリタブ + SWRによるニュース一覧取得コンポーネント */}
      <NewsContainer categories={categories} />

      <footer className="mt-16 text-center text-foreground/30 text-sm border-t border-card-border pt-8">
        &copy; {new Date().getFullYear()} NexusFeed. Crafted with precision.
      </footer>
    </main>
  );
}