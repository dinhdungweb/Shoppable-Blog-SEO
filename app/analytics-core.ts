/**
 * Shared analytics math for Home and Insights. Both pages read the same
 * AnalyticsDaily aggregates through these functions, so their numbers match.
 * Pure functions only (no database or network access).
 */

export type DailyRow = {
  date: Date;
  articleId: string;
  productId: string;
  source: string;
  views: number;
  /** Readers who saw the products (once per session per article). */
  seen: number;
  impressions: number;
  clicks: number;
  addToCarts: number;
  purchases: number;
  units: number;
  /** Amount actually paid, in `currency`. */
  revenue: number;
  /** "" for rows without revenue (impressions, clicks, legacy purchases). */
  currency: string;
};

export type Metrics = {
  views: number;
  seen: number;
  impressions: number;
  clicks: number;
  addToCarts: number;
  purchases: number;
  units: number;
  /** Revenue in the shop currency: recorded + estimated. */
  revenue: number;
  /** Part of `revenue` estimated from catalog prices for purchases recorded before real amounts were tracked. */
  estimatedRevenue: number;
  /** Paid revenue in other presentment currencies (not converted). */
  otherCurrencies: Record<string, number>;
  sessions: number;
};

export function emptyMetrics(): Metrics {
  return { views: 0, seen: 0, impressions: 0, clicks: 0, addToCarts: 0, purchases: 0, units: 0, revenue: 0, estimatedRevenue: 0, otherCurrencies: {}, sessions: 0 };
}

/** Product ids are stored numeric or as GIDs depending on the writer. */
export function normalizeProductGid(value: string) {
  if (!value) return "";
  if (value.startsWith("gid://")) return value;
  return `gid://shopify/Product/${value.split("/").pop()}`;
}

export type PriceLookup = (articleId: string, productId: string) => number;

export function addRowToMetrics(metrics: Metrics, row: DailyRow, shopCurrency: string, priceOf: PriceLookup) {
  metrics.views += row.views;
  metrics.seen += row.seen;
  metrics.impressions += row.impressions;
  metrics.clicks += row.clicks;
  metrics.addToCarts += row.addToCarts;
  metrics.purchases += row.purchases;
  metrics.units += row.units;
  if (row.currency) {
    if (!shopCurrency || row.currency === shopCurrency) metrics.revenue += row.revenue;
    else metrics.otherCurrencies[row.currency] = (metrics.otherCurrencies[row.currency] || 0) + row.revenue;
  } else if (row.purchases > 0) {
    // Purchases tracked before real order amounts existed: estimate from the linked price.
    const estimate = priceOf(row.articleId, normalizeProductGid(row.productId)) * row.purchases;
    metrics.revenue += estimate;
    metrics.estimatedRevenue += estimate;
  }
  return metrics;
}

export function sumRows(rows: DailyRow[], shopCurrency: string, priceOf: PriceLookup, sessions = 0) {
  const metrics = rows.reduce((total, row) => addRowToMetrics(total, row, shopCurrency, priceOf), emptyMetrics());
  metrics.sessions = sessions;
  return metrics;
}

export function groupRows(rows: DailyRow[], keyOf: (row: DailyRow) => string, shopCurrency: string, priceOf: PriceLookup) {
  const groups = new Map<string, Metrics>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    groups.set(key, addRowToMetrics(groups.get(key) || emptyMetrics(), row, shopCurrency, priceOf));
  }
  return groups;
}

/** Day buckets between start and end (inclusive), keyed by the stored day date. */
export function bucketByDay(rows: DailyRow[], start: Date, end: Date, shopCurrency: string, priceOf: PriceLookup) {
  const days: Array<{ date: Date } & Metrics> = [];
  for (let time = start.getTime(); time <= end.getTime(); time += 86_400_000) days.push({ date: new Date(time), ...emptyMetrics() });
  for (const row of rows) {
    const index = Math.floor((row.date.getTime() - start.getTime()) / 86_400_000);
    if (index >= 0 && index < days.length) addRowToMetrics(days[index], row, shopCurrency, priceOf);
  }
  return days;
}

export function rate(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

// ── Time zones ─────────────────────────────────────────────────────────────

/**
 * The calendar day of `instant` in the shop's time zone, as a UTC-midnight Date
 * (the storage format of AnalyticsDaily.date). Falls back to UTC.
 */
export function shopDay(instant: Date, timeZone?: string | null) {
  let parts: Record<string, string> | null = null;
  if (timeZone) {
    try {
      parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
          .formatToParts(instant)
          .map((part) => [part.type, part.value]),
      );
    } catch {
      parts = null;
    }
  }
  if (!parts) return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
}

/** First day of a window of `days` days ending today (shop time), plus the equal previous window. */
export function analyticsWindow(now: Date, days: number, timeZone?: string | null) {
  const today = shopDay(now, timeZone);
  const currentStart = new Date(today.getTime() - (days - 1) * 86_400_000);
  const previousStart = new Date(currentStart.getTime() - days * 86_400_000);
  return { today, currentStart, previousStart };
}

// ── Money ──────────────────────────────────────────────────────────────────

/**
 * Parses prices written as "29.99", "1,299.00", "1.299,00", "1 299,00" or
 * "₫1.299.000". The last separator followed by 1–2 digits is the decimal point.
 */
export function parseMoney(value: unknown) {
  const raw = String(value ?? "").replace(/[^\d.,-]/g, "");
  if (!raw) return 0;
  const lastSeparator = Math.max(raw.lastIndexOf("."), raw.lastIndexOf(","));
  const decimals = lastSeparator >= 0 ? raw.length - lastSeparator - 1 : 0;
  const normalized = lastSeparator >= 0 && decimals > 0 && decimals <= 2
    ? `${raw.slice(0, lastSeparator).replace(/[.,]/g, "")}.${raw.slice(lastSeparator + 1)}`
    : raw.replace(/[.,]/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

export function formatMoney(value: number, currency = "USD", locale = "en-US") {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: Math.abs(value % 1) < 0.005 ? 0 : 2,
    }).format(value || 0);
  } catch {
    return `${(value || 0).toFixed(2)} ${currency}`;
  }
}

// ── Sources ────────────────────────────────────────────────────────────────

/** Hostname of a referrer URL (personal data in paths and query strings is dropped). */
export function referrerHost(referrer: string) {
  if (!referrer) return "";
  try {
    return new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return referrer.toLowerCase().replace(/^https?:\/\//, "").split(/[/?#]/)[0].replace(/^www\./, "");
  }
}

export function sourceChannel(source: string) {
  const host = (source || "").toLowerCase();
  if (!host || host === "direct") return "Direct";
  if (/(^|\.)(google|bing|yahoo|duckduckgo|baidu|yandex|ecosia|coccoc)\./.test(host) || /^(google|bing|yahoo|duckduckgo|baidu|yandex|coccoc)/.test(host)) return "Organic search";
  if (/(facebook|instagram|pinterest|tiktok|twitter|t\.co$|x\.com|linkedin|youtube|reddit|zalo|threads)/.test(host)) return "Social";
  if (/(mail|klaviyo|omnisend|mailchimp|sendgrid)/.test(host)) return "Email";
  return "Referral";
}

// ── Attribution window ─────────────────────────────────────────────────────

export const ATTRIBUTION_WINDOW_OPTIONS = ["1 day", "7 days", "14 days", "30 days"] as const;

/** Days a product click keeps credit for later add-to-carts and purchases. */
export function attributionWindowDays(value: unknown) {
  const days = Number.parseInt(String(value ?? ""), 10);
  return [1, 7, 14, 30].includes(days) ? days : 7;
}
