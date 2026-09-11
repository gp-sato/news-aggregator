-- CreateIndex
CREATE INDEX "NewsItem_pubDate_idx" ON "NewsItem"("pubDate" DESC);

-- CreateIndex
CREATE INDEX "NewsItem_sourceId_idx" ON "NewsItem"("sourceId");
