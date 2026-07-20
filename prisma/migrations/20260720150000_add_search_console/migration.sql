CREATE TABLE "SearchConsoleConnection" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "accessTokenEncrypted" TEXT NOT NULL,
  "refreshTokenEncrypted" TEXT,
  "tokenExpiresAt" TIMESTAMP(3),
  "scope" TEXT,
  "selectedSiteUrl" TEXT,
  "selectedPermissionLevel" TEXT,
  "availableSites" JSONB,
  "lastSyncedAt" TIMESTAMP(3),
  "lastSyncError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SearchConsoleConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SearchConsoleConnection_shop_key" ON "SearchConsoleConnection"("shop");

CREATE TABLE "SearchConsoleOAuthState" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SearchConsoleOAuthState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SearchConsoleOAuthState_shop_key" ON "SearchConsoleOAuthState"("shop");
CREATE UNIQUE INDEX "SearchConsoleOAuthState_stateHash_key" ON "SearchConsoleOAuthState"("stateHash");
CREATE INDEX "SearchConsoleOAuthState_expiresAt_idx" ON "SearchConsoleOAuthState"("expiresAt");

CREATE TABLE "SearchConsoleMetric" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "siteUrl" TEXT NOT NULL,
  "pageUrl" TEXT NOT NULL,
  "query" TEXT NOT NULL DEFAULT '',
  "windowDays" INTEGER NOT NULL,
  "period" TEXT NOT NULL DEFAULT 'current',
  "clicks" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "impressions" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SearchConsoleMetric_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SearchConsoleMetric_shop_siteUrl_pageUrl_query_windowDays_period_key" ON "SearchConsoleMetric"("shop", "siteUrl", "pageUrl", "query", "windowDays", "period");
CREATE INDEX "SearchConsoleMetric_shop_siteUrl_windowDays_period_idx" ON "SearchConsoleMetric"("shop", "siteUrl", "windowDays", "period");
CREATE INDEX "SearchConsoleMetric_shop_pageUrl_idx" ON "SearchConsoleMetric"("shop", "pageUrl");
