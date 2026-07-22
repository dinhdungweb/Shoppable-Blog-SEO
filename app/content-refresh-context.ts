import type { ContentRefreshQuery } from "./ai-content-refresh.server";

export type ContentRefreshMetricRow = {
  pageUrl: string;
  query: string;
  period: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export function buildContentRefreshQueries(rows: ContentRefreshMetricRow[], articlePath: string, limit = 20): ContentRefreshQuery[] {
  const normalizedPath = normalizeRefreshPath(articlePath);
  const relevant = rows.filter((row) => row.query.trim() && normalizeRefreshPath(row.pageUrl) === normalizedPath);
  const grouped = new Map<string, { current: ContentRefreshMetricRow[]; previous: ContentRefreshMetricRow[] }>();
  for (const row of relevant) {
    const query = row.query.trim();
    const bucket = grouped.get(query) || { current: [], previous: [] };
    if (row.period === "previous") bucket.previous.push(row);
    else if (row.period === "current") bucket.current.push(row);
    grouped.set(query, bucket);
  }

  return [...grouped.entries()]
    .map(([query, periods]) => {
      const current = aggregate(periods.current);
      const previous = aggregate(periods.previous);
      return {
        query,
        clicks: current.clicks,
        impressions: current.impressions,
        ctr: current.ctr,
        position: current.position,
        previousClicks: previous.clicks,
        previousImpressions: previous.impressions,
        previousCtr: previous.ctr,
        previousPosition: previous.position,
      };
    })
    .filter((row) => row.impressions > 0 || row.previousImpressions > 0)
    .sort((left, right) => queryPriority(right) - queryPriority(left))
    .slice(0, Math.max(1, Math.min(limit, 50)));
}

export function normalizeRefreshPath(value: string) {
  try {
    return new URL(value, "https://shop.example").pathname.replace(/\/$/, "").toLowerCase();
  } catch {
    return value.split(/[?#]/)[0].replace(/\/$/, "").toLowerCase();
  }
}

function aggregate(rows: ContentRefreshMetricRow[]) {
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : 0,
    position: impressions ? rows.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions : 0,
  };
}

function queryPriority(row: ContentRefreshQuery) {
  const clickDecline = Math.max(0, row.previousClicks - row.clicks) * 20;
  const strikingDistance = row.position >= 4 && row.position <= 15 ? row.impressions / Math.max(row.position, 1) : 0;
  const lowCtr = row.impressions >= 50 ? row.impressions * Math.max(0, 0.03 - row.ctr) : 0;
  return row.impressions + clickDecline + strikingDistance + lowCtr;
}
