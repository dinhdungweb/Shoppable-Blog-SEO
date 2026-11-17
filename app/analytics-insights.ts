import { rate, type Metrics } from "./analytics-core";

/**
 * Per-post KPIs and data-driven recommendations for Insights. Every insight is
 * derived from measured readers, product exposure, clicks, carts and orders;
 * thresholds avoid reacting to tiny samples.
 */

export type PostPerformance = {
  id: string;
  title: string;
  blogTitle: string;
  productCount: number;
  seoScore: number | null;
  metrics: Metrics;
  google?: { clicks: number; impressions: number } | null;
};

export type PostKpis = {
  readers: number;
  /** Share of readers who scrolled to the products. */
  productVisibility: number;
  /** Product clicks per product impression. */
  productCtr: number;
  /** Orders per reader. */
  conversionRate: number;
  revenuePerThousandReaders: number;
};

export function postKpis(metrics: Metrics): PostKpis {
  return {
    readers: metrics.views,
    productVisibility: Math.min(100, rate(metrics.seen, metrics.views)),
    productCtr: rate(metrics.clicks, metrics.impressions),
    conversionRate: rate(metrics.purchases, metrics.views),
    revenuePerThousandReaders: metrics.views ? (metrics.revenue / metrics.views) * 1000 : 0,
  };
}

export type DataInsight = {
  id: string;
  tone: "success" | "warning" | "critical" | "info";
  title: string;
  detail: string;
  actionLabel: string;
  url: string;
  /** Higher first. */
  priority: number;
};

const MIN_READERS = 100;
const MIN_IMPRESSIONS = 100;
const MIN_CARTS = 5;

export function articleAnalyticsUrl(articleId: string) {
  return `/app/analytics/${encodeURIComponent(articleId.split("/").pop() || articleId)}`;
}

export function articleEditorUrl(articleId: string) {
  return `/app/blogs/${encodeURIComponent(articleId.split("/").pop() || articleId)}`;
}

export function buildDataInsights(posts: PostPerformance[], formatMoney: (value: number) => string, limit = 4): DataInsight[] {
  const insights: DataInsight[] = [];
  const add = (insight: DataInsight) => insights.push(insight);

  // Readers arrive but have nothing to buy.
  const noProducts = posts.filter((post) => post.productCount === 0 && post.metrics.views >= MIN_READERS / 2).sort((a, b) => b.metrics.views - a.metrics.views)[0];
  if (noProducts) add({ id: "no-products", tone: "warning", title: "Readers with nothing to buy", detail: `“${noProducts.title}” had ${noProducts.metrics.views.toLocaleString()} readers but no linked products.`, actionLabel: "Link products", url: articleEditorUrl(noProducts.id), priority: 90 + Math.log10(noProducts.metrics.views) });

  // Products placed too low: most readers never see them.
  const lowVisibility = posts
    .filter((post) => post.productCount > 0 && post.metrics.views >= MIN_READERS && postKpis(post.metrics).productVisibility < 30)
    .sort((a, b) => b.metrics.views - a.metrics.views)[0];
  if (lowVisibility) {
    const visibility = postKpis(lowVisibility.metrics).productVisibility;
    add({ id: "low-visibility", tone: "warning", title: "Most readers never see the products", detail: `Only ${visibility.toFixed(0)}% of “${lowVisibility.title}” readers scrolled to the products. Move a product block higher in the article.`, actionLabel: "Edit post", url: articleEditorUrl(lowVisibility.id), priority: 80 + Math.log10(lowVisibility.metrics.views) });
  }

  // Seen but not clicked: the products or their presentation do not fit the content.
  const lowCtr = posts
    .filter((post) => post.metrics.impressions >= MIN_IMPRESSIONS && postKpis(post.metrics).productCtr < 1)
    .sort((a, b) => b.metrics.impressions - a.metrics.impressions)[0];
  if (lowCtr) add({ id: "low-ctr", tone: "info", title: "Products are seen but rarely clicked", detail: `“${lowCtr.title}”: ${postKpis(lowCtr.metrics).productCtr.toFixed(1)}% of ${lowCtr.metrics.impressions.toLocaleString()} product views led to a click. Try products that match the article's topic more closely.`, actionLabel: "Review products", url: articleEditorUrl(lowCtr.id), priority: 60 + Math.log10(lowCtr.metrics.impressions) });

  // Carts without orders.
  const abandoned = posts
    .filter((post) => post.metrics.addToCarts >= MIN_CARTS && rate(post.metrics.purchases, post.metrics.addToCarts) < 20)
    .sort((a, b) => b.metrics.addToCarts - a.metrics.addToCarts)[0];
  if (abandoned) add({ id: "abandoned", tone: "info", title: "Carts that did not convert", detail: `${abandoned.metrics.addToCarts} add-to-carts from “${abandoned.title}” led to ${abandoned.metrics.purchases} order(s). Check price, stock and shipping for these products.`, actionLabel: "View details", url: articleAnalyticsUrl(abandoned.id), priority: 55 + Math.log10(abandoned.metrics.addToCarts) });

  // Earns well but Google rarely sends clicks: improve the search listing.
  const searchUpside = posts
    .filter((post) => post.metrics.revenue > 0 && post.google && post.google.impressions >= 500 && rate(post.google.clicks, post.google.impressions) < 2)
    .sort((a, b) => (b.google?.impressions || 0) - (a.google?.impressions || 0))[0];
  if (searchUpside?.google) add({ id: "search-upside", tone: "success", title: "A money post that Google under-clicks", detail: `“${searchUpside.title}” earns revenue but only ${rate(searchUpside.google.clicks, searchUpside.google.impressions).toFixed(1)}% of ${searchUpside.google.impressions.toLocaleString()} Google impressions click. A better SEO title and meta description could bring more buyers.`, actionLabel: "Improve SEO", url: articleEditorUrl(searchUpside.id), priority: 70 + Math.log10(searchUpside.google.impressions) });

  // Best earner per reader: a model to repeat.
  const best = posts
    .filter((post) => post.metrics.views >= MIN_READERS && post.metrics.revenue > 0)
    .sort((a, b) => postKpis(b.metrics).revenuePerThousandReaders - postKpis(a.metrics).revenuePerThousandReaders)[0];
  if (best) add({ id: "best", tone: "success", title: "Your best-earning post per reader", detail: `“${best.title}” earns ${formatMoney(postKpis(best.metrics).revenuePerThousandReaders)} per 1,000 readers. Write more posts on this topic.`, actionLabel: "View details", url: articleAnalyticsUrl(best.id), priority: 40 });

  return insights.sort((a, b) => b.priority - a.priority).slice(0, limit);
}

/** RFC 4180 CSV with formula-injection protection for spreadsheet apps. */
export function toCsv(rows: Array<Array<string | number>>) {
  return rows
    .map((row) => row.map((cell) => {
      if (typeof cell === "number") return String(Math.round(cell * 100) / 100);
      let value = String(cell ?? "");
      // Text starting with these characters is executed as a formula by spreadsheet apps.
      if (/^[=+\-@\t\r]/.test(value)) value = `'${value}`;
      return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    }).join(","))
    .join("\r\n");
}
