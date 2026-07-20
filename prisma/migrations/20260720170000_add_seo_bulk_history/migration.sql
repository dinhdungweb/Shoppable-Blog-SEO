CREATE TABLE "SeoBulkChange" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "articleId" TEXT NOT NULL,
  "articleTitle" TEXT NOT NULL,
  "beforeMetaTitle" TEXT NOT NULL DEFAULT '',
  "beforeMetaDescription" TEXT NOT NULL DEFAULT '',
  "afterMetaTitle" TEXT NOT NULL DEFAULT '',
  "afterMetaDescription" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'applied',
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "undoneAt" TIMESTAMP(3),
  CONSTRAINT "SeoBulkChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SeoBulkChange_shop_appliedAt_idx" ON "SeoBulkChange"("shop", "appliedAt");
CREATE INDEX "SeoBulkChange_shop_batchId_idx" ON "SeoBulkChange"("shop", "batchId");
