-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "language" TEXT,
    "country" TEXT,
    "defaultCategoryId" TEXT NOT NULL,
    "lastFetchedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsItemCategory" (
    "newsItemId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'source-default',
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsItemCategory_pkey" PRIMARY KEY ("newsItemId","categoryId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Source_url_key" ON "Source"("url");

-- CreateIndex
CREATE INDEX "NewsItemCategory_categoryId_idx" ON "NewsItemCategory"("categoryId");

-- Insert initial category seed data into Category
INSERT INTO "Category" ("id", "label", "sortOrder", "updatedAt") VALUES
('domestic', '国内', 10, CURRENT_TIMESTAMP),
('world', '国際', 20, CURRENT_TIMESTAMP),
('business', '経済', 30, CURRENT_TIMESTAMP),
('technology', 'テクノロジー', 40, CURRENT_TIMESTAMP),
('politics', '政治', 50, CURRENT_TIMESTAMP),
('sports', 'スポーツ', 60, CURRENT_TIMESTAMP),
('entertainment', 'エンタメ', 70, CURRENT_TIMESTAMP),
('science', '科学', 80, CURRENT_TIMESTAMP),
('health', '健康', 90, CURRENT_TIMESTAMP),
('gourmet', 'グルメ', 100, CURRENT_TIMESTAMP),
('other', 'その他', 999, CURRENT_TIMESTAMP);

-- Insert initial source seed data into Source
INSERT INTO "Source" ("id", "name", "url", "defaultCategoryId", "language", "country", "updatedAt") VALUES
('google', 'Google News', 'https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja', 'other', 'ja', 'JP', CURRENT_TIMESTAMP),
('nhk', 'NHK ニュース', 'https://news.web.nhk/n-data/conf/na/rss/cat0.xml', 'domestic', 'ja', 'JP', CURRENT_TIMESTAMP),
('bbc', 'BBC News (JP)', 'https://feeds.bbci.co.uk/japanese/rss.xml', 'world', 'ja', 'JP', CURRENT_TIMESTAMP),
('itmedia', 'ITmedia', 'https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml', 'technology', 'ja', 'JP', CURRENT_TIMESTAMP);

-- AlterTable
ALTER TABLE "NewsItem" RENAME COLUMN "categories" TO "rawCategories";
ALTER TABLE "NewsItem" DROP COLUMN "sourceName";

-- Populate existing articles categories in NewsItemCategory
INSERT INTO "NewsItemCategory" ("newsItemId", "categoryId", "method")
SELECT
  "id",
  CASE "sourceId"
    WHEN 'google' THEN 'other'
    WHEN 'nhk' THEN 'domestic'
    WHEN 'bbc' THEN 'world'
    WHEN 'itmedia' THEN 'technology'
    ELSE 'other'
  END,
  'source-default'
FROM "NewsItem"
ON CONFLICT DO NOTHING;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_defaultCategoryId_fkey" FOREIGN KEY ("defaultCategoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsItemCategory" ADD CONSTRAINT "NewsItemCategory_newsItemId_fkey" FOREIGN KEY ("newsItemId") REFERENCES "NewsItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsItemCategory" ADD CONSTRAINT "NewsItemCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
