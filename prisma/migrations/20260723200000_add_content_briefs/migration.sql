-- CreateTable
CREATE TABLE "ContentBrief" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "seedKeyword" TEXT NOT NULL DEFAULT '',
    "sourceArticleId" TEXT NOT NULL DEFAULT '',
    "sourceArticleTitle" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ready',
    "brief" JSONB NOT NULL,
    "draft" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE INDEX "ContentBrief_shop_updatedAt_idx" ON "ContentBrief"("shop", "updatedAt");
