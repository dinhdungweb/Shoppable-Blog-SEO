CREATE TABLE "AnalyticsDaily" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "articleId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'Direct',
  "impressions" INTEGER NOT NULL DEFAULT 0,
  "clicks" INTEGER NOT NULL DEFAULT 0,
  "addToCarts" INTEGER NOT NULL DEFAULT 0,
  "purchases" INTEGER NOT NULL DEFAULT 0,
  "sessions" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsDaily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalyticsDailySession" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "articleId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sessionKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsDailySession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnalyticsDaily_shop_date_articleId_productId_source_key" ON "AnalyticsDaily"("shop", "date", "articleId", "productId", "source");
CREATE INDEX "AnalyticsDaily_shop_date_idx" ON "AnalyticsDaily"("shop", "date");
CREATE INDEX "AnalyticsDaily_shop_articleId_date_idx" ON "AnalyticsDaily"("shop", "articleId", "date");
CREATE INDEX "AnalyticsDaily_shop_productId_date_idx" ON "AnalyticsDaily"("shop", "productId", "date");
CREATE UNIQUE INDEX "AnalyticsDailySession_shop_date_articleId_productId_source_sessionKey_key" ON "AnalyticsDailySession"("shop", "date", "articleId", "productId", "source", "sessionKey");
CREATE INDEX "AnalyticsDailySession_shop_date_idx" ON "AnalyticsDailySession"("shop", "date");

WITH normalized AS (
  SELECT
    "shop",
    date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS "date",
    "articleId",
    "productId",
    CASE
      WHEN "referrer" IS NULL OR btrim("referrer") = '' THEN 'Direct'
      ELSE regexp_replace(lower(regexp_replace(regexp_replace("referrer", '^https?://', '', 'i'), '/.*$', '')), '^www\.', '')
    END AS "source",
    "eventType",
    COALESCE(NULLIF("sessionId", ''), "id") AS "sessionKey"
  FROM "WidgetEvent"
), grouped AS (
  SELECT "shop", "date", "articleId", "productId", "source",
    COUNT(*) FILTER (WHERE "eventType" = 'impression')::int AS "impressions",
    COUNT(*) FILTER (WHERE "eventType" = 'click')::int AS "clicks",
    COUNT(*) FILTER (WHERE "eventType" = 'add_to_cart')::int AS "addToCarts",
    COUNT(*) FILTER (WHERE "eventType" IN ('purchase', 'order'))::int AS "purchases",
    COUNT(DISTINCT "sessionKey")::int AS "sessions"
  FROM normalized
  GROUP BY "shop", "date", "articleId", "productId", "source"
)
INSERT INTO "AnalyticsDaily" ("id", "shop", "date", "articleId", "productId", "source", "impressions", "clicks", "addToCarts", "purchases", "sessions", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text || "shop" || "articleId" || "productId" || "source"), "shop", "date", "articleId", "productId", "source", "impressions", "clicks", "addToCarts", "purchases", "sessions", CURRENT_TIMESTAMP
FROM grouped;

WITH normalized AS (
  SELECT DISTINCT
    "shop",
    date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS "date",
    "articleId",
    "productId",
    CASE
      WHEN "referrer" IS NULL OR btrim("referrer") = '' THEN 'Direct'
      ELSE regexp_replace(lower(regexp_replace(regexp_replace("referrer", '^https?://', '', 'i'), '/.*$', '')), '^www\.', '')
    END AS "source",
    COALESCE(NULLIF("sessionId", ''), "id") AS "sessionKey"
  FROM "WidgetEvent"
)
INSERT INTO "AnalyticsDailySession" ("id", "shop", "date", "articleId", "productId", "source", "sessionKey", "createdAt")
SELECT md5(random()::text || clock_timestamp()::text || "shop" || "sessionKey"), "shop", "date", "articleId", "productId", "source", "sessionKey", CURRENT_TIMESTAMP
FROM normalized;
