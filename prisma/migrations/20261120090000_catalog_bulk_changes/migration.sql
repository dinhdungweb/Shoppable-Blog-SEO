CREATE TABLE "CatalogBulkChange" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "beforeSeoTitle" TEXT NOT NULL DEFAULT '',
  "beforeSeoDescription" TEXT NOT NULL DEFAULT '',
  "afterSeoTitle" TEXT NOT NULL DEFAULT '',
  "afterSeoDescription" TEXT NOT NULL DEFAULT '',
  "mediaId" TEXT NOT NULL DEFAULT '',
  "imageUrl" TEXT NOT NULL DEFAULT '',
  "beforeImageAlt" TEXT NOT NULL DEFAULT '',
  "afterImageAlt" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'applied',
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "undoneAt" TIMESTAMP(3),
  CONSTRAINT "CatalogBulkChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CatalogBulkChange_shop_appliedAt_idx" ON "CatalogBulkChange"("shop", "appliedAt");
CREATE INDEX "CatalogBulkChange_shop_batchId_idx" ON "CatalogBulkChange"("shop", "batchId");
