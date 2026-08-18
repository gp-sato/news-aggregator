# 実装計画: `test-processing-crash.ts` の Vitest 移行および安全ガード構築

## 1. 概要と目的

### 背景
現在、`scripts/test-processing-crash.ts` は `npx tsx` を使用して独立したスクリプトとして実行されており、`.env` に記載された `DATABASE_URL` に直接依存してデータベースの作成・更新・削除処理を行っています。
もし `.env` の接続先が Supabase のクラウドデータベース（または共有の本番・ステージング DB）を指していた場合、このテストを実行することで本番データを直接誤って書き換えたり破壊したりする重大なリスクが存在します。

### 目的
1. **安全性第一**: テスト実行時に本番環境への誤接続を防ぐ厳格な環境判定ガードを組み込みます。
2. **標準化**: `test-processing-crash.ts` を標準的な自動テストスイート (`npm run test`) へと移行します。
3. **ロジックの分離**: スクリプト内に直書きされているアトミックなロック取得ロジックを、再利用可能なドメインサービス関数（`claimImageFetchLock` など）として独立させます。
4. **信頼性向上**: 実際の本番 DB と通信することなく完全安全かつ高速に検証できるユニットテスト（Vitest + モック）を提供します。

---

## 2. アーキテクチャと設計方針

### 2.1 ロックロジックのリファクタリング
現在、アトミックなロック制御ロジックはテストスクリプト内に `prisma.newsItem.updateMany` を用いて直接記述されています。これを独立した純粋なサービス関数へ抽出します。

**作成先**: `lib/services/image-fetch-lock.ts`

```typescript
export interface ClaimLockInput {
  itemId: string;
  messageId: string;
  timeoutMs?: number;
  now?: Date;
}

/**
 * NewsItem の画像取得処理（PROCESSING）のロックをアトミックに取得・更新します。
 * 競合状態を防ぎ、クラッシュしたワーカーや放置されたロックから正常に復旧します。
 */
export async function claimImageFetchLock(
  input: ClaimLockInput,
  db = defaultPrisma
): Promise<{ acquired: boolean; count: number }>
```

### 2.2 セーフティガード（本番 DB 保護機能）
テスト実行中に本番 Supabase DB へ誤接続することを**絶対に防止**するための仕組みを導入します：

1. **テスト環境変数**: Vitest は自動的に `NODE_ENV=test` または `.env.test` を読み込みます。
2. **安全検証フック (`vitest.setup.ts`)**:
   - `DATABASE_URL` を検証します。
   - ホスト名にクラウド環境（例: `*.supabase.co`, `*.aws.neon.tech` 等）が含まれている場合、テスト実行を即座にエラー停止（アボート）させます。
3. **モック優先のユニットテスト**: メインのテストは `vitest-mock-extended` または Vitest の `vi.mock()` を使用して Prisma をモック化し、ネットワーク通信自体を発生させません。

---

## 3. Devin 向け段階的実装ガイド

### Step 1: 必要なパッケージのインストール
開発用依存関係として `vitest` および `vitest-mock-extended` をインストールします。

```bash
npm install -D vitest vitest-mock-extended
```

### Step 2: Vitest 設定および安全ガードの作成

#### ファイル: `vitest.config.ts`
プロジェクトルートに `vitest.config.ts` を作成します。

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
```

#### ファイル: `vitest.setup.ts`
本番 DB 保護ガードを含む `vitest.setup.ts` を作成します。

```typescript
import { beforeAll } from 'vitest';

beforeAll(() => {
  // テスト環境変数を強制
  process.env.NODE_ENV = 'test';

  const dbUrl = process.env.DATABASE_URL || '';

  // 危険なクラウド DB のパターンを検証
  const isCloudDb = dbUrl.includes('.supabase.co') || 
                    dbUrl.includes('pooler.supabase.com') ||
                    dbUrl.includes('.neon.tech') ||
                    dbUrl.includes('.rds.amazonaws.com');

  if (isCloudDb) {
    console.error('\n❌ SAFETY GUARD TRIGGERED: DATABASE_URL がクラウド/本番データベースを指しています！');
    console.error(`URL: ${dbUrl.replace(/:[^:@]+@/, ':****@')}`);
    console.error('ユニットテストはモックまたはローカルDBでのみ実行可能です。テストを中断します。\n');
    throw new Error('セーフティガードによる中断: 本番/クラウドDBに対してテストを実行できません。');
  }
});
```

### Step 3: ドメインサービスロジックの切り出し
`lib/services/image-fetch-lock.ts` を作成します。

```typescript
import { prisma as defaultPrisma } from '../prisma';

export const DEFAULT_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000; // 5分

export interface ClaimLockInput {
  itemId: string;
  messageId: string;
  timeoutMs?: number;
  now?: Date;
}

/**
 * NewsItem の PROCESSING ロックを取得または再取得（復旧）します。
 * 
 * 以下の条件を満たす場合にロック取得に成功します：
 * 1. ステータスが QUEUED の場合
 * 2. ステータスが PROCESSING で、同じ messageId の場合 (同一ワーカーのリトライ)
 * 3. ステータスが PROCESSING で、ロックがタイムアウト時間を超えている場合 (クラッシュ復旧)
 */
export async function claimImageFetchLock(
  input: ClaimLockInput,
  db = defaultPrisma
): Promise<{ acquired: boolean; count: number }> {
  const { itemId, messageId, timeoutMs = DEFAULT_PROCESSING_TIMEOUT_MS, now = new Date() } = input;
  const timeoutThreshold = new Date(now.getTime() - timeoutMs);

  const result = await db.newsItem.updateMany({
    where: {
      id: itemId,
      OR: [
        { imageFetchStatus: 'QUEUED' },
        { imageFetchStatus: 'PROCESSING', imageFetchMessageId: messageId },
        { imageFetchStatus: 'PROCESSING', imageFetchStartedAt: { lt: timeoutThreshold } },
      ],
    },
    data: {
      imageFetchStatus: 'PROCESSING',
      imageFetchStartedAt: now,
      imageFetchMessageId: messageId,
    },
  });

  return {
    acquired: result.count === 1,
    count: result.count,
  };
}
```

### Step 4: Vitest ユニットテストの作成
`lib/services/__tests__/image-fetch-lock.test.ts` を作成します。

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { claimImageFetchLock, DEFAULT_PROCESSING_TIMEOUT_MS } from '../image-fetch-lock';

// PrismaClient のディープモックを作成
const prismaMock = mockDeep<PrismaClient>();

describe('claimImageFetchLock', () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it('Case 1: 同一 messageId の場合はロックを正常に再取得できること (リトライ処理)', async () => {
    prismaMock.newsItem.updateMany.mockResolvedValue({ count: 1 });

    const now = new Date();
    const result = await claimImageFetchLock(
      {
        itemId: 'item-1',
        messageId: 'msg-retry-1',
        now,
      },
      prismaMock as unknown as typeof import('../../prisma').prisma
    );

    expect(result.acquired).toBe(true);
    expect(result.count).toBe(1);
    expect(prismaMock.newsItem.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'item-1',
        OR: [
          { imageFetchStatus: 'QUEUED' },
          { imageFetchStatus: 'PROCESSING', imageFetchMessageId: 'msg-retry-1' },
          { imageFetchStatus: 'PROCESSING', imageFetchStartedAt: { lt: expect.any(Date) } },
        ],
      },
      data: {
        imageFetchStatus: 'PROCESSING',
        imageFetchStartedAt: now,
        imageFetchMessageId: 'msg-retry-1',
      },
    });
  });

  it('Case 2: 放置・タイムアウトされた古いロックから新ワーカーがロックを奪取復旧できること', async () => {
    prismaMock.newsItem.updateMany.mockResolvedValue({ count: 1 });

    const now = new Date();
    const result = await claimImageFetchLock(
      {
        itemId: 'item-1',
        messageId: 'new-worker-msg-100',
        now,
      },
      prismaMock as unknown as typeof import('../../prisma').prisma
    );

    expect(result.acquired).toBe(true);
    expect(prismaMock.newsItem.updateMany).toHaveBeenCalledOnce();
  });

  it('Case 3: アクティブに処理中の他ワーカーの処理への割り込みを拒否すること', async () => {
    // 条件に合致せず更新件数 0 件が返されるケース
    prismaMock.newsItem.updateMany.mockResolvedValue({ count: 0 });

    const now = new Date();
    const result = await claimImageFetchLock(
      {
        itemId: 'item-1',
        messageId: 'other-worker-msg-2',
        now,
      },
      prismaMock as unknown as typeof import('../../prisma').prisma
    );

    expect(result.acquired).toBe(false);
    expect(result.count).toBe(0);
  });
});
```

### Step 5: `package.json` の更新と旧スクリプトの削除

1. `package.json` にテストスクリプトを追加します：
```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

2. 旧スクリプト `scripts/test-processing-crash.ts` を削除します。

---

## 4. 検証および受入基準

Devin が実装を完了した際、以下の方法で動作検証を行います：

1. **ユニットテストの実行**:
   ```bash
   npm run test
   ```
   実際の DB に一切接続することなく、すべてのケース（Case 1, Case 2, Case 3）が通過すること。

2. **セーフティガードの検証**:
   クラウド DB の URL を擬似的に渡して実行します：
   ```bash
   DATABASE_URL="postgresql://postgres:pass@db.xxxx.supabase.co:5432/postgres" npx vitest run
   ```
   期待される結果: セーフティガードのエラーメッセージが表示され、テスト実行が即座にアボート（中断）すること。

---

## 5. Devin 向けチェックリスト
- [ ] `vitest` および `vitest-mock-extended` をインストールしたか。
- [ ] クラウド DB セーフティガードを含む `vitest.config.ts` および `vitest.setup.ts` を作成したか。
- [ ] `claimImageFetchLock()` を含む `lib/services/image-fetch-lock.ts` を作成したか。
- [ ] 3 つのクラッシュ復旧ケースを網羅する `lib/services/__tests__/image-fetch-lock.test.ts` を作成したか。
- [ ] `package.json` のスクリプト（`"test": "vitest run"`）を更新したか。
- [ ] 旧ファイル `scripts/test-processing-crash.ts` を削除したか。
- [ ] `npm run test` を実行し、正常にクリアできることを確認したか。
