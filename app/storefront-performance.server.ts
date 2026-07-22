import type { PerformancePageType, PerformanceTarget, StorefrontPerformanceReport } from "./storefront-performance";

const LABELS: Record<PerformancePageType, string> = {
  homepage: "Homepage",
  product: "Product page",
  collection: "Collection page",
  blog: "Blog page",
};

export async function discoverPerformanceTargets(admin: any): Promise<PerformanceTarget[]> {
  const response = await admin.graphql(`#graphql
    query StorefrontPerformanceTargets {
      shop { primaryDomain { url } }
      products(first: 1, query: "status:active", sortKey: UPDATED_AT, reverse: true) {
        nodes { title handle onlineStoreUrl }
      }
      collections(first: 1, sortKey: UPDATED_AT, reverse: true) {
        nodes { title handle }
      }
      blogs(first: 1) { nodes { title handle } }
    }
  `);
  const payload: any = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors.map((item: any) => item.message).join("; "));

  const data = payload.data || {};
  const origin = normalizeOrigin(data.shop?.primaryDomain?.url);
  const product = data.products?.nodes?.[0];
  const collection = data.collections?.nodes?.[0];
  const blog = data.blogs?.nodes?.[0];

  return [
    target("homepage", LABELS.homepage, origin ? `${origin}/` : ""),
    target("product", product?.title || LABELS.product, product?.onlineStoreUrl || (origin && product?.handle ? `${origin}/products/${product.handle}` : "")),
    target("collection", collection?.title || LABELS.collection, origin && collection?.handle ? `${origin}/collections/${collection.handle}` : ""),
    target("blog", blog?.title || LABELS.blog, origin && blog?.handle ? `${origin}/blogs/${blog.handle}` : ""),
  ];
}

export async function runStorefrontPerformanceScan(targetUrl: string): Promise<StorefrontPerformanceReport> {
  const url = validatePublicUrl(targetUrl);
  const [mobile, desktop] = await Promise.all([
    runPageSpeed(url, "mobile"),
    runPageSpeed(url, "desktop"),
  ]);

  return {
    version: 1,
    url,
    fetchedUrl: mobile.fetchedUrl || desktop.fetchedUrl || url,
    seoScore: Math.round((mobile.seoScore + desktop.seoScore) / 2),
    mobile: mobile.device,
    desktop: desktop.device,
    warnings: [...new Set([...mobile.warnings, ...desktop.warnings])],
  };
}

async function runPageSpeed(url: string, strategy: "mobile" | "desktop") {
  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.append("category", "performance");
  endpoint.searchParams.append("category", "seo");
  endpoint.searchParams.set("strategy", strategy);
  endpoint.searchParams.set("locale", "en");
  if (process.env.GOOGLE_PAGESPEED_API_KEY) endpoint.searchParams.set("key", process.env.GOOGLE_PAGESPEED_API_KEY);

  const response = await fetch(endpoint, { signal: AbortSignal.timeout(90_000) });
  const payload: any = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = payload?.error?.message || `PageSpeed returned HTTP ${response.status}`;
    throw new Error(reason);
  }

  const lighthouse = payload?.lighthouseResult;
  if (!lighthouse?.categories) throw new Error("PageSpeed did not return a Lighthouse report.");
  const audits = lighthouse.audits || {};
  const metrics: Record<string, string> = {};
  for (const [key, label] of Object.entries(METRICS)) {
    const value = audits[key]?.displayValue;
    if (value) metrics[label] = String(value);
  }

  const opportunities = Object.values(audits)
    .filter((audit: any) => audit && typeof audit.score === "number" && audit.score < 0.9 && ["numeric", "binary", "metricSavings"].includes(audit.scoreDisplayMode))
    .sort((a: any, b: any) => (a.score ?? 1) - (b.score ?? 1))
    .slice(0, 12)
    .map((audit: any) => ({
      id: String(audit.id || "audit"),
      title: String(audit.title || "Improvement opportunity"),
      description: cleanDescription(audit.description),
      displayValue: String(audit.displayValue || ""),
      score: typeof audit.score === "number" ? audit.score : null,
    }));

  return {
    fetchedUrl: String(lighthouse.finalUrl || lighthouse.requestedUrl || url),
    seoScore: score(lighthouse.categories.seo?.score),
    device: {
      score: score(lighthouse.categories.performance?.score),
      metrics,
      opportunities,
    },
    warnings: Array.isArray(lighthouse.runWarnings) ? lighthouse.runWarnings.map(String).slice(0, 5) : [],
  };
}

const METRICS: Record<string, string> = {
  "first-contentful-paint": "FCP",
  "largest-contentful-paint": "LCP",
  "total-blocking-time": "TBT",
  "cumulative-layout-shift": "CLS",
  "speed-index": "Speed Index",
};

function target(type: PerformancePageType, title: string, url: string): PerformanceTarget {
  return { type, title, url, available: Boolean(url) };
}

function normalizeOrigin(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

function validatePublicUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Only public HTTPS storefront URLs can be scanned.");
  if (!url.hostname || url.username || url.password) throw new Error("The storefront URL is invalid.");
  return url.toString();
}

function score(value: unknown) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0) * 100)));
}

function cleanDescription(value: unknown) {
  return String(value || "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/`/g, "")
    .trim()
    .slice(0, 500);
}
