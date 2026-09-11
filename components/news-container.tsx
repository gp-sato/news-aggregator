'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { NewsList } from './news-list';

interface Category {
  id: string;
  label: string;
}

interface NewsContainerProps {
  categories: Category[];
}

function NewsContent({ categories }: NewsContainerProps) {
  const searchParams = useSearchParams();
  const currentCategory = searchParams.get('category') || 'all';

  return (
    <>
      {/* カテゴリタブ */}
      <div className='flex space-x-2 border-b border-card-border mb-6 overflow-x-auto overflow-y-hidden no-scrollbar'>
        {categories.map((category) => {
          const isActive = currentCategory === category.id;
          return (
            <a
              key={category.id}
              href={category.id === 'all' ? '/' : `/?category=${category.id}`}
              className={`px-4 py-2 text-sm font-medium transition-colors duration-200 -mb-px whitespace-nowrap ${
                isActive
                  ? 'border-b-2 border-accent text-accent'
                  : 'text-foreground/50 hover:text-foreground/80 border-b-2 border-transparent'
              }`}
            >
              {category.label}
            </a>
          );
        })}
      </div>

      {/* ニュースリスト - SWRでクライアント側フェッチ */}
      <NewsList />
    </>
  );
}

export function NewsContainer({ categories }: NewsContainerProps) {
  return (
    <Suspense fallback={<div className="min-h-[400px]">Loading...</div>}>
      <NewsContent categories={categories} />
    </Suspense>
  );
}