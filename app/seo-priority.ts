/**
 * Ranks SEO issues by severity *and* by how much search traffic the affected
 * pages already get, using Google Search Console impressions. A medium issue on
 * a page with 10,000 impressions should come before the same issue on a page
 * nobody sees.
 */

export type PriorityImpact = "High" | "Medium" | "Low";

const IMPACT_WEIGHT: Record<PriorityImpact, number> = { High: 3, Medium: 2, Low: 1 };

/** Path of a Shopify article as it appears in Search Console URLs. */
export function articleSearchPath(blogHandle: string, handle: string) {
  return blogHandle && handle ? `/blogs/${blogHandle}/${handle}`.toLowerCase() : "";
}

/** Normalizes a Search Console page URL to a locale-free, lowercase path. */
export function normalizeSearchPagePath(pageUrl: string) {
  let path: string;
  try {
    path = new URL(pageUrl, "https://store.invalid").pathname;
  } catch {
    path = pageUrl.split(/[?#]/)[0];
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the raw path when it is not valid percent-encoding.
  }
  return path.replace(/\/+$/, "").toLowerCase().replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/(?:blogs|products|collections|pages)\/)/, "");
}

/** Sums impressions per normalized path (Search Console stores page × query rows). */
export function buildImpressionsByPath(rows: Array<{ pageUrl: string; impressions: number }>) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const path = normalizeSearchPagePath(row.pageUrl);
    if (!path) continue;
    totals.set(path, (totals.get(path) || 0) + (Number.isFinite(row.impressions) ? row.impressions : 0));
  }
  return totals;
}

/** Severity weight scaled by the log of search impressions on affected pages. */
export function issuePriority(impact: PriorityImpact, impressions: number) {
  return IMPACT_WEIGHT[impact] * (1 + Math.log10(1 + Math.max(0, impressions)));
}

export function formatImpressions(value: number) {
  if (!value) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(value));
}
