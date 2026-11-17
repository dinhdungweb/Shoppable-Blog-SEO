import { Prisma } from "@prisma/client";
import prisma from "./db.server";
import {
  analyticsWindow,
  bucketByDay,
  emptyMetrics,
  formatMoney,
  groupRows,
  normalizeProductGid,
  parseMoney,
  rate,
  sourceChannel,
  sumRows,
  type DailyRow,
  type Metrics,
  type PriceLookup,
} from "./analytics-core";
import { buildDataInsights, postKpis, type PostKpis } from "./analytics-insights";
import { SEARCH_CONSOLE_TOTAL_PAGE } from "./search-console.server";
import { articleSearchPath, normalizeSearchPagePath } from "./seo-priority";

/**
 * Data access shared by Home, Insights, the CSV export and the article
 * analytics page, so every screen reads the same aggregates.
 */

export type ShopLocale = { timezone: string; currencyCode: string };

/** Shop time zone and currency, refreshed from Shopify and cached on ShopConfig. */
export async function getShopLocale(admin: any, shop: string): Promise<ShopLocale> {
  const cached = await prisma.shopConfig.findUnique({ where: { shop }, select: { timezone: true, currencyCode: true } });
  try {
    const response = await admin.graphql(`#graphql
      query ShopLocale { shop { ianaTimezone currencyCode } }`);
    const payload: any = await response.json();
    const timezone = String(payload.data?.shop?.ianaTimezone || "");
    const currencyCode = String(payload.data?.shop?.currencyCode || "");
    if (timezone && currencyCode && (timezone !== cached?.timezone || currencyCode !== cached?.currencyCode)) {
      await prisma.shopConfig.upsert({
        where: { shop },
        update: { timezone, currencyCode },
        create: { shop, timezone, currencyCode },
      });
    }
    if (timezone && currencyCode) return { timezone, currencyCode };
  } catch (error) {
    console.warn("Shop locale unavailable; using cached values", error);
  }
  return { timezone: cached?.timezone || "UTC", currencyCode: cached?.currencyCode || "USD" };
}

export async function loadDailyRows(shop: string, since: Date, articleId?: string): Promise<DailyRow[]> {
  const rows = await prisma.analyticsDaily.findMany({
    where: { shop, date: { gte: since }, ...(articleId ? { articleId: { in: articleIdVariants(articleId) } } : {}) },
    orderBy: { date: "asc" },
  });
  return rows.map((row) => ({
    date: row.date,
    articleId: canonicalArticleId(row.articleId),
    productId: row.productId,
    source: row.source,
    views: row.views,
    seen: row.seen,
    impressions: row.impressions,
    clicks: row.clicks,
    addToCarts: row.addToCarts,
    purchases: row.purchases,
    units: row.units,
    revenue: Number(row.revenue),
    currency: row.currency,
  }));
}

/** Distinct reading sessions: current and previous window totals, per day and per source (counted in SQL). */
export async function loadSessionCounts(shop: string, currentStart: Date, previousStart: Date, articleId?: string) {
  const articleFilter = articleId ? Prisma.sql` AND "articleId" IN (${Prisma.join(articleIdVariants(articleId))})` : Prisma.empty;
  const [totals, byDay, bySource] = await Promise.all([
    prisma.$queryRaw<Array<{ period: string; sessions: number }>>`
      SELECT CASE WHEN "date" >= ${currentStart} THEN 'current' ELSE 'previous' END AS "period", COUNT(DISTINCT "sessionKey")::int AS "sessions"
      FROM "AnalyticsDailySession" WHERE "shop" = ${shop} AND "date" >= ${previousStart}${articleFilter} GROUP BY 1`,
    prisma.$queryRaw<Array<{ date: Date; sessions: number }>>`
      SELECT "date", COUNT(DISTINCT "sessionKey")::int AS "sessions" FROM "AnalyticsDailySession"
      WHERE "shop" = ${shop} AND "date" >= ${currentStart}${articleFilter} GROUP BY "date"`,
    prisma.$queryRaw<Array<{ source: string; sessions: number }>>`
      SELECT "source", COUNT(DISTINCT "sessionKey")::int AS "sessions" FROM "AnalyticsDailySession"
      WHERE "shop" = ${shop} AND "date" >= ${currentStart}${articleFilter} GROUP BY "source"`,
  ]);
  return {
    current: totals.find((row) => row.period === "current")?.sessions || 0,
    previous: totals.find((row) => row.period === "previous")?.sessions || 0,
    byDay: new Map(byDay.map((row) => [row.date.getTime(), row.sessions])),
    bySource,
  };
}

export type LinkedProduct = {
  articleId: string;
  articleTitle: string;
  articleHandle: string;
  blogId: string;
  productId: string;
  productTitle: string;
  productImage: string;
  productPrice: string;
};

export async function loadLinkedProducts(shop: string) {
  const products = await prisma.articleProduct.findMany({
    where: { shop, isActive: true },
    select: { articleId: true, articleTitle: true, articleHandle: true, blogId: true, productId: true, productTitle: true, productImage: true, productPrice: true },
  });
  return products.map((product) => ({ ...product, articleId: canonicalArticleId(product.articleId), productId: normalizeProductGid(product.productId) }));
}

/** Catalog price of a product linked to an article (used only for legacy revenue estimates). */
export function priceLookup(products: LinkedProduct[]): PriceLookup {
  const prices = new Map(products.map((product) => [`${product.articleId}:${product.productId}`, parseMoney(product.productPrice)]));
  return (articleId, productId) => prices.get(`${articleId}:${productId}`) || 0;
}

/** Google Search Console clicks and impressions per article for the closest synced window. */
export async function loadSearchByArticle(shop: string, days: number, articles: Array<{ id: string; blogHandle: string; handle: string }>) {
  const connection = await prisma.searchConsoleConnection.findUnique({ where: { shop }, select: { selectedSiteUrl: true } }).catch(() => null);
  if (!connection?.selectedSiteUrl) return { connected: false, windowDays: 0, byArticle: new Map<string, { clicks: number; impressions: number }>() };
  const windowDays = days <= 7 ? 7 : days <= 28 ? 28 : 90;
  const rows = await prisma.searchConsoleMetric.groupBy({
    by: ["pageUrl"],
    where: { shop, siteUrl: connection.selectedSiteUrl, windowDays, period: "current", pageUrl: { not: SEARCH_CONSOLE_TOTAL_PAGE } },
    _sum: { clicks: true, impressions: true },
  }).catch(() => []);
  const byPath = new Map<string, { clicks: number; impressions: number }>();
  for (const row of rows) {
    const path = normalizeSearchPagePath(row.pageUrl);
    const total = byPath.get(path) || { clicks: 0, impressions: 0 };
    total.clicks += row._sum.clicks || 0;
    total.impressions += row._sum.impressions || 0;
    byPath.set(path, total);
  }
  const byArticle = new Map<string, { clicks: number; impressions: number }>();
  for (const article of articles) {
    const metrics = byPath.get(articleSearchPath(article.blogHandle, article.handle));
    if (metrics) byArticle.set(article.id, { clicks: Math.round(metrics.clicks), impressions: Math.round(metrics.impressions) });
  }
  return { connected: true, windowDays, byArticle };
}

export function canonicalArticleId(value: string) {
  return /^\d+$/.test(value) ? `gid://shopify/Article/${value}` : value;
}

function articleIdVariants(articleId: string) {
  const gid = canonicalArticleId(articleId);
  return [gid, gid.replace(/^gid:\/\/shopify\/Article\//, "")];
}

// ── Report ─────────────────────────────────────────────────────────────────

export const RANGE_OPTIONS = [7, 30, 90, 180, 365] as const;

/** Ranges a plan may view; the default is 30 days (or the plan maximum if smaller). */
export function allowedRanges(maxDays: number) {
  const ranges = RANGE_OPTIONS.filter((days) => days <= maxDays);
  return ranges.length ? [...ranges] : [Math.max(1, maxDays)];
}

export function resolveRange(requested: string | null, maxDays: number) {
  const ranges = allowedRanges(maxDays);
  const value = Number(requested);
  if (ranges.includes(value as never)) return value;
  return ranges.includes(30 as never) ? 30 : ranges[ranges.length - 1];
}

export type PostReport = {
  id: string;
  title: string;
  blogTitle: string;
  blogHandle: string;
  handle: string;
  image: string;
  imageAlt: string;
  productCount: number;
  seoScore: number | null;
  metrics: Metrics;
  kpis: PostKpis;
  google: { clicks: number; impressions: number } | null;
};

export async function loadAnalyticsReport({ admin, shop, days, articleId }: { admin: any; shop: string; days: number; articleId?: string }) {
  const locale = await getShopLocale(admin, shop);
  const { today, currentStart, previousStart } = analyticsWindow(new Date(), days, locale.timezone);
  const [rows, sessions, linkedProducts, seoRows] = await Promise.all([
    loadDailyRows(shop, previousStart, articleId),
    loadSessionCounts(shop, currentStart, previousStart, articleId),
    loadLinkedProducts(shop),
    prisma.articleSEO.findMany({
      where: { shop },
      select: { articleId: true, articleTitle: true, articleHandle: true, blogTitle: true, blogHandle: true, imageUrl: true, imageAlt: true, seoScore: true, lastAnalyzedAt: true },
    }),
  ]);
  const priceOf = priceLookup(linkedProducts);
  const currency = locale.currencyCode;
  const currentRows = rows.filter((row) => row.date >= currentStart);
  const previousRows = rows.filter((row) => row.date < currentStart);
  const metrics = sumRows(currentRows, currency, priceOf, sessions.current);
  const previous = sumRows(previousRows, currency, priceOf, sessions.previous);

  const chart = bucketByDay(currentRows, currentStart, today, currency, priceOf).map((day) => ({
    date: day.date.toISOString().slice(0, 10),
    views: day.views,
    impressions: day.impressions,
    clicks: day.clicks,
    addToCarts: day.addToCarts,
    purchases: day.purchases,
    revenue: Math.round(day.revenue * 100) / 100,
    sessions: sessions.byDay.get(day.date.getTime()) || 0,
  }));

  const channelTotals = new Map<string, number>();
  for (const row of sessions.bySource) {
    const channel = sourceChannel(row.source);
    channelTotals.set(channel, (channelTotals.get(channel) || 0) + row.sessions);
  }
  const channelSum = [...channelTotals.values()].reduce((sum, value) => sum + value, 0);
  const channels = [...channelTotals].map(([name, value]) => ({ name, sessions: value, percent: rate(value, channelSum) })).sort((a, b) => b.sessions - a.sessions);

  // Article catalog: scanned posts plus any post with linked products.
  const articles = new Map<string, { id: string; title: string; blogTitle: string; blogHandle: string; handle: string; image: string; imageAlt: string; seoScore: number | null }>();
  for (const row of seoRows) {
    const id = canonicalArticleId(row.articleId);
    articles.set(id, { id, title: row.articleTitle || "Untitled post", blogTitle: row.blogTitle || "Blog", blogHandle: row.blogHandle, handle: row.articleHandle, image: row.imageUrl, imageAlt: row.imageAlt, seoScore: row.lastAnalyzedAt ? row.seoScore : null });
  }
  const productCounts = new Map<string, number>();
  for (const product of linkedProducts) {
    productCounts.set(product.articleId, (productCounts.get(product.articleId) || 0) + 1);
    if (!articles.has(product.articleId)) articles.set(product.articleId, { id: product.articleId, title: product.articleTitle || "Untitled post", blogTitle: "Blog", blogHandle: "", handle: product.articleHandle, image: "", imageAlt: "", seoScore: null });
  }

  const search = await loadSearchByArticle(shop, days, [...articles.values()]);
  const byArticle = groupRows(currentRows, (row) => row.articleId, currency, priceOf);
  const posts: PostReport[] = [...articles.values()]
    .filter((article) => !articleId || article.id === canonicalArticleId(articleId))
    .map((article) => {
      const postMetrics = byArticle.get(article.id) || emptyMetrics();
      return { ...article, productCount: productCounts.get(article.id) || 0, metrics: postMetrics, kpis: postKpis(postMetrics), google: search.byArticle.get(article.id) || null };
    })
    .filter((post) => post.productCount > 0 || post.metrics.views || post.metrics.impressions || post.metrics.purchases)
    .sort((a, b) => b.metrics.revenue - a.metrics.revenue || b.metrics.views - a.metrics.views || b.metrics.clicks - a.metrics.clicks);

  const productInfo = new Map(linkedProducts.map((product) => [product.productId, { title: product.productTitle || "Untitled product", image: product.productImage || "" }]));
  const products = [...groupRows(currentRows.filter((row) => row.productId), (row) => normalizeProductGid(row.productId), currency, priceOf)]
    .map(([id, productMetrics]) => ({ id, title: productInfo.get(id)?.title || "Removed product", image: productInfo.get(id)?.image || "", metrics: productMetrics }))
    .filter((product) => product.metrics.clicks || product.metrics.addToCarts || product.metrics.purchases)
    .sort((a, b) => b.metrics.revenue - a.metrics.revenue || b.metrics.purchases - a.metrics.purchases || b.metrics.clicks - a.metrics.clicks);

  const google = posts.reduce((total, post) => ({ clicks: total.clicks + (post.google?.clicks || 0), impressions: total.impressions + (post.google?.impressions || 0) }), { clicks: 0, impressions: 0 });
  const insights = buildDataInsights(posts, (value) => formatMoney(value, currency));

  return {
    currency,
    timezone: locale.timezone,
    days,
    range: { start: currentStart.toISOString().slice(0, 10), end: today.toISOString().slice(0, 10) },
    metrics,
    previous,
    kpis: postKpis(metrics),
    previousKpis: postKpis(previous),
    chart,
    channels,
    google: { connected: search.connected, windowDays: search.windowDays, ...google },
    posts,
    products,
    insights,
  };
}
