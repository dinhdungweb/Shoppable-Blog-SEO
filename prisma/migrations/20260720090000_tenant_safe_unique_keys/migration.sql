-- Keep article/product and SEO records isolated per Shopify store.
DROP INDEX IF EXISTS "ArticleProduct_articleId_blockId_productId_key";
DROP INDEX IF EXISTS "ArticleSEO_articleId_key";

CREATE UNIQUE INDEX "ArticleProduct_shop_articleId_blockId_productId_key"
ON "ArticleProduct"("shop", "articleId", "blockId", "productId");

CREATE UNIQUE INDEX "ArticleSEO_shop_articleId_key"
ON "ArticleSEO"("shop", "articleId");

ALTER TABLE "WidgetEvent" ADD COLUMN "eventKey" TEXT;
CREATE UNIQUE INDEX "WidgetEvent_eventKey_key" ON "WidgetEvent"("eventKey");
