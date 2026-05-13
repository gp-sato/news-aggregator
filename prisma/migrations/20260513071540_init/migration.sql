-- CreateTable
CREATE TABLE "NewsItem" (
    "id" TEXT NOT NULL,
    "guid" TEXT,
    "title" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "pubDate" TIMESTAMP(3),
    "creator" TEXT,
    "summary" TEXT,
    "content" TEXT,
    "contentSnippet" TEXT,
    "categories" TEXT[],
    "enclosureUrl" TEXT,
    "enclosureLength" INTEGER,
    "enclosureType" TEXT,
    "sourceId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NewsItem_link_key" ON "NewsItem"("link");
