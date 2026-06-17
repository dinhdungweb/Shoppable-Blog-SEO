-- Add block-level product mappings so one article can contain multiple product markers.
ALTER TABLE "ArticleProduct"
ADD COLUMN "blockId" TEXT NOT NULL DEFAULT 'default';

DROP INDEX "ArticleProduct_articleId_productId_key";

CREATE UNIQUE INDEX "ArticleProduct_articleId_blockId_productId_key"
ON "ArticleProduct"("articleId", "blockId", "productId");

CREATE INDEX "ArticleProduct_articleId_blockId_idx"
ON "ArticleProduct"("articleId", "blockId");

ALTER TABLE "WidgetEvent"
ADD COLUMN "blockId" TEXT NOT NULL DEFAULT 'default';

CREATE INDEX "WidgetEvent_articleId_blockId_idx"
ON "WidgetEvent"("articleId", "blockId");
