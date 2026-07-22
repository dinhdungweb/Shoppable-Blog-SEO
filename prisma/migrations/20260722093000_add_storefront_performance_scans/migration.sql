CREATE TABLE "StorefrontPerformanceScan" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "pageType" TEXT NOT NULL,
    "pageTitle" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "seoScore" INTEGER NOT NULL,
    "mobileScore" INTEGER NOT NULL,
    "desktopScore" INTEGER NOT NULL,
    "report" JSONB NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorefrontPerformanceScan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StorefrontPerformanceScan_shop_pageType_key"
ON "StorefrontPerformanceScan"("shop", "pageType");

CREATE INDEX "StorefrontPerformanceScan_shop_scannedAt_idx"
ON "StorefrontPerformanceScan"("shop", "scannedAt");
