import prisma from "./db.server";
import { SEARCH_CONSOLE_TOTAL_PAGE, isSearchConsoleConfigured } from "./search-console.server";
import { buildSearchOpportunities } from "./search-console-opportunities";
import type { SearchConsoleData } from "./components/SearchConsoleCard";

/** 28-day Search Console snapshot (current + previous period) for one property. */
export async function loadSearchConsoleMetrics(shop: string, siteUrl: string) {
  const empty = { metrics: [], summary: { clicks: 0, impressions: 0, ctr: 0, position: 0 }, lastSyncedAt: null as Date | null };
  if (!siteUrl) return empty;
  try {
    const where = { shop, siteUrl, windowDays: 28, period: "current" };
    const [current, previous, total, aggregate, latest] = await Promise.all([
      prisma.searchConsoleMetric.findMany({ where: { ...where, pageUrl: { not: SEARCH_CONSOLE_TOTAL_PAGE } }, orderBy: { impressions: "desc" }, take: 500,
        select: { pageUrl: true, query: true, clicks: true, impressions: true, ctr: true, position: true, period: true } }),
      prisma.searchConsoleMetric.findMany({ where: { shop, siteUrl, windowDays: 28, period: "previous", pageUrl: { not: SEARCH_CONSOLE_TOTAL_PAGE } }, orderBy: { clicks: "desc" }, take: 500,
        select: { pageUrl: true, query: true, clicks: true, impressions: true, ctr: true, position: true, period: true } }),
      prisma.searchConsoleMetric.findFirst({ where: { ...where, pageUrl: SEARCH_CONSOLE_TOTAL_PAGE }, select: { clicks: true, impressions: true, ctr: true, position: true } }),
      prisma.searchConsoleMetric.aggregate({ where: { ...where, pageUrl: { not: SEARCH_CONSOLE_TOTAL_PAGE } }, _sum: { clicks: true, impressions: true }, _avg: { position: true } }),
      prisma.searchConsoleMetric.findFirst({ where: { shop, siteUrl }, orderBy: { syncedAt: "desc" }, select: { syncedAt: true } }),
    ]);
    const clicks = total?.clicks ?? aggregate._sum.clicks ?? 0;
    const impressions = total?.impressions ?? aggregate._sum.impressions ?? 0;
    return { metrics: [...current, ...previous], lastSyncedAt: latest?.syncedAt || null, summary: {
      clicks: Math.round(clicks), impressions: Math.round(impressions),
      ctr: total?.ctr ?? (impressions ? clicks / impressions : 0),
      position: total?.position ?? aggregate._avg.position ?? 0,
    } };
  } catch (error) {
    console.error("Search Console snapshot query failed:", error);
    return empty;
  }
}

/**
 * Everything the shared SearchConsoleCard needs. Used by SEO Audit → Keywords
 * (data view) and Settings → Integrations (connection management).
 */
export async function loadSearchConsoleView(shop: string, canSearchConsole: boolean): Promise<SearchConsoleData> {
  const base: SearchConsoleData = {
    available: canSearchConsole,
    configured: isSearchConsoleConfigured(),
    connected: false,
    selectedSiteUrl: "",
    availableSites: [],
    lastSyncedAt: null,
    error: "",
    summary: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    opportunities: [],
  };
  if (!canSearchConsole) return base;

  const connection = await prisma.searchConsoleConnection.findUnique({ where: { shop } }).catch((error) => {
    console.error("Search Console connection table unavailable:", error);
    return null;
  });
  if (!connection) return base;

  const snapshot = await loadSearchConsoleMetrics(shop, connection.selectedSiteUrl || "");
  return {
    ...base,
    connected: true,
    selectedSiteUrl: connection.selectedSiteUrl || "",
    availableSites: (connection.availableSites as SearchConsoleData["availableSites"] | null) || [],
    lastSyncedAt: snapshot.lastSyncedAt?.toISOString() || null,
    error: connection.lastSyncError || "",
    summary: snapshot.summary,
    opportunities: buildSearchOpportunities(snapshot.metrics),
  };
}
