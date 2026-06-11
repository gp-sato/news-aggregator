# News Source and Category Redesign Plan

## Purpose

This document summarizes the agreed design for improving the current news aggregator implementation.

The current app has these limitations:

- News sources are managed in a source file, currently `lib/sources.ts`.
- Articles are saved in the database, but sources are not first-class database entities.
- App-level categories are not modeled.
- Existing `NewsItem.categories` stores RSS-provided category strings only.
- The top page currently uses source-based tabs.

The goal is to move toward a more maintainable structure where:

- News sources are managed in the database.
- Categories are modeled explicitly.
- Articles can belong to multiple categories.
- The UI uses category tabs instead of source tabs.
- The design remains simple at first, but can later support keyword rules, AI classification, source filters, and admin screens.

## Current Implementation Notes

Relevant files in the current repository:

- `lib/sources.ts`
  - Defines `SOURCES`.
  - Defines `TABS` from sources.
- `lib/news.ts`
  - Fetches RSS feeds from `SOURCES`.
  - Saves articles to `NewsItem`.
  - Reads articles by `sourceId`.
- `prisma/schema.prisma`
  - Defines only `NewsItem`.
  - Stores `sourceId` and `sourceName` as plain strings.
  - Stores RSS categories as `categories String[]`.
- `app/page.tsx`
  - Uses source tabs.
- `app/api/news/route.ts`
  - Accepts `source` query parameter.
- `components/news-list.tsx`
  - Displays article source.
  - Already has a `categories` field in the client-side type, but does not show app-level category badges.

## Agreed Decisions

### Source Management

Sources should be moved from file-based runtime configuration to database-backed configuration.

Decision:

- Use a `Source` table.
- Do not build an admin screen yet.
- Manage initial sources through seed data.
- Keep `Source.id` as a fixed human-readable string.

Examples:

- `google`
- `nhk`
- `bbc`
- `itmedia`

Reasoning:

- This removes hardcoded runtime source configuration.
- It keeps implementation simple.
- It avoids building authentication, admin forms, and operational UI too early.
- It allows future admin management without changing article/source relationships.

### Category Management

Categories should become first-class database entities.

Decision:

- Use a `Category` table.
- Keep `Category.id` as a fixed human-readable string.
- Do not use generated `cuid()` category IDs.
- Do not add a separate `slug` initially, because the fixed `id` can serve as both identifier and URL/API value.

Reasoning:

- Category IDs will be used in seed data, default source category mapping, URLs, API query parameters, and UI tabs.
- Fixed IDs keep the implementation simple and readable.

### Initial Categories

Use these 11 initial categories:

| ID | Label |
| --- | --- |
| `domestic` | 国内 |
| `world` | 国際 |
| `business` | 経済 |
| `technology` | テクノロジー |
| `politics` | 政治 |
| `sports` | スポーツ |
| `entertainment` | エンタメ |
| `science` | 科学 |
| `health` | 健康 |
| `gourmet` | グルメ |
| `other` | その他 |

### Default Category Per Source

Initial classification should use only the source's default category.

Agreed defaults:

| Source ID | Source Name | Default Category |
| --- | --- | --- |
| `google` | Google News | `other` |
| `nhk` | NHK ニュース | `domestic` |
| `bbc` | BBC News (JP) | `world` |
| `itmedia` | ITmedia | `technology` |

Reasoning:

- This is simple and predictable.
- It avoids premature keyword or AI classification complexity.
- It gives every article a usable app-level category immediately.
- It can later be expanded with rule-based or AI-based classification.

### Article Categories

Articles should support multiple app-level categories.

Decision:

- Use a many-to-many join table between `NewsItem` and `Category`.
- Name it something like `NewsItemCategory`.
- UI should be able to display multiple category badges.

Reasoning:

- News often belongs to multiple categories, for example politics + business or technology + health.
- Even though the first implementation assigns only one category per article, the data model and UI should be ready for multiple categories.

### RSS Categories

RSS-provided categories should be preserved, but separated from app-level categories.

Decision:

- Rename or migrate the current `NewsItem.categories String[]` to `rawCategories String[]`.
- App-level categories should be represented by `Category` and `NewsItemCategory`.

Reasoning:

- RSS categories are source-provided raw metadata.
- They are useful for debugging and future classification improvements.
- They should not be treated as normalized app categories.

### Classification Metadata

The join table should store how the category was assigned.

Decision:

- Add `method`.
- Initial value should be `source-default`.
- Add nullable `confidence`.

Example:

```prisma
model NewsItemCategory {
  newsItemId String
  categoryId String
  method     String   @default("source-default")
  confidence Float?

  newsItem   NewsItem @relation(fields: [newsItemId], references: [id])
  category   Category @relation(fields: [categoryId], references: [id])

  @@id([newsItemId, categoryId])
}
```

Reasoning:

- `method` makes future classification sources explicit.
- Initial method is `source-default`.
- Later methods can include `rule`, `ai`, and `manual`.
- `confidence` is nullable because source-default classification does not calculate a real confidence score.
- Future AI or rule-based classification can populate `confidence` using a `0.0` to `1.0` scale.

### API Query Parameters

The public/news API should become category-first.

Decision:

- Change the main API query parameter from `source` to `category`.
- Keep the internal function capable of accepting `source` too.

Current:

```text
/api/news?source=nhk&page=1&limit=20
```

Target:

```text
/api/news?category=technology&page=1&limit=20
```

Internal function should be shaped for future source filtering:

```ts
getNewsFromDb({
  category: 'technology',
  source: 'itmedia',
  skip: 0,
  take: 20,
})
```

Important:

- The UI should use category tabs only for now.
- The API route should read `category`.
- The internal DB query helper should retain `source` support for later use.
- A future API could support both:

```text
/api/news?category=technology&source=itmedia
```

### Sorting

Keep the current sorting behavior.

Decision:

- Sort by `pubDate desc`.
- Apply this to both:
  - all articles
  - category-filtered articles

Reasoning:

- News freshness is the most important ordering signal.
- This preserves current user-facing behavior.

### UI

Change the top page from source tabs to category tabs.

Decision:

- Replace source tabs with category tabs.
- Keep an "all" tab.
- Show source information on each article card.
- Show category badges on each article card.
- Category badges should support multiple categories.

Suggested tab IDs:

- `all`
- `domestic`
- `world`
- `business`
- `technology`
- `politics`
- `sports`
- `entertainment`
- `science`
- `health`
- `gourmet`
- `other`

Reasoning:

- Users usually think in terms of topics, not RSS sources.
- Source filtering can be added later as a secondary filter.

## Proposed Prisma Schema Direction

This is an implementation sketch, not necessarily the exact final migration.

```prisma
model Source {
  id                String     @id
  name              String
  url               String     @unique
  enabled           Boolean    @default(true)
  language          String?
  country           String?
  defaultCategoryId String
  lastFetchedAt     DateTime?
  lastError         String?
  createdAt         DateTime   @default(now())
  updatedAt         DateTime   @updatedAt

  defaultCategory   Category   @relation(fields: [defaultCategoryId], references: [id])
  articles          NewsItem[]
}

model Category {
  id          String   @id
  label       String
  sortOrder   Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  sources     Source[]
  articles    NewsItemCategory[]
}

model NewsItem {
  id             String   @id @default(cuid())
  guid           String?
  title          String
  link           String   @unique
  pubDate        DateTime?
  creator        String?
  summary        String?
  content        String?
  contentSnippet String?
  rawCategories  String[]

  enclosureUrl    String?
  enclosureLength Int?
  enclosureType   String?

  sourceId        String
  source          Source   @relation(fields: [sourceId], references: [id])

  categories      NewsItemCategory[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model NewsItemCategory {
  newsItemId String
  categoryId String
  method     String   @default("source-default")
  confidence Float?
  createdAt  DateTime @default(now())

  newsItem   NewsItem @relation(fields: [newsItemId], references: [id], onDelete: Cascade)
  category   Category @relation(fields: [categoryId], references: [id])

  @@id([newsItemId, categoryId])
  @@index([categoryId])
}
```

Notes:

- Consider whether `Category.sources` relation needs a custom relation name if Prisma reports ambiguity.
- `Source.defaultCategoryId` is required because every source should have a default category.
- `NewsItem.sourceName` should eventually be removed because source name belongs in `Source`.
- During migration, existing `NewsItem.sourceId` values should match seeded `Source.id` values.

## Migration Requirements

Existing articles must receive categories during migration.

Decision:

- Existing articles should be assigned categories based on their current `sourceId`.
- This prevents category tabs from appearing empty after the UI change.

Mapping:

```text
google  -> other
nhk     -> domestic
bbc     -> world
itmedia -> technology
```

Migration should also preserve existing RSS categories:

- Existing `NewsItem.categories` should become `NewsItem.rawCategories`.
- If a direct rename is difficult in Prisma migration generation, manually adjust the migration SQL or perform a careful data migration.

Suggested migration behavior:

1. Create `Category`.
2. Create `Source`.
3. Seed categories.
4. Seed sources.
5. Rename `NewsItem.categories` to `rawCategories`, or add `rawCategories` and copy data.
6. Link `NewsItem.sourceId` to `Source.id`.
7. Create `NewsItemCategory`.
8. Insert one category row for every existing article based on source default category.

Pseudo SQL for assigning existing article categories:

```sql
INSERT INTO "NewsItemCategory" ("newsItemId", "categoryId", "method", "createdAt")
SELECT
  "id",
  CASE "sourceId"
    WHEN 'google' THEN 'other'
    WHEN 'nhk' THEN 'domestic'
    WHEN 'bbc' THEN 'world'
    WHEN 'itmedia' THEN 'technology'
    ELSE 'other'
  END,
  'source-default',
  NOW()
FROM "NewsItem"
ON CONFLICT DO NOTHING;
```

## Seed Data Requirements

Add or update seed logic to insert categories and sources.

Categories:

```ts
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
```

Sources:

```ts
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
```

Use `upsert` so seed can be rerun safely.

## Fetch and Save Logic

Update RSS fetching to read enabled sources from the database instead of `lib/sources.ts`.

Target behavior:

1. Load enabled sources from `Source`.
2. Fetch each RSS URL.
3. Parse RSS items.
4. Preserve RSS categories as `rawCategories`.
5. Save new articles.
6. For every new article, add a `NewsItemCategory` row using the source's `defaultCategoryId`.
7. Use `method = "source-default"`.
8. Use `confidence = null`.
9. Update `Source.lastFetchedAt` after successful fetch.
10. Update `Source.lastError` when a source fails.

Important detail:

- Existing code uses `createMany({ skipDuplicates: true })`.
- If categories must be created only for newly inserted articles, `createMany` alone does not easily return inserted IDs.

Implementation options:

### Option A: Keep Pre-Filtering Existing Links

Current `syncNews()` already queries existing links before saving.

Recommended initial approach:

1. Fetch RSS items.
2. Query existing links.
3. Filter to `newItems`.
4. Insert `newItems`.
5. Query inserted articles by link.
6. Insert category join rows using inserted articles and their source default category.

This keeps the implementation close to the current code.

### Option B: Use Per-Item Upsert

Use `upsert` per article and create category relation during create.

Pros:

- Easier relation creation per article.

Cons:

- More queries.
- Might be slower for large feeds.

Recommendation:

- Use Option A initially because the existing code already filters by link.

## Query Logic

Replace the current positional `getNewsFromDb(source, skip, take)` shape with an object parameter.

Suggested signature:

```ts
export async function getNewsFromDb(params: {
  category?: string
  source?: string
  skip?: number
  take?: number
})
```

Behavior:

- If `category` is undefined or `all`, do not filter by category.
- If `source` is undefined or `all`, do not filter by source.
- If both are present, apply both filters.
- Always order by `pubDate desc`.
- Include related `source`.
- Include related `categories.category`.

Sketch:

```ts
return prisma.newsItem.findMany({
  where: {
    ...(params.source && params.source !== 'all'
      ? { sourceId: params.source }
      : {}),
    ...(params.category && params.category !== 'all'
      ? {
          categories: {
            some: {
              categoryId: params.category,
            },
          },
        }
      : {}),
  },
  include: {
    source: true,
    categories: {
      include: {
        category: true,
      },
    },
  },
  orderBy: {
    pubDate: 'desc',
  },
  skip: params.skip,
  take: params.take,
})
```

## API Route Changes

Update `app/api/news/route.ts`.

Current behavior:

- Reads `source`.

Target behavior:

- Read `category`.
- Optionally read `source` internally for future support.
- Pass both to `getNewsFromDb`.

Example:

```ts
const category = searchParams.get('category') || 'all'
const source = searchParams.get('source') || undefined
```

The UI should call:

```text
/api/news?category=technology&page=1&limit=20
```

## Page and Tab Changes

Update `app/page.tsx`.

Current:

- Reads `searchParams.source`.
- Uses source tabs from `TABS`.

Target:

- Read `searchParams.category`.
- Use category tabs.
- Default to `all`.
- Pass `currentCategory` to `NewsList`.

Possible static tab definition:

```ts
export const CATEGORY_TABS = [
  { id: 'all', label: 'すべて' },
  { id: 'domestic', label: '国内' },
  { id: 'world', label: '国際' },
  { id: 'business', label: '経済' },
  { id: 'technology', label: 'テクノロジー' },
  { id: 'politics', label: '政治' },
  { id: 'sports', label: 'スポーツ' },
  { id: 'entertainment', label: 'エンタメ' },
  { id: 'science', label: '科学' },
  { id: 'health', label: '健康' },
  { id: 'gourmet', label: 'グルメ' },
  { id: 'other', label: 'その他' },
]
```

Alternative:

- Load categories from DB and render tabs dynamically.
- This is more flexible, but requires `app/page.tsx` to fetch categories.

Recommendation:

- Since categories are fixed seed data for now, either approach is acceptable.
- Prefer DB-backed category loading if implementation effort is modest, because it avoids duplicating category labels in code.
- If speed matters, use a shared constant and keep it aligned with seed data.

## News List UI Changes

Update `components/news-list.tsx`.

Current:

- Prop: `currentSource`.
- API key uses `source`.
- Displays source badge only.

Target:

- Prop: `currentCategory`.
- API key uses `category`.
- Still display source badge.
- Display zero or more category badges.

Suggested article data shape after including relations:

```ts
interface NewsItem {
  id: string
  title: string
  link: string
  pubDate: string | null
  source: {
    id: string
    name: string
  }
  categories: {
    categoryId: string
    method: string
    confidence: number | null
    category: {
      id: string
      label: string
    }
  }[]
}
```

Rendering idea:

- Source badge remains visually distinct.
- Category badges can be smaller and less dominant.
- Multiple category badges should wrap.

Example:

```tsx
{item.categories.map(({ category }) => (
  <span key={category.id}>
    {category.label}
  </span>
))}
```

## Backward Compatibility Notes

Because this is a database schema change, expect to update:

- Prisma schema
- Prisma migration
- Prisma client generation
- Seed data
- TypeScript types where `NewsItem` shape changes
- API response consumers

Potential temporary compatibility approach:

- Keep returning `sourceName` in API response by mapping from `item.source.name`.
- This reduces UI churn if needed.

However, the cleaner long-term shape is:

```ts
item.source.name
```

instead of:

```ts
item.sourceName
```

## Implementation Checklist

1. Update Prisma schema:
   - Add `Source`.
   - Add `Category`.
   - Add `NewsItemCategory`.
   - Rename `NewsItem.categories` to `rawCategories`.
   - Change `NewsItem.sourceId` to relation with `Source`.
   - Remove or plan removal of `NewsItem.sourceName`.

2. Create migration:
   - Preserve existing article data.
   - Seed or insert required categories before adding required source/category constraints if necessary.
   - Create category join rows for existing articles.

3. Add seed script:
   - Upsert 11 categories.
   - Upsert 4 existing sources.

4. Update source loading:
   - Replace runtime use of `SOURCES` with DB `Source.findMany({ where: { enabled: true } })`.

5. Update article saving:
   - Save `rawCategories`.
   - Assign source default category to every new article.
   - Create `NewsItemCategory` with:
     - `method = "source-default"`
     - `confidence = null`

6. Update query helper:
   - Use object parameter.
   - Support `category`.
   - Keep internal `source` support.
   - Include source and categories.

7. Update API:
   - Use `category` query parameter.
   - Keep optional `source` reading for internal support.

8. Update page:
   - Use category tabs.
   - Read `searchParams.category`.
   - Default to `all`.

9. Update news list:
   - Use `currentCategory`.
   - Fetch `/api/news?category=...`.
   - Render multiple category badges.
   - Continue showing source.

10. Verify:
    - `npm run lint`
    - TypeScript check or production build
    - Prisma migration applies locally
    - Existing articles appear under category tabs
    - New sync assigns categories

## Future Extensions

This design leaves room for the following later improvements:

### Keyword Rule Classification

Add classification rules based on title, summary, content snippet, RSS raw categories, or source.

Possible method:

```text
rule
```

Examples:

- Title contains `日銀`, `株`, `為替` -> `business`
- Title contains `選挙`, `国会`, `首相` -> `politics`
- Title contains `AI`, `半導体`, `スマホ` -> `technology`

### AI Classification

Add model-based classification later.

Possible method:

```text
ai
```

Use `confidence` for the model's confidence or calibrated score.

### Manual Classification

If an admin screen is added later, manually edited categories can use:

```text
manual
```

Manual categories may use:

```text
confidence = 1.0
```

or:

```text
confidence = null
```

Either is acceptable, but should be documented when implemented.

### Source Admin UI

Later, add an admin screen for:

- Adding sources
- Disabling sources
- Editing default category
- Viewing last fetch status
- Viewing `lastError`

This was intentionally excluded from the first implementation.

### Source Filter UI

Later, add source filtering alongside category tabs.

Potential API:

```text
/api/news?category=technology&source=itmedia
```

Potential UI:

- Category tabs as primary navigation.
- Source dropdown or segmented filter as secondary navigation.

## Important Next.js Note

This repository's `AGENTS.md` says:

> This is NOT the Next.js you know. This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

Before changing Next.js app code, check the relevant local docs under:

```text
node_modules/next/dist/docs/
```

This is especially important for:

- `app/page.tsx`
- route handlers under `app/api/.../route.ts`
- `searchParams` behavior
- caching and `fetch` behavior

## Final Agreed Scope

Implement the source/category redesign with these exact constraints:

- No admin screen.
- Sources are DB-backed and seeded.
- Categories are DB-backed and seeded.
- `Source.id` is a fixed string.
- `Category.id` is a fixed string.
- Articles support multiple app-level categories.
- RSS categories are preserved as `rawCategories`.
- Initial classification is source default only.
- Existing articles must receive categories during migration.
- `NewsItemCategory.method` exists and starts as `source-default`.
- `NewsItemCategory.confidence` exists and is nullable.
- API uses `category` as the main query parameter.
- Internal query function keeps optional `source` support.
- UI changes from source tabs to category tabs.
- Sorting remains `pubDate desc`.
