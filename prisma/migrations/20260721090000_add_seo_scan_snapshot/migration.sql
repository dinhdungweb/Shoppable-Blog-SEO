ALTER TABLE "ArticleSEO"
  ADD COLUMN "articleHandle" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "blogTitle" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "blogHandle" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "imageUrl" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "imageAlt" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "auditVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "baseSeoScore" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "ArticleSEO_shop_sourceUpdatedAt_idx" ON "ArticleSEO"("shop", "sourceUpdatedAt");
