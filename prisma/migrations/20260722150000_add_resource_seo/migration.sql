CREATE TABLE "ResourceSEO" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "handle" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "seoScore" INTEGER NOT NULL DEFAULT 0,
    "metaTitle" TEXT NOT NULL DEFAULT '',
    "metaDescription" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "imageAlt" TEXT NOT NULL DEFAULT '',
    "issues" TEXT,
    "contentHash" TEXT,
    "sourceUpdatedAt" TIMESTAMP(3),
    "lastAnalyzedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceSEO_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResourceSEO_shop_resourceType_resourceId_key" ON "ResourceSEO"("shop", "resourceType", "resourceId");
CREATE INDEX "ResourceSEO_shop_resourceType_seoScore_idx" ON "ResourceSEO"("shop", "resourceType", "seoScore");
CREATE INDEX "ResourceSEO_shop_sourceUpdatedAt_idx" ON "ResourceSEO"("shop", "sourceUpdatedAt");
