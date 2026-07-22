import type { PerformancePageType, PerformanceTarget, StorefrontPerformanceReport } from "./storefront-performance";

const LABELS: Record<PerformancePageType, string> = {
  homepage: "Homepage",
  other: "Other page",
};

export async function discoverPerformanceTargets(admin: any): Promise<PerformanceTarget[]> {
  const response = await admin.graphql(`#graphql
    query StorefrontPerformanceTargets {
      shop { primaryDomain { url } }
    }
  `);
  const payload: any = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors.map((item: any) => item.message).join("; "));

  const data = payload.data || {};
  const origin = normalizeOrigin(data.shop?.primaryDomain?.url);

  return [
    target("homepage", LABELS.homepage, origin ? `${origin}/` : ""),
    target("other", LABELS.other, ""),
  ];
}

export function resolveCustomPerformanceUrl(value: string, storefrontUrl: string) {
  const storefront = new URL(storefrontUrl);
  const candidate = new URL(value.trim(), storefront.origin);
  if (candidate.protocol !== "https:" || candidate.hostname !== storefront.hostname || candidate.port) {
    throw new Error("Enter an HTTPS URL from this Shopify storefront domain.");
  }
  candidate.hash = "";
  return candidate.toString();
}

export async function runStorefrontPerformanceScan(targetUrl: string): Promise<StorefrontPerformanceReport> {
  const url = validatePublicUrl(targetUrl);
  const [mobile, desktop] = await Promise.all([
    runPageSpeed(url, "mobile"),
    runPageSpeed(url, "desktop"),
  ]);

  return {
    version: 2,
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
  endpoint.searchParams.append("category", "accessibility");
  endpoint.searchParams.append("category", "best-practices");
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

  const auditEntries = collectAudits(lighthouse);
  const opportunities = auditEntries
    .filter((audit) => audit.score === null || audit.score < 0.9)
    .sort((a, b) => (a.score ?? 0.5) - (b.score ?? 0.5))
    .slice(0, 60);
  const passedAudits = auditEntries.filter((audit) => audit.score !== null && audit.score >= 0.9).slice(0, 40);
  const categories = {
    performance: score(lighthouse.categories.performance?.score),
    accessibility: score(lighthouse.categories.accessibility?.score),
    bestPractices: score(lighthouse.categories["best-practices"]?.score),
    seo: score(lighthouse.categories.seo?.score),
  };

  return {
    fetchedUrl: String(lighthouse.finalUrl || lighthouse.requestedUrl || url),
    seoScore: categories.seo,
    device: {
      score: categories.performance,
      categories,
      metrics,
      opportunities,
      passedAudits,
      fieldData: extractFieldData(payload),
      screenshot: extractScreenshot(audits),
      lighthouseVersion: String(lighthouse.lighthouseVersion || ""),
      fetchTime: String(lighthouse.fetchTime || ""),
    },
    warnings: Array.isArray(lighthouse.runWarnings) ? lighthouse.runWarnings.map(String).slice(0, 5) : [],
  };
}

function collectAudits(lighthouse: any) {
  const audits = lighthouse.audits || {};
  const groups = lighthouse.categoryGroups || {};
  const entries = new Map<string, any>();
  for (const [categoryId, category] of Object.entries(lighthouse.categories || {}) as Array<[string, any]>) {
    for (const ref of category?.auditRefs || []) {
      const audit = audits[ref.id];
      if (!audit || ["notApplicable", "manual", "error"].includes(audit.scoreDisplayMode)) continue;
      const existing = entries.get(ref.id);
      const categoryLabel = category?.title || categoryId;
      if (existing) {
        if (!existing.category.includes(categoryLabel)) existing.category += `, ${categoryLabel}`;
        continue;
      }
      entries.set(ref.id, {
        id: String(audit.id || ref.id),
        title: String(audit.title || "Lighthouse audit"),
        description: cleanDescription(audit.description),
        displayValue: String(audit.displayValue || ""),
        score: typeof audit.score === "number" ? audit.score : null,
        category: categoryLabel,
        group: String(groups[ref.group]?.title || ref.group || categoryLabel),
        details: compactAuditDetails(audit.details),
      });
    }
  }
  return [...entries.values()];
}

function compactAuditDetails(details: any): string[] {
  if (!details || !Array.isArray(details.items)) return [];
  return details.items.slice(0, 5).map((item: any) => {
    const node = item?.node || {};
    const parts = [
      item?.url,
      node?.selector,
      node?.snippet,
      formatSaving(item?.wastedMs, "ms potential savings"),
      formatSaving(item?.wastedBytes, "bytes potential savings"),
      item?.source,
    ].filter(Boolean);
    return parts.join(" · ").slice(0, 500);
  }).filter(Boolean);
}

function formatSaving(value: unknown, suffix: string) {
  const amount = Number(value || 0);
  return amount > 0 ? `${Math.round(amount).toLocaleString("en-US")} ${suffix}` : "";
}

function extractScreenshot(audits: any) {
  const data = audits?.["final-screenshot"]?.details?.data;
  return typeof data === "string" && data.startsWith("data:image/") && data.length <= 600_000 ? data : "";
}

function extractFieldData(payload: any) {
  const urlData = payload?.loadingExperience;
  const originData = payload?.originLoadingExperience;
  const source = Object.keys(urlData?.metrics || {}).length ? urlData : Object.keys(originData?.metrics || {}).length ? originData : null;
  if (!source) return { available: false, scope: "none" as const, assessment: "unknown" as const, metrics: [] };

  const metrics = Object.entries(FIELD_METRICS).flatMap(([id, definition]) => {
    const metric: any = source.metrics?.[id];
    if (!metric || typeof metric.percentile !== "number") return [];
    const raw = id === "CUMULATIVE_LAYOUT_SHIFT_SCORE" ? metric.percentile / 100 : metric.percentile;
    return [{ label: definition.label, value: definition.format(raw), rating: fieldRating(metric.category) }];
  });
  const core = metrics.filter((metric) => ["LCP", "INP", "CLS"].includes(metric.label));
  const passed = core.length === 3 && core.every((metric) => metric.rating === "good");
  return {
    available: metrics.length > 0,
    scope: source === urlData ? "url" as const : "origin" as const,
    assessment: core.length < 3 ? "unknown" as const : passed ? "passed" as const : "failed" as const,
    metrics,
  };
}

const FIELD_METRICS = {
  LARGEST_CONTENTFUL_PAINT_MS: { label: "LCP", format: (value: number) => `${(value / 1000).toFixed(1)} s` },
  INTERACTION_TO_NEXT_PAINT: { label: "INP", format: (value: number) => `${Math.round(value)} ms` },
  CUMULATIVE_LAYOUT_SHIFT_SCORE: { label: "CLS", format: (value: number) => value.toFixed(2) },
  FIRST_CONTENTFUL_PAINT_MS: { label: "FCP", format: (value: number) => `${(value / 1000).toFixed(1)} s` },
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: { label: "TTFB", format: (value: number) => `${(value / 1000).toFixed(1)} s` },
};

function fieldRating(category: unknown): "good" | "needs-improvement" | "poor" {
  if (category === "FAST") return "good";
  if (category === "AVERAGE") return "needs-improvement";
  return "poor";
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
