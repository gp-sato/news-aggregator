'use client';

import { useEffect, useRef } from 'react';
import useSWRInfinite from 'swr/infinite';

interface NewsItem {
  id: string;
  guid: string | null;
  title: string;
  link: string;
  pubDate: string | null;
  creator: string | null;
  summary: string | null;
  content: string | null;
  contentSnippet: string | null;
  rawCategories: string[];
  enclosureUrl: string | null;
  enclosureLength: number | null;
  enclosureType: string | null;
  sourceId: string;
  source: {
    id: string;
    name: string;
  };
  categories: {
    categoryId: string;
    method: string;
    confidence: number | null;
    category: {
      id: string;
      label: string;
    };
  }[];
  createdAt: string;
  updatedAt: string;
}

interface NewsListProps {
  initialItems: NewsItem[];
  currentCategory: string;
}

const fetcher = (url: string) => fetch(url).then((res) => {
  if (!res.ok) {
    throw new Error('Failed to fetch data');
  }
  return res.json();
});

function formatDate(dateInput: string | null | undefined) {
  if (!dateInput) return '不明な日付';
  const date = new Date(dateInput);
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function NewsList({ initialItems, currentCategory }: NewsListProps) {
  const getKey = (pageIndex: number, previousPageData: NewsItem[]) => {
    // 最後に到達したか、前のデータが空の場合は null を返してフェッチを停止する
    if (previousPageData && !previousPageData.length) return null;
    return `/api/news?category=${currentCategory}&page=${pageIndex + 1}&limit=20`;
  };

  const { data, size, setSize, isValidating, error } = useSWRInfinite<NewsItem[]>(
    getKey,
    fetcher,
    {
      fallbackData: [initialItems],
      revalidateFirstPage: false,
      persistSize: false,
    }
  );

  const newsItems = data ? data.flat() : [];
  const isLoadingInitialData = !data && !error;
  const isLoadingMore =
    isLoadingInitialData ||
    (size > 0 && data && typeof data[size - 1] === 'undefined');
  
  // 取得された最後のページのアイテム数が20未満の場合、または空の場合に「最後まで読み込み完了」とする
  const isEmpty = data?.[0]?.length === 0;
  const isReachingEnd =
    isEmpty || (data && data[data.length - 1]?.length < 20);

  const observerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingMore && !isReachingEnd) {
          setSize((prevSize) => prevSize + 1);
        }
      },
      { threshold: 0.1 }
    );

    const currentObserverRef = observerRef.current;
    if (currentObserverRef) {
      observer.observe(currentObserverRef);
    }

    return () => {
      if (currentObserverRef) {
        observer.unobserve(currentObserverRef);
      }
    };
  }, [isLoadingMore, isReachingEnd, setSize]);

  return (
    <div className="space-y-6">
      {/* ニュース項目一覧 */}
      <div className="space-y-6">
        {newsItems.map((item) => (
          <article
            key={item.link}
            className="glass glass-hover rounded-2xl p-6 transition-all duration-300 group animate-in fade-in slide-in-from-bottom-4 duration-500"
          >
            <div className="flex flex-wrap items-center gap-3 mb-4 w-full">
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-accent/20 text-accent border border-accent/30 tracking-wider uppercase">
                {item.source.name}
              </span>
              {item.categories && item.categories.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {item.categories.map((c) => (
                    <span
                      key={c.categoryId}
                      className="px-2.5 py-0.5 rounded-full bg-foreground/5 text-foreground/60 border border-foreground/10 text-[10px] font-medium tracking-wide"
                    >
                      {c.category.label}
                    </span>
                  ))}
                </div>
              )}
              <time className="text-sm text-foreground/40 font-medium sm:ml-auto">
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

      {/* スクロール監視エリア ＆ ローディング・エラー・完了表示 */}
      <div ref={observerRef} className="pt-6 pb-12 flex flex-col items-center justify-center">
        {isLoadingMore && (
          <div className="w-full space-y-6">
            {/* スケルトンローダー（3件分） */}
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass rounded-2xl p-6 animate-pulse">
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-6 w-20 bg-foreground/10 rounded-full"></div>
                  <div className="h-4 w-28 bg-foreground/10 rounded"></div>
                </div>
                <div className="space-y-2 mb-4">
                  <div className="h-6 w-full bg-foreground/10 rounded"></div>
                  <div className="h-6 w-2/3 bg-foreground/10 rounded"></div>
                </div>
                <div className="flex justify-end">
                  <div className="h-4 w-16 bg-foreground/10 rounded"></div>
                </div>
              </div>
            ))}
            {/* スピナー */}
            <div className="flex justify-center items-center py-4">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-accent"></div>
            </div>
          </div>
        )}

        {error && (
          <div className="glass border-red-500/30 text-red-500 rounded-2xl p-6 text-center w-full max-w-md">
            <p className="font-semibold mb-2">データの読み込みに失敗しました。</p>
            <button
              onClick={() => setSize(size)}
              className="px-4 py-2 bg-accent/20 hover:bg-accent/30 text-accent rounded-lg text-sm transition-colors border border-accent/30"
            >
              再試行する
            </button>
          </div>
        )}

        {!isLoadingMore && isReachingEnd && !isEmpty && (
          <div className="text-center py-6 text-foreground/40 animate-in fade-in duration-700">
            <div className="flex items-center justify-center gap-2 mb-2">
              <div className="h-[1px] w-8 bg-card-border"></div>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-accent/50" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="text-sm font-medium tracking-wide">すべてのニュースを読み込みました</span>
              <div className="h-[1px] w-8 bg-card-border"></div>
            </div>
            <p className="text-xs text-foreground/30">今日も素晴らしい一日をお過ごしください！</p>
          </div>
        )}

        {!isLoadingMore && isEmpty && (
          <div className="glass rounded-2xl p-12 text-center w-full">
            <p className="text-foreground/50 mb-2">表示するニュースがありません。</p>
          </div>
        )}
      </div>
    </div>
  );
}
