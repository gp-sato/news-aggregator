import fs from 'fs';
import path from 'path';

// Next.js 外 (npx tsx) 実行時に .env を読み込み
if (!process.env.DATABASE_URL) {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    for (const line of envConfig.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*"?([^"#\r\n]*)"?/);
      if (match) {
        process.env[match[1]] = match[2].trim();
      }
    }
  }
}

const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;

async function runCrashTests() {
  // 環境変数設定後に prisma を動的読み込み
  const { prisma } = await import('../lib/prisma');

  console.log('========================================');
  console.log('  PROCESSING クラッシュ復旧テスト開始   ');
  console.log('========================================\n');

  // 1. テストに必要な Source の準備
  let source = await prisma.source.findFirst();
  let createdTempSource = false;

  if (!source) {
    let category = await prisma.category.findFirst();
    if (!category) {
      category = await prisma.category.create({
        data: { id: 'test-cat', label: 'Test Category' },
      });
    }
    source = await prisma.source.create({
      data: {
        id: 'test-source',
        name: 'Test Source',
        url: 'https://example.com/rss.xml',
        defaultCategoryId: category.id,
      },
    });
    createdTempSource = true;
  }

  // 2. テスト用 NewsItem の作成
  const uniqueLink = `https://example.com/test-crash-${Date.now()}`;
  const testItem = await prisma.newsItem.create({
    data: {
      title: 'Crash Recovery Test Item',
      link: uniqueLink,
      sourceId: source.id,
      imageFetchStatus: 'QUEUED',
    },
  });

  console.log(`[Setup] テスト用 NewsItem 作成完了 (ID: ${testItem.id})\n`);

  let totalTests = 0;
  let passedTests = 0;

  try {
    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - (PROCESSING_TIMEOUT_MS + 1000)); // 5分1秒前 (タイムアウト)
    const oneMinAgo = new Date(now.getTime() - 1 * 60 * 1000); // 1分前 (アクティブ)

    // -------------------------------------------------------------
    // Case 1: 同一 messageId による Queue 再配信 (ロック再取得できるべき)
    // -------------------------------------------------------------
    totalTests++;
    console.log('▶ Case 1: クラッシュ後の同一 messageId 再配信テスト');
    await prisma.newsItem.update({
      where: { id: testItem.id },
      data: {
        imageFetchStatus: 'PROCESSING',
        imageFetchMessageId: 'msg-retry-1',
        imageFetchStartedAt: oneMinAgo,
      },
    });

    const case1Result = await prisma.newsItem.updateMany({
      where: {
        id: testItem.id,
        OR: [
          { imageFetchStatus: 'QUEUED' },
          { imageFetchStatus: 'PROCESSING', imageFetchMessageId: 'msg-retry-1' },
          { imageFetchStatus: 'PROCESSING', imageFetchStartedAt: { lt: new Date(Date.now() - PROCESSING_TIMEOUT_MS) } },
        ],
      },
      data: {
        imageFetchStatus: 'PROCESSING',
        imageFetchStartedAt: new Date(),
        imageFetchMessageId: 'msg-retry-1',
      },
    });

    if (case1Result.count === 1) {
      console.log('  ✅ SUCCESS: 同一 messageId でロックを正常に再取得しました。\n');
      passedTests++;
    } else {
      console.error(`  ❌ FAILED: ロック取得失敗 (更新件数: ${case1Result.count})\n`);
    }

    // -------------------------------------------------------------
    // Case 2: タイムアウト(5分経過)した放置ロックの復旧 (新メッセージがロック奪取できるべき)
    // -------------------------------------------------------------
    totalTests++;
    console.log('▶ Case 2: 放置された古い PROCESSING レコードのタイムアウト復旧テスト');
    await prisma.newsItem.update({
      where: { id: testItem.id },
      data: {
        imageFetchStatus: 'PROCESSING',
        imageFetchMessageId: 'dead-worker-msg-999',
        imageFetchStartedAt: fiveMinAgo,
      },
    });

    const case2Result = await prisma.newsItem.updateMany({
      where: {
        id: testItem.id,
        OR: [
          { imageFetchStatus: 'QUEUED' },
          { imageFetchStatus: 'PROCESSING', imageFetchMessageId: 'new-worker-msg-100' },
          { imageFetchStatus: 'PROCESSING', imageFetchStartedAt: { lt: new Date(Date.now() - PROCESSING_TIMEOUT_MS) } },
        ],
      },
      data: {
        imageFetchStatus: 'PROCESSING',
        imageFetchStartedAt: new Date(),
        imageFetchMessageId: 'new-worker-msg-100',
      },
    });

    if (case2Result.count === 1) {
      console.log('  ✅ SUCCESS: 放置されたロックを破棄し、新しいワーカーがロックを取得しました。\n');
      passedTests++;
    } else {
      console.error(`  ❌ FAILED: 放置ロックの奪取失敗 (更新件数: ${case2Result.count})\n`);
    }

    // -------------------------------------------------------------
    // Case 3: アクティブな他ワーカーからの割り込み防止 (ロック拒否 0件更新になるべき)
    // -------------------------------------------------------------
    totalTests++;
    console.log('▶ Case 3: アクティブ処理中 (1分経過) のレコードへの別ワーカー割り込み防止テスト');
    await prisma.newsItem.update({
      where: { id: testItem.id },
      data: {
        imageFetchStatus: 'PROCESSING',
        imageFetchMessageId: 'active-worker-msg-1',
        imageFetchStartedAt: oneMinAgo,
      },
    });

    const case3Result = await prisma.newsItem.updateMany({
      where: {
        id: testItem.id,
        OR: [
          { imageFetchStatus: 'QUEUED' },
          { imageFetchStatus: 'PROCESSING', imageFetchMessageId: 'other-worker-msg-2' },
          { imageFetchStatus: 'PROCESSING', imageFetchStartedAt: { lt: new Date(Date.now() - PROCESSING_TIMEOUT_MS) } },
        ],
      },
      data: {
        imageFetchStatus: 'PROCESSING',
        imageFetchStartedAt: new Date(),
        imageFetchMessageId: 'other-worker-msg-2',
      },
    });

    if (case3Result.count === 0) {
      console.log('  ✅ SUCCESS: 他ワーカーの処理を邪魔せず、安全に割り込みが防止されました (0件更新)。\n');
      passedTests++;
    } else {
      console.error(`  ❌ FAILED: 割り込み防止失敗 (更新件数: ${case3Result.count})\n`);
    }

  } catch (err) {
    console.error('テスト実行中にエラーが発生しました:', err);
  } finally {
    // 3. テストデータのクリーンアップ
    console.log('[Cleanup] テストデータを削除しています...');
    await prisma.newsItem.delete({ where: { id: testItem.id } });
    if (createdTempSource && source) {
      await prisma.source.delete({ where: { id: source.id } });
    }
    console.log('[Cleanup] 削除完了。\n');
  }

  console.log('========================================');
  console.log(`  結果: ${passedTests} / ${totalTests} テスト通過`);
  console.log('========================================');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runCrashTests();
