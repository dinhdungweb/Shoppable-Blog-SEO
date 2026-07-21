CREATE TABLE "InternalLinkAnalysis" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "report" JSONB NOT NULL,
  "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InternalLinkAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InternalLinkAnalysis_shop_key" ON "InternalLinkAnalysis"("shop");
