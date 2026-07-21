export type DecayArticle = {
  id: string;
  title: string;
  handle: string;
  blogHandle: string;
  updatedAt: string | Date | null;
  publishedAt: string | Date | null;
  body: string;
};

export type DecaySearchMetric = {
  pageUrl: string;
  period: string;
  clicks: number;
  impressions: number;
  ctr: number;
};

export type DecayProduct = {
  articleId: string;
  productId: string;
  productTitle: string;
  exists: boolean;
  available: boolean;
};

export type DecayIssueType = "traffic_decline" | "ctr_decline" | "stale_content" | "unavailable_product" | "broken_outbound" | "outdated_year";
export type DecayIssue = {
  id: string;
  articleId: string;
  articleTitle: string;
  type: DecayIssueType;
  severity: "high" | "medium" | "low";
  message: string;
  previousValue: string;
  currentValue: string;
  recommendation: string;
  detail?: string;
};

export type ContentDecayReport = {
  version: 1;
  articlesAnalyzed: number;
  searchDataAvailable: boolean;
  externalLinksChecked: number;
  externalLinksSkipped: number;
  schemaEnabled: boolean;
  inventoryDataAvailable: boolean;
  issues: DecayIssue[];
};

export function analyzeContentDecay(input: {
  articles: DecayArticle[];
  metrics: DecaySearchMetric[];
  products: DecayProduct[];
  brokenOutboundByArticle?: Map<string, string[]>;
  externalLinksChecked?: number;
  externalLinksSkipped?: number;
  schemaEnabled?: boolean;
  inventoryDataAvailable?: boolean;
  now?: Date;
}): ContentDecayReport {
  const now = input.now || new Date();
  const issues: DecayIssue[] = [];
  const metrics = aggregatePageMetrics(input.metrics);
  const products = groupBy(input.products, (item) => item.articleId);

  for (const article of input.articles) {
    const path = articlePath(article);
    const pageMetrics = findPageMetrics(metrics, path);
    const current = pageMetrics.get("current");
    const previous = pageMetrics.get("previous");

    if (current && previous && previous.clicks >= 5 && current.clicks <= previous.clicks * 0.7) {
      const change = Math.round(((current.clicks - previous.clicks) / previous.clicks) * 100);
      issues.push(makeIssue(article, "traffic_decline", "high", "Organic clicks are declining", `${round(previous.clicks)} clicks`, `${round(current.clicks)} clicks`, "Refresh the article around the queries and sections that previously attracted traffic.", `${change}% versus the previous 28 days`));
    }
    if (current && previous && previous.impressions >= 50 && previous.ctr > 0 && current.ctr <= previous.ctr * 0.7) {
      const change = Math.round(((current.ctr - previous.ctr) / previous.ctr) * 100);
      issues.push(makeIssue(article, "ctr_decline", "medium", "Search CTR is declining", percent(previous.ctr), percent(current.ctr), "Review the SEO title and meta description against the current search intent.", `${change}% versus the previous 28 days`));
    }

    const updatedAt = toDate(article.updatedAt || article.publishedAt);
    if (updatedAt) {
      const days = Math.floor((now.getTime() - updatedAt.getTime()) / 86_400_000);
      if (days >= 365) issues.push(makeIssue(article, "stale_content", days >= 730 ? "medium" : "low", "Article has not been updated recently", formatDate(updatedAt), `${days} days ago`, "Review facts, products, links and screenshots; update only when the content genuinely changed."));
    }

    const oldYears = [...article.title.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1])).filter((year) => year < now.getFullYear());
    if (oldYears.length) issues.push(makeIssue(article, "outdated_year", "medium", "Title contains an older year", String(Math.max(...oldYears)), String(now.getFullYear()), "Confirm the article is current before changing the year in the title and URL metadata."));

    const articleProducts = products.get(article.id) || [];
    if (/\[\[SBS_PRODUCTS(?::[^\]]+)?\]\]/i.test(article.body) && articleProducts.length === 0) {
      issues.push(makeIssue(article, "unavailable_product", "high", "Product block has no active products", "Product block present", "No linked product", "Add an available Shopify product or remove the empty product block."));
    }
    for (const product of articleProducts) {
      if (!product.exists || !product.available) issues.push(makeIssue(article, "unavailable_product", "high", product.exists ? "Linked product is unavailable" : "Linked product was deleted", product.productTitle || "Linked product", product.exists ? "Out of stock or inactive" : "Not found in Shopify", "Replace or remove the product block so shoppers do not reach an unavailable item.", product.productId));
    }

    for (const href of input.brokenOutboundByArticle?.get(article.id) || []) {
      issues.push(makeIssue(article, "broken_outbound", "high", "Outbound link is not reachable", href, "Broken", "Replace or remove the external link after confirming the destination.", href));
    }
  }

  return {
    version: 1,
    articlesAnalyzed: input.articles.length,
    searchDataAvailable: input.metrics.length > 0,
    externalLinksChecked: input.externalLinksChecked || 0,
    externalLinksSkipped: input.externalLinksSkipped || 0,
    schemaEnabled: input.schemaEnabled !== false,
    inventoryDataAvailable: input.inventoryDataAvailable !== false,
    issues: issues.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.articleTitle.localeCompare(b.articleTitle)),
  };
}

function aggregatePageMetrics(rows: DecaySearchMetric[]) {
  const grouped = new Map<string, { pageUrl: string; period: string; clicks: number; impressions: number; weightedCtr: number }>();
  for (const row of rows) {
    const key = `${normalizePath(row.pageUrl)}|${row.period}`;
    const current = grouped.get(key) || { pageUrl: row.pageUrl, period: row.period, clicks: 0, impressions: 0, weightedCtr: 0 };
    current.clicks += row.clicks;
    current.impressions += row.impressions;
    current.weightedCtr += row.ctr * row.impressions;
    grouped.set(key, current);
  }
  return [...grouped.values()].map((row) => ({ ...row, ctr: row.impressions ? row.weightedCtr / row.impressions : 0 }));
}

function findPageMetrics(rows: ReturnType<typeof aggregatePageMetrics>, articlePathname: string) {
  const result = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (normalizePath(row.pageUrl) === articlePathname) result.set(row.period, row);
  return result;
}

function articlePath(article: DecayArticle) {
  return normalizePath(`/blogs/${article.blogHandle}/${article.handle}`);
}

function normalizePath(value: string) {
  try { return new URL(value, "https://shop.example").pathname.replace(/\/$/, "").toLowerCase(); }
  catch { return value.split(/[?#]/)[0].replace(/\/$/, "").toLowerCase(); }
}

function makeIssue(article: DecayArticle, type: DecayIssueType, severity: DecayIssue["severity"], message: string, previousValue: string, currentValue: string, recommendation: string, detail?: string): DecayIssue {
  return { id: `${type}:${article.id}:${detail || currentValue}`, articleId: article.id, articleTitle: article.title, type, severity, message, previousValue, currentValue, recommendation, detail };
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const grouped = new Map<string, T[]>();
  items.forEach((item) => grouped.set(key(item), [...(grouped.get(key(item)) || []), item]));
  return grouped;
}

function severityRank(value: DecayIssue["severity"]) { return value === "high" ? 3 : value === "medium" ? 2 : 1; }
function toDate(value: string | Date | null) { const date = value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? date : null; }
function formatDate(value: Date) { return value.toISOString().slice(0, 10); }
function round(value: number) { return String(Math.round(value)); }
function percent(value: number) { return `${(value * 100).toFixed(1)}%`; }
