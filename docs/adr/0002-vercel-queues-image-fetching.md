# ADR-0002: Vercel Queues Image Fetching

## Status

Accepted

## Context

画像取得のCronベースバッチ処理は、同時実行制限や大量の外部リクエストによるアクセス先への負荷集中が懸念されていました。
これらを解決し、より安定した画像取得を行うため、画像取得を Vercel Queues を用いた非同期のメッセージベースキュー処理へ移行します。

## Decision

1. **Vercel Queues への移行**
   - 画像取得用の Cron ジョブ（`fetch-images`）は廃止。
   - RSS取得 Cron（`fetch-news`）は新規追加された記事を DB に保存後、画像がない記事を Vercel Queues へ送信する。
   - Queue Worker（Consumer）は Route Handler（`app/api/queue/fetch-image/route.ts`）として実装する。

2. **Enum の変更**
   - `ImageFetchStatus` の `PENDING` を廃止し、`QUEUED` を追加。デフォルト値は `QUEUED` とする。

3. **Google News の特殊対応**
   - Google News 記事は HTML 取得を行わず、プロジェクト固有のプレースホルダー画像（`/images/placeholder.png`）を `imageUrl` に設定し、`imageFetchStatus = SUCCESS` として即時完了させる。

4. **レート制限と遅延 (Queue Delay)**
   - アクセス先負荷軽減のため、Queue 投入時に `delaySeconds = index * 2` のディレイを設定。
   - 将来的にドメインごとのレート制御やランダムジッターに拡張しやすいようにディレイ計算ロジックを分離。

5. **robots.txt キャッシュ**
   - HTML 取得前に、記事のオリジンから `robots.txt` を取得して判定する。
   - `robots.txt` はオリジン単位でインメモリキャッシュ（TTL: 24時間）し、毎回リクエストが走るのを防ぐ。
   - `robots.txt` の取得失敗時や 404 時は Fail Open とする。
   - クロール拒否の場合は `imageFetchStatus = FAILED` とし、HTML 取得は行わない。

6. **共通処理とクラッシュ復旧**
   - Queue Worker とローカルのデバッグルートは、共通の `processImageFetchJob()` を呼び出す。
   - `claimImageFetchLock()` は `QUEUED`、同一 `messageId` の再配信、またはタイムアウトした `PROCESSING` を条件付き更新で原子的に取得する。
   - 一時障害は `PROCESSING` を維持して例外を Queue へ戻し、再配信で処理を再開する。恒久障害は `FAILED` で完了する。
   - Vercel 固有の Queue アダプターは薄く保ち、共通処理は Vitest で Vercel に依存せず検証する。

## Consequences

メリット:
- リクエストが平準化され、相手先サーバーへのスパイク負荷がなくなる。
- バックグラウンド実行による信頼性の向上。
- robots.txt キャッシュによる余計なリクエストの削減。
- Queue とデバッグで同一の画像取得ロジックを使うため、ローカル検証と本番挙動の差分が小さくなる。

デメリット:
- ローカル環境で Queue の検証を行うために Vercel CLI (vercel dev) の動作確認が必要。
