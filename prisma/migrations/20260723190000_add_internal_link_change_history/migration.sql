CREATE TABLE "InternalLinkChange" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "articleId" TEXT NOT NULL,
  "articleTitle" TEXT NOT NULL,
  "beforeBody" TEXT NOT NULL,
  "afterBody" TEXT NOT NULL,
  "suggestions" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'applied',
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "undoneAt" TIMESTAMP(3),
  CONSTRAINT "InternalLinkChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InternalLinkChange_shop_appliedAt_idx" ON "InternalLinkChange"("shop", "appliedAt");
CREATE INDEX "InternalLinkChange_shop_batchId_idx" ON "InternalLinkChange"("shop", "batchId");
