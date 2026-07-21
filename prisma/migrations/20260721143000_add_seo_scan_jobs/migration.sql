CREATE TABLE "SeoScanJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "phase" TEXT NOT NULL DEFAULT 'Queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "totalPosts" INTEGER NOT NULL DEFAULT 0,
    "processedPosts" INTEGER NOT NULL DEFAULT 0,
    "analyzedPosts" INTEGER NOT NULL DEFAULT 0,
    "averageScore" INTEGER,
    "error" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SeoScanJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SeoScanJob_shop_requestedAt_idx" ON "SeoScanJob"("shop", "requestedAt");
CREATE INDEX "SeoScanJob_status_requestedAt_idx" ON "SeoScanJob"("status", "requestedAt");

ALTER TABLE "ShopConfig" ADD COLUMN "seoAutoScanEnabled" BOOLEAN NOT NULL DEFAULT false;
