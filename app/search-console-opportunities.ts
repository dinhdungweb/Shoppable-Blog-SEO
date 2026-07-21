export type SearchMetric = { pageUrl: string; query: string; clicks: number; impressions: number; ctr: number; position: number; period: string };
export type SearchOpportunity = { id: string; type: "low_ctr" | "striking_distance" | "decay" | "cannibalization"; title: string; detail: string; pageUrl: string; query: string; priority: number; previousValue: string; currentValue: string; changeValue: string };

export function buildSearchOpportunities(metrics: SearchMetric[]): SearchOpportunity[] {
  const currentRows = metrics.filter((row) => row.period === "current");
  const previousRows = metrics.filter((row) => row.period === "previous");
  const current = aggregateQueries(currentRows);
  const previous = aggregateQueries(previousRows);
  const opportunities: SearchOpportunity[] = [];
  for (const row of current) {
    if (row.impressions >= 100 && row.ctr < 0.02) opportunities.push({ id: `ctr:${row.pageUrl}:${row.query}`, type: "low_ctr", title: "Low CTR", detail: `${Math.round(row.impressions)} impressions`, pageUrl: row.pageUrl, query: row.query, priority: row.impressions * (0.02 - row.ctr), previousValue: "—", currentValue: `${(row.ctr * 100).toFixed(1)}% CTR`, changeValue: "Below 2%" });
    if (row.impressions >= 50 && row.position >= 4 && row.position <= 15) opportunities.push({ id: `rank:${row.pageUrl}:${row.query}`, type: "striking_distance", title: "Near top 3", detail: `${Math.round(row.impressions)} impressions`, pageUrl: row.pageUrl, query: row.query, priority: row.impressions / row.position, previousValue: "—", currentValue: `Position ${row.position.toFixed(1)}`, changeValue: "Improve rank" });
  }
  const previousMap = new Map(previous.map((row) => [row.query, row]));
  current.forEach((row) => {
    const before = previousMap.get(row.query);
    if (before && before.clicks >= 5 && row.clicks <= before.clicks * 0.7) opportunities.push({ id: `decay:${row.pageUrl}:${row.query}`, type: "decay", title: "Clicks declining", detail: "Compared with previous 28 days", pageUrl: row.pageUrl, query: row.query, priority: before.clicks - row.clicks, previousValue: `${Math.round(before.clicks)} clicks`, currentValue: `${Math.round(row.clicks)} clicks`, changeValue: `${Math.round(((row.clicks - before.clicks) / before.clicks) * 100)}%` });
  });
  const queryPages = new Map<string, SearchMetric[]>();
  currentRows.filter((row) => row.query && row.impressions >= 20).forEach((row) => queryPages.set(row.query, [...(queryPages.get(row.query) || []), row]));
  queryPages.forEach((rows, query) => {
    const pages = new Set(rows.map((row) => row.pageUrl));
    if (pages.size > 1) opportunities.push({ id: `cannibal:${query}`, type: "cannibalization", title: "Pages competing", detail: "Multiple pages rank for this query", pageUrl: rows[0].pageUrl, query, priority: rows.reduce((sum, row) => sum + row.impressions, 0), previousValue: "—", currentValue: `${pages.size} pages`, changeValue: "Consolidate" });
  });
  return opportunities.sort((a, b) => b.priority - a.priority).slice(0, 30);
}

function aggregateQueries(rows: SearchMetric[]): SearchMetric[] {
  const grouped = new Map<string, SearchMetric[]>();
  rows.filter((row) => row.query).forEach((row) => grouped.set(row.query, [...(grouped.get(row.query) || []), row]));
  return [...grouped.entries()].map(([query, queryRows]) => {
    const clicks = queryRows.reduce((sum, row) => sum + row.clicks, 0);
    const impressions = queryRows.reduce((sum, row) => sum + row.impressions, 0);
    const representative = queryRows.reduce((best, row) => row.impressions > best.impressions ? row : best);
    return {
      pageUrl: representative.pageUrl,
      query,
      clicks,
      impressions,
      ctr: impressions ? clicks / impressions : 0,
      position: impressions ? queryRows.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions : 0,
      period: representative.period,
    };
  });
}

export function summarizeSearchMetrics(metrics: SearchMetric[]) {
  const rows = metrics.filter((row) => row.period === "current");
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const weightedPosition = impressions ? rows.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions : 0;
  return { clicks: Math.round(clicks), impressions: Math.round(impressions), ctr: impressions ? clicks / impressions : 0, position: weightedPosition };
}
