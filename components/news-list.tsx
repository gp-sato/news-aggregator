'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import useSWRInfinite from 'swr/infinite';

export interface NewsItem {
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
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const trimmedSearchQuery = searchQuery.trim();

  const getKey = (pageIndex: number, previousPageData: NewsItem[]) => {
    // 最後に到達したか、前のデータが空の場合は null を返してフェッチを停止する
    if (previousPageData && !previousPageData.length) return null;
    const params = new URLSearchParams({
      category: currentCategory,
      page: String(pageIndex + 1),
      limit: '20',
    });

    if (trimmedSearchQuery) {
      params.set('q', trimmedSearchQuery);
    }

    return `/api/news?${params.toString()}`;
  };

  const { data, size, setSize, error } = useSWRInfinite<NewsItem[]>(
    getKey,
    fetcher,
    {
      fallbackData: trimmedSearchQuery ? undefined : [initialItems],
      revalidateFirstPage: false,
      persistSize: false,
    }
  );

  const newsItems = data ? data.flat() : [];
  const isSearching = trimmedSearchQuery.length > 0;
  const resultLabel = useMemo(() => {
    if (!isSearching) return null;
    return `${trimmedSearchQuery} の検索結果`;
  }, [isSearching, trimmedSearchQuery]);
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

  useEffect(() => {
    setSize(1);
  }, [currentCategory, trimmedSearchQuery, setSize]);

  useEffect(() => {
    if (isSearchOpen) {
      searchInputRef.current?.focus();
    }
  }, [isSearchOpen]);

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearchQuery(searchInput);
  };

  const handleSearchInputChange = (value: string) => {
    setSearchInput(value);
    setSearchQuery(value);
  };

  const clearSearch = () => {
    setSearchInput('');
    setSearchQuery('');
    searchInputRef.current?.focus();
  };

  return (
    <div className="space-y-6">
      <div className="fixed right-4 top-32 sm:right-6 sm:top-40 z-40 flex flex-col items-end gap-4">
        <button
          type="button"
          onClick={() => setIsSearchOpen((isOpen) => !isOpen)}
          className="h-14 w-14 rounded-full bg-accent text-white shadow-lg shadow-accent/30 flex items-center justify-center transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:ring-offset-2 focus:ring-offset-background"
          aria-label={isSearchOpen ? '検索ウィンドウを閉じる' : '検索ウィンドウを開く'}
          aria-expanded={isSearchOpen}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-7 w-7"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.197 5.197a7.5 7.5 0 0 0 10.606 10.606Z" />
          </svg>
        </button>

        {isSearchOpen && (
          <section className="glass w-[min(calc(100vw-2rem),24rem)] rounded-2xl p-5 sm:p-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="mb-5 flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold">ニュースを検索</h2>
              <button
                type="button"
                onClick={() => setIsSearchOpen(false)}
                className="h-10 w-10 rounded-full flex items-center justify-center text-foreground/50 transition-colors hover:bg-foreground/5 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50"
                aria-label="検索ウィンドウを閉じる"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSearchSubmit} className="relative">
              <input
                ref={searchInputRef}
                type="search"
                value={searchInput}
                onChange={(event) => handleSearchInputChange(event.target.value)}
                placeholder="キーワードを入力"
                className="w-full rounded-xl border border-card-border bg-background/70 px-4 py-3 pr-20 text-sm outline-none transition-colors placeholder:text-foreground/35 focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-11 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full flex items-center justify-center text-foreground/40 transition-colors hover:bg-foreground/5 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50"
                  aria-label="検索キーワードをクリア"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
              <button
                type="submit"
                className="absolute right-2 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full flex items-center justify-center text-foreground/50 transition-colors hover:bg-accent/10 hover:text-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
                aria-label="検索する"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.197 5.197a7.5 7.5 0 0 0 10.606 10.606Z" />
                </svg>
              </button>
            </form>

            {resultLabel && (
              <p className="mt-4 border-t border-card-border pt-4 text-sm text-foreground/50">
                {resultLabel}
              </p>
            )}
          </section>
        )}
      </div>

      {resultLabel && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card-bg px-4 py-3 text-sm text-foreground/60">
          <span className="min-w-0 truncate">{resultLabel}</span>
          <button
            type="button"
            onClick={clearSearch}
            className="shrink-0 text-accent transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-accent/50 rounded-md px-2 py-1"
          >
            解除
          </button>
        </div>
      )}

      {/* ニュース項目一覧 */}
      <div className="space-y-6">
        {newsItems.map((item) => (
          <article
            key={item.link}
            className="glass glass-hover rounded-xl sm:rounded-2xl p-4 sm:p-6 transition-all duration-300 group animate-in fade-in slide-in-from-bottom-4 duration-500"
          >
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3 mb-4 w-full min-w-0">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
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
              </div>
              <time className="text-xs sm:text-sm text-foreground/40 font-medium sm:ml-auto">
                {formatDate(item.pubDate)}
              </time>
            </div>

            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="block group-hover:text-accent transition-colors"
            >
              <h2 className="text-lg sm:text-xl md:text-2xl font-semibold leading-snug mb-2 break-words [overflow-wrap:anywhere]">
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
            <p className="text-foreground/50 mb-2">
              {isSearching ? '一致するニュースがありません。' : '表示するニュースがありません。'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
