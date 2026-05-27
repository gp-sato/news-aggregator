# 📰 News Aggregator

Next.js をベースに、PostgreSQL (Supabase) + Prisma を使用して RSS フィードからニュースを定期的に取得・集約するアプリケーションです。

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

## 🚀 使用方法

### 📰 ニュースを確認する
* ブラウザで [http://localhost:3000/news](http://localhost:3000/news) にアクセスして、収集したニュース一覧を確認・閲覧できます。

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
