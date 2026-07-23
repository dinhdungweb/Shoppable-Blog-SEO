CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiUsage_shop_periodStart_key" ON "AiUsage"("shop", "periodStart");
CREATE INDEX "AiUsage_periodStart_idx" ON "AiUsage"("periodStart");
