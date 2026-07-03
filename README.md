# 📰 NexusFeed

Next.js をベースに、PostgreSQL (Supabase) + Prisma を使用して RSS フィードからニュースを定期的に取得・集約するアプリケーション「NexusFeed」です。

## 🛠 テクノロジー・スタック

- **フロントエンド / バックエンド**: [Next.js](https://nextjs.org/) (TypeScript, App Router)
- **データベース**: [PostgreSQL (Supabase)](https://supabase.com/)
- **ORM**: [Prisma v7](https://www.prisma.io/)
- **スタイリング**: [Tailwind CSS v4](https://tailwindcss.com/)
- **デプロイ / 自動実行**: [Vercel](https://vercel.com/) (Hosting & Vercel Cron)

---

## ⚙️ セットアップ手順

### 1. Supabase のデータベース作成
1. [Supabase](https://supabase.com/) にサインインし、新しいプロジェクトを作成します。
2. プロジェクト作成時に設定した **Database Password** を安全な場所に控えておきます。

### 2. 環境変数の設定
1. プロジェクトルートにある環境変数のテンプレートファイルをコピーします。
   ```bash
   cp .env.example .env
   ```
2. `.env` ファイルを開き、環境変数を設定します。
   * **接続情報の取得**: Supabase 管理画面の **Connect** タブ（あるいは Project Settings > Database）から **ORM** > **Prisma** を選択します。
   * 表示される `DATABASE_URL` と `DIRECT_URL` の接続文字列をそれぞれ `.env` に貼り付けます。
   * その際、`[YOUR-PASSWORD]` となっている箇所を、手順1で控えた自身のデータベースパスワードに置き換えてください。
   * **Vercel Cron を使用する場合**: `NODE_ENV="production"` および `CRON_SECRET`（任意のランダムなセキュリティキー）を設定します。

### 3. パッケージのインストールとデータベース反映
プロジェクトのセットアップに必要なライブラリをインストールし、データベースにスキーマを反映させます。

```bash
# ライブラリのインストール
npm install

# データベーススキーマの作成（Supabaseにテーブルを同期）
npx prisma migrate dev

# Prisma Clientの生成
npx prisma generate
```

### 4. 開発サーバーの起動
```bash
npm run dev
```
起動後、ブラウザで [http://localhost:3000](http://localhost:3000) にアクセスします。

---

## 💻 ローカル開発環境のセットアップ (Supabase Local + Prisma)

ローカル環境では、Docker と Supabase CLI を用いて PostgreSQL データベースを立ち上げ、Prisma でスキーマ・マイグレーション・シードの管理を行います。

### ディレクトリ構成
```text
news-aggregator/
├── app/
├── components/
├── prisma/
│   ├── migrations/
│   ├── schema.prisma
│   └── seed.ts
├── supabase/
│   └── config.toml
├── package.json
├── prisma.config.ts
└── ...
```

この構成では、**Prisma を唯一の真実（Single Source of Truth）**としてデータベーススキーマを一元管理し、**Supabase CLI はローカル実行環境（インフラ）の起動管理のみ**を担います。

#### メリット
1. **リポジトリの統合**: コード、DB定義、マイグレーション履歴を同じコミットで管理できます。
2. **シンプルなスキーマ管理**: スキーマ変更は `schema.prisma` からマイグレーションファイルを生成し、Supabase に適用する単一の流れになります。
3. **役割の明確化**: Supabase CLI はコンテナや各種インフラの設定（`supabase/config.toml`）のみを担当します。

---

### セットアップ手順

#### 1. 動作要件
* [Docker Desktop](https://www.docker.com/products/docker-desktop/)（または同等の Docker 仮想環境）が起動していること。
* [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) がインストールされていること。

#### 2. ローカル Supabase の起動
プロジェクトルートで以下を実行し、ローカルコンテナを立ち上げます。
```bash
npx supabase start
```
起動すると、ローカルのデータベース URL や Supabase Studio の URL（デフォルトは `http://127.0.0.1:54323`）などがコンソールに出力されます。

#### 3. 環境変数の設定
`.env` ファイルを開き、データベース接続文字列をローカル環境用に書き換えます（デフォルトで記述済みの場合はそのままで問題ありません）。
```ini
# --- ローカル開発環境用 (Supabase Local) ---
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
```

#### 4. マイグレーションの適用
既存のマイグレーションファイルをローカルデータベースに適用してテーブルを作成します。
```bash
npx prisma migrate dev
```

#### 5. シードデータの投入
Prisma v7 の仕様に従い、手動でシードスクリプトを実行してカテゴリやニュースソースをデータベースに登録します。
```bash
npx prisma db seed
```

---

### ローカル運用の基本コマンド

| 操作内容 | コマンド | 概要 |
| :--- | :--- | :--- |
| **環境の起動** | `npx supabase start` | ローカルの Supabase コンテナ群を起動します。 |
| **スキーマ変更** | `npx prisma migrate dev` | `schema.prisma` の変更を検知してマイグレーションを作成・適用します。 |
| **シード実行** | `npx prisma db seed` | `prisma/seed.ts` を実行して初期データを投入します。 |
| **DBリセット** | `npx prisma migrate reset` | データベースを完全に初期化し、マイグレーションを再適用します。（※シードは手動で再実行が必要です） |

> [!NOTE]
> スキーマ管理を Prisma に一任しているため、`npx supabase db reset` コマンドは原則として使用せず、Prisma の `npx prisma migrate reset` を使用します。

### 注意事項
* **直接編集の禁止**: ローカル・本番を問わず、Supabase Studio の Table Editor などから直接テーブル構造を編集しないでください。スキーマの変更は常に `schema.prisma` を経由させてください。

---

## 🚀 使用方法

### 📰 ニュースを確認する
* ブラウザで [http://localhost:3000](http://localhost:3000) にアクセスして、収集したニュース一覧を確認・閲覧できます。

### 🔄 ニュースを手動で同期（収集）する
* ローカル開発環境では、ブラウザで [http://localhost:3000/api/cron/fetch-news](http://localhost:3000/api/cron/fetch-news) にアクセスすると、ニュースの取得処理が実行されます。
* ※本番環境（Vercel）では、セキュリティ保護のため Vercel Cron（`CRON_SECRET` を用いた認証）によってのみ定期自動実行されます。

---

## 🔒 セキュリティに関する注意点 (Supabase RLS)

本アプリケーションはサーバーサイドから Prisma (管理者接続) を使用してデータベースに直接接続するため、基本的には Supabase の **RLS（Row Level Security）の影響を受けません（バイパスされます）**。

しかし、Supabase が自動で公開する REST API 経由での予期せぬデータ漏洩を防ぐため、以下のセキュリティ設定を推奨します。

### 推奨設定手順
1. Supabase ダッシュボードの **Table Editor** に移動します。
2. `NewsItem` テーブルを選択し、画面右上の **RLS (Row Level Security)** を **Enable（有効）** にします。
3. **ポリシー（Policies）は作成しないでください。**
   * ポリシーを作成しないことで、外部の API 経由からの読み書きがすべて遮断されます。
   * アプリケーション（Prisma）からは直接接続しているため、ポリシーが空の状態でも問題なく正常に動作します。
