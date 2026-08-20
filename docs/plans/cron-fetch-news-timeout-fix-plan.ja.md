# 実装計画書: Vercel Cron (`/api/cron/fetch-news`) タイムアウト・5XXエラー恒久対策

## 1. 概要と背景

### 1.1 問題の事象
本番環境の Vercel Cron Job (`/api/cron/fetch-news`) において、実行ステータスが **5XX (エラー率 100%)** となり、失敗が記録される事象が発生しました。

### 1.2 Observability（監視ログ）の分析結果
- **Active CPU / 実行時間**: `2m` (120秒)
  - Vercel Fluid Compute / Serverless Function のプラットフォーム強制終了上限（120秒）に達している。
- **Memory Usage**: `2.05 GB / 2.05 GB`
  - タイムアウトによるプロセス強制終了（`FUNCTION_INVOCATION_TIMEOUT`）に伴い、割り当てメモリ上限が記録されている。
- **外部 API 呼び出しの記録**:
  - `hnd1.vercel-queue.com`: 74回
  - 各種 RSS ソース（Google, NHK, ライブドア, はてな, 厚労省, AstroArts, グルメプレス等）: 計32回
- **後続処理（`/api/queue/fetch-image`）の状況**:
  - 呼び出し回数: 59回
  - Active CPU: 平均 2.6秒
  - エラー率: **0%（正常稼働）**

### 1.3 診断の結論
RSSの取得、DB保存、Vercel Queues への投入処理自体は実行され、Queue Consumer 側も正常に画像取得を処理できています。  
しかし、**Cron の Route Handler がレスポンスを返却する前に外部通信の遅延等で 120 秒の制限時間を超過し、Vercel プラットフォームにより 504 / 500 で強制終了された** ことが直接の原因です。

---

## 2. 根本原因の詳細分析

### 2.1 RSS 取得処理におけるタイムアウトの欠如 (`lib/news.ts`)
- `fetchRssFeeds()` 内の `fetch(source.url, fetchOptions)` に **タイムアウト（`AbortSignal.timeout` や `AbortController`）が設定されていません**。
- 登録されている 32 件の外部 RSS フィードのうち、1 件でもレスポンスが遅延（ハング）または TCP 接続が保留されると、Node.js の `fetch` は長時間待機し続け、`Promise.allSettled` 全体がブロックされます。

### 2.2 Route Segment Config の `maxDuration` 未定義 (`app/api/cron/fetch-news/route.ts`)
- Next.js Route Handler に `export const maxDuration = 60` などの設定が明示されておらず、プラットフォームの予期せぬタイムアウト挙動を招きやすい状態です。

### 2.3 孤立記事回収 (`recoverOrphanedQueuedItems`) の取得件数無制限 (`lib/news.ts`)
- `recoverOrphanedQueuedItems` 内の `prisma.newsItem.findMany` に `take`（取得件数上限）が設定されていません。
- 過去の滞留データが大量に存在する場合、全件を一括取得して並列に Queue 送信しようとするため、通信数と処理時間を圧迫します。

### 2.4 DB 更新・Queue 送信の過剰な並列実行
- `fetchRssFeeds` 内で 32 ソースに対して個別の `prisma.source.update` を並列実行しており、DB 接続プールへの負荷が高くなっています。
- `enqueueImageFetch` においても、74 件以上の `send()` を `Promise.allSettled` で制限なく一斉送信しています。

---

## 3. 改修設計と対策方針

| 項目 | 対策内容 | 期待効果 |
| :--- | :--- | :--- |
| **RSS Fetch タイムアウト** | `fetch(source.url, { signal: AbortSignal.timeout(8000) })` を導入 | 遅延・停止している外部フィードを最大 8 秒で確実に切り離し、Cron 全体の待機を防止 |
| **maxDuration の明示** | `app/api/cron/fetch-news/route.ts` に `export const maxDuration = 60;` を追加 | Vercel Serverless Function の実行許容時間を確実に 60 秒に設定 |
| **リカバリ件数の制限** | `recoverOrphanedQueuedItems` に `take: 50` の上限を追加 | 1 回の Cron 実行におけるリカバリ処理負荷を一定範囲に抑制 |
| **Queue 送信のバッチ化** | `enqueueImageFetch` の並列送信をチャンク（例: 10件ずつ）に分割 | ネットワーク輻輳とレート制限の回避 |
| **DB 更新の最適化** | ソース更新のエラーハンドリング強化と負荷軽減 | データベース接続プール枯渇の防止 |

---

## 4. 各モジュールの具体的な改修仕様

### 4.1 `lib/news.ts`

#### (1) `fetchRssFeeds` へのタイムアウト追加
```typescript
// 改修前
const res = await fetch(source.url, fetchOptions)

// 改修後
const res = await fetch(source.url, {
  ...fetchOptions,
  signal: AbortSignal.timeout(8000), // 8秒でタイムアウト
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
})
```

#### (2) `recoverOrphanedQueuedItems` への上限追加
```typescript
// 改修後
const orphanedItems = await prisma.newsItem.findMany({
  where: {
    imageFetchStatus: 'QUEUED',
    updatedAt: {
      lt: thresholdDate,
    },
  },
  select: {
    id: true,
    link: true,
    updatedAt: true,
  },
  take: 50, // 1回あたりの最大回収件数を50件に制限
  orderBy: {
    updatedAt: 'asc', // 古いものから優先回収
  },
})
```

### 4.2 `app/api/cron/fetch-news/route.ts`

```typescript
import { NextRequest } from 'next/server'
import { syncNews } from '@/lib/news'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Vercel Functionの最大実行時間を60秒に設定

export async function GET(request: NextRequest) {
  // ... 既存の認証と処理
}
```

### 4.3 `lib/queue.ts`

#### `enqueueImageFetch` のチャンク分割並列送信
大量の記事をキューへ投入する際、全件同時送信ではなく 10 件ずつのバッチ並列で送信し、コネクションの過負荷を防ぎます。

```typescript
// チャンク分割ユーティリティを利用した送信制御
const CHUNK_SIZE = 10;
for (let i = 0; i < newsItems.length; i += CHUNK_SIZE) {
  const chunk = newsItems.slice(i, i + CHUNK_SIZE);
  await Promise.allSettled(chunk.map((item, idx) => {
    const globalIndex = i + idx;
    // ... send 処理
  }));
}
```

---

## 5. ステップ別実装手順

### Step 1: `lib/news.ts` のタイムアウト・上限追加
1. `fetchRssFeeds` に `AbortSignal.timeout(8000)` および `User-Agent` ヘッダーを追加。
2. タイムアウト発生時に `TimeoutError` / `AbortError` をキャッチし、該当ソースの `lastError` に記録して安全にスキップする処理を確認。
3. `recoverOrphanedQueuedItems` に `take: 50` と `orderBy: { updatedAt: 'asc' }` を追加。

### Step 2: `app/api/cron/fetch-news/route.ts` の Route Segment Config 更新
1. `export const maxDuration = 60;` を追加。

### Step 3: `lib/queue.ts` の送信バッチ制御
1. `enqueueImageFetch` の送信処理をチャンク分割並列化。

### Step 4: 単体テスト・結合テストの作成と実行
1. `lib/__tests__/news.test.ts` に、遅延する RSS ソースに対するタイムアウト動作のテストケースを追加。
2. `recoverOrphanedQueuedItems` の `take` 上限動作のテストを追加。
3. `npm test` を実行して全件通過を確認。

---

## 6. 検証計画

1. **自動テストの実行**:
   ```bash
   npm test
   ```
2. **型チェック・静的解析**:
   ```bash
   npx tsc --noEmit
   npm run lint
   ```
3. **ビルド検証**:
   ```bash
   npm run build
   ```
4. **本番環境での Observability 監視**:
   - デプロイ後の Cron 実行時、Active CPU が 2分から数秒〜15秒前後に短縮されることを確認。
   - Error Rate が 0% (200 OK) に改善することを確認。
