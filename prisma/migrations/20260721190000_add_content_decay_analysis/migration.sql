CREATE TABLE "ContentDecayAnalysis" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentDecayAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentDecayAnalysis_shop_key" ON "ContentDecayAnalysis"("shop");
