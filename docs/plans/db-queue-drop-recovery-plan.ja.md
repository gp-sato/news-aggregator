# 実装計画書: DB保存とQueue投入の間における処理取りこぼし対策

## 1. 概要と背景

### 1.1 問題の要約
RSSニュース収集処理（`syncNews` / `saveNewsToDb`）において、データベース（PostgreSQL）への記事データ保存と、非同期画像取得を行う Vercel Queues へのメッセージ投入が分離しており、単一のトランザクションとして扱われていません。

これにより、以下のような障害発生時に記事が `imageFetchStatus = 'QUEUED'` のままデータベースに孤立し、永久に画像フェッチが行われない「処理の取りこぼし」が発生しています。

1. **DB保存直後のプロセス停止**
2. **カテゴリリレーション保存時のエラーによる中断**
3. **Queue送信 (`send()`) 時のネットワークエラー・レート制限 (429) ・認証エラー (401)**
4. **Queue送信成功後の応答受信前切断**

さらに、現在の `enqueueImageFetch()` は `send()` の例外を `try-catch` でログ出力するのみで握りつぶしているため、呼出元 (`saveNewsToDb`) は処理成功と判定します。次回以降の Cron 実行時には、対象記事が既に DB に存在するため既存リンクとして除外され、二度と Queue に再投入されません。

---

## 2. 現状のコード構成と詳細分析

現在の関連コードの挙動をコードベースに基づき確認しました。

### 2.1 `lib/news.ts` (`saveNewsToDb`)
- `prisma.newsItem.createMany` で新規記事を一括作成。
- その後 `prisma.newsItemCategory.createMany` でカテゴリ関連付けを作成。
- 最後に `savedArticles` から `imageFetchStatus === 'QUEUED'` の記事をフィルタリングし、`enqueueImageFetch` を非同期呼び出し。
- **課題**:
  - 各 DB 操作および Queue 呼び出しが分割されており、トランザクション境界が存在しない。
  - `enqueueImageFetch` が例外を発生させないため、Queue 投入失敗を検出・ログ記録・リトライできない。

### 2.2 `lib/queue.ts` (`enqueueImageFetch`)
```typescript
try {
  await send('image-fetch', { newsItemId: item.id, link: item.link }, { delaySeconds });
  console.log(`Enqueued image fetch for newsItemId ${item.id}...`);
} catch (error) {
  console.error(`Failed to enqueue image fetch for newsItemId ${item.id}:`, error);
}
```
- **課題**:
  - `send()` の例外がログ出力のみでキャッチされ、呼び出し側に失敗が伝播しない。
  - 送信成否のカウントや判定結果が返却されない。

### 2.3 `lib/news.ts` (`syncNews`)
- DB 内の既存 `link` を検索し、未保存のアイテムのみを `saveNewsToDb()` に渡す。
- **課題**:
  - 一度 DB 保存された `QUEUED` 状態の記事は、Queue 送信に失敗していても次回同期時にスキップされる。

---

## 3. 対策案の比較・設計評価

「処理の取りこぼし」を完全に防ぎ、システムの堅牢性とシンプルさを両立させるためのアプローチを比較評価しました。

| 評価軸 | 案A: Transactional Outbox テーブル導入 | 案B: DBトランザクション + Queue送信エラーハンドリング + 自動回収 Sweeper (推奨) |
| :--- | :--- | :--- |
| **概要** | `ImageFetchOutbox` テーブルを新設し、DB保存時に同一トランザクションで Outbox レコードを作成。別ポーラーで Queue へ送信。 | `NewsItem` 保存を Prisma トランザクション化。Queue 投入失敗時のエラー伝播と、定期 Sync / Cron で一定時間放置された `QUEUED` 記事を救出するリカバリ機構を追加。 |
| **スキーマ変更** | **必要** (新テーブル追加とマイグレーション) | **不要** (既存の `NewsItem` と `imageFetchStatus`, `updatedAt` を活用) |
| **構成の複雑さ** | ポーリング Worker や Cron など新しいコンポーネントが必要 | 既存の RSS 同期 (`syncNews`) または単一ルーチンにリカバリ処理を統合可能 |
| **冪等性・安全性** | 高い | 非常に高い (既存の `claimImageFetchLock` によるアトミックロックが重複処理を防止) |
| **保守性・運用** | テーブル管理やポーラー監視が必要 | 既存アーキテクチャを尊重し、シンプルかつ保守しやすい |

### 採用案: 案B (DBトランザクション + 失敗伝播 + 滞留 QUEUED 自動回収 Sweeper)
プロジェクトの規模および既存のロック機構 (`claimImageFetchLock`) との適合性から、**案B** を採用します。

---

## 4. 対策の具体的な仕様と設計

### 4.1 各コンポーネントの仕様変更

1. **`lib/queue.ts` (`enqueueImageFetch`) の改修**:
   - `send()` の結果を追跡し、送信成功件数と失敗件数、失敗した記事 ID 一覧を返却する。
   - 送信失敗時は詳細な成否結果オブジェクトを返却。

2. **`lib/news.ts` (`saveNewsToDb`) の改修**:
   - `prisma.$transaction` を使用し、`NewsItem.createMany` と `NewsItemCategory.createMany` を同一 DB トランザクション内で実行。
   - DB 保存完了後、`enqueueImageFetch` を呼び出して失敗があった場合はログと統計に反映。

3. **`lib/news.ts` に孤立記事回収関数 (`recoverOrphanedQueuedItems`) の追加**:
   - 条件: `imageFetchStatus === 'QUEUED'` かつ `updatedAt` が現在時刻より `X` 分以上前（デフォルト: 5分）。
   - 抽出した記事に対して `enqueueImageFetch` を実行し、Queue へ再投入。
   - `syncNews()` の実行時に `recoverOrphanedQueuedItems()` を自動呼出。

4. **冪等性 (Idempotency) の保証**:
   - `claimImageFetchLock` が `imageFetchStatus = 'QUEUED'` またはタイムアウトした `PROCESSING` のみを取得するため、重複して Queue にメッセージが入っても安全に 1 回のみ実行される。

---

## 5. ステップ別実装手順

### Step 1: `lib/queue.ts` のリファクタリング
- `enqueueImageFetch` のシグネチャと戻り値を更新。
- 各メッセージの `send` 成否を返却する構造に変更。

### Step 2: `lib/news.ts` の DB トランザクション化とリカバリ機能の実装
- `saveNewsToDb` を `prisma.$transaction` を使用した処理に変更。
- `recoverOrphanedQueuedItems` 関数を追加。
- `syncNews` 内で孤立記事の救出処理を呼び出す。

### Step 3: テストコードの追加と更新
- `lib/services/__tests__/` または `lib/__tests__/` に、トランザクション処理および孤立記事リカバリ処理のテストを追加。
- 既存テストへの影響がないことを確認。

### Step 4: ドキュメントの更新
- `CONTEXT.md` や `docs/adr/0002-vercel-queues-image-fetching.md` に取りこぼし対策 (Sweeper ロジック) の仕様を追記。

---

## 6. 検証計画

1. **自動テストの実行**:
   - Vitest による既存・新規テストの全件通過確認 (`npm test`)
2. **型チェック・静的解析**:
   - `npx tsc --noEmit` による型整合性確認
   - `npm run lint` によるコードスタイル確認
