-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "widgetStyle" TEXT NOT NULL DEFAULT 'carousel',
    "primaryColor" TEXT NOT NULL DEFAULT '#6366f1',
    "showPrice" BOOLEAN NOT NULL DEFAULT true,
    "showRating" BOOLEAN NOT NULL DEFAULT true,
    "showAddToCart" BOOLEAN NOT NULL DEFAULT true,
    "seoAutoSchema" BOOLEAN NOT NULL DEFAULT true,
    "maxProducts" INTEGER NOT NULL DEFAULT 6,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleProduct" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "articleTitle" TEXT NOT NULL,
    "articleHandle" TEXT NOT NULL,
    "blogId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "productHandle" TEXT NOT NULL,
    "productImage" TEXT NOT NULL DEFAULT '',
    "productPrice" TEXT NOT NULL DEFAULT '0',
    "position" INTEGER NOT NULL DEFAULT 0,
    "displayStyle" TEXT NOT NULL DEFAULT 'card',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleSEO" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "articleTitle" TEXT NOT NULL DEFAULT '',
    "seoScore" INTEGER NOT NULL DEFAULT 0,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "focusKeyword" TEXT,
    "schemaGenerated" BOOLEAN NOT NULL DEFAULT false,
    "lastAnalyzedAt" TIMESTAMP(3),
    "issues" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleSEO_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WidgetEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sessionId" TEXT,
    "referrer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WidgetEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopConfig_shop_key" ON "ShopConfig"("shop");

-- CreateIndex
CREATE INDEX "ArticleProduct_shop_idx" ON "ArticleProduct"("shop");

-- CreateIndex
CREATE INDEX "ArticleProduct_articleId_idx" ON "ArticleProduct"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleProduct_articleId_productId_key" ON "ArticleProduct"("articleId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleSEO_articleId_key" ON "ArticleSEO"("articleId");

-- CreateIndex
CREATE INDEX "ArticleSEO_shop_idx" ON "ArticleSEO"("shop");

-- CreateIndex
CREATE INDEX "WidgetEvent_shop_createdAt_idx" ON "WidgetEvent"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "WidgetEvent_articleId_idx" ON "WidgetEvent"("articleId");

-- CreateIndex
CREATE INDEX "WidgetEvent_productId_idx" ON "WidgetEvent"("productId");
