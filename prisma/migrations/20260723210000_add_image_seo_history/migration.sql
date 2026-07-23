CREATE TABLE "ImageSeoChange" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "changes" JSONB NOT NULL,
  "articleCount" INTEGER NOT NULL,
  "imageCount" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'applied',
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "undoneAt" TIMESTAMP(3),
  CONSTRAINT "ImageSeoChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImageSeoChange_batchId_key" ON "ImageSeoChange"("batchId");
CREATE INDEX "ImageSeoChange_shop_appliedAt_idx" ON "ImageSeoChange"("shop", "appliedAt");
