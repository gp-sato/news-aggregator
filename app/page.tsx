import { Metadata } from 'next';
import { ThemeToggle } from '@/components/theme-toggle';
import { getNewsFromDb } from '@/lib/news';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'NexusFeed - Premium Feed',
  description: 'A curated list of news from multiple Japanese sources, updated in real-time.',
};

async function getNews() {
  try {
    const items = await getNewsFromDb();
    return { items };
  } catch (error) {
    console.error("Failed to load news from database:", error);
    return { items: [] };
  }
}

function formatDate(dateInput: string | Date | null | undefined) {
  if (!dateInput) return '不明な日付';
  const date = new Date(dateInput);
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}


export default async function NewsPage() {
  const { items } = await getNews();

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

      <div className="space-y-6">
        {items.map((item: any) => (
          <article
            key={item.link}
            className="glass glass-hover rounded-2xl p-6 transition-all duration-300 group"
          >
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-accent/20 text-accent border border-accent/30 tracking-wider uppercase">
                {item.sourceName}
              </span>
              <time className="text-sm text-foreground/40 font-medium">
                {formatDate(item.pubDate)}
              </time>
            </div>

            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="block group-hover:text-accent transition-colors"
            >
              <h2 className="text-xl md:text-2xl font-semibold leading-snug mb-2">
                {item.title}
              </h2>
            </a>

            <div className="flex justify-end">
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 font-medium"
              >
                続きを読む
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </a>
            </div>
          </article>
        ))}
      </div>

      <footer className="mt-16 text-center text-foreground/30 text-sm border-t border-card-border pt-8">
        &copy; {new Date().getFullYear()} NexusFeed. Crafted with precision.
      </footer>
    </main>
  );
}
