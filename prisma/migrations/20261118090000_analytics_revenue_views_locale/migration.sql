-- Real purchase revenue, article views and shop locale for analytics.
ALTER TABLE "WidgetEvent"
  ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT '';

ALTER TABLE "AnalyticsDaily"
  ADD COLUMN "views" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "seen" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "units" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT '';

-- Revenue in different presentment currencies is kept in separate rows.
DROP INDEX "AnalyticsDaily_shop_date_articleId_productId_source_key";
CREATE UNIQUE INDEX "AnalyticsDaily_shop_date_articleId_productId_source_currency_key"
  ON "AnalyticsDaily"("shop", "date", "articleId", "productId", "source", "currency");

ALTER TABLE "ShopConfig"
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "currencyCode" TEXT NOT NULL DEFAULT '';
