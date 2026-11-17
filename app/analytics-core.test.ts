import { describe, expect, it } from "vitest";
import { analyticsWindow, bucketByDay, formatMoney, groupRows, parseMoney, rate, referrerHost, shopDay, sourceChannel, sumRows, type DailyRow } from "./analytics-core";

function row(overrides: Partial<DailyRow>): DailyRow {
  return {
    date: new Date("2026-11-10T00:00:00Z"), articleId: "a1", productId: "gid://shopify/Product/1", source: "google.com",
    views: 0, seen: 0, impressions: 0, clicks: 0, addToCarts: 0, purchases: 0, units: 0, revenue: 0, currency: "",
    ...overrides,
  };
}

const priceOf = (articleId: string, productId: string) => (articleId === "a1" && productId === "gid://shopify/Product/1" ? 20 : 0);

describe("parseMoney", () => {
  it("reads common price formats", () => {
    expect(parseMoney("29.99")).toBe(29.99);
    expect(parseMoney("1,299.00")).toBe(1299);
    expect(parseMoney("1.299,50")).toBe(1299.5);
    expect(parseMoney("1 299,5")).toBe(1299.5);
    expect(parseMoney("₫1.299.000")).toBe(1299000);
    expect(parseMoney("")).toBe(0);
  });
});

describe("metrics", () => {
  it("uses real revenue when recorded and estimates legacy purchases", () => {
    const metrics = sumRows([
      row({ impressions: 10, clicks: 2 }),
      row({ purchases: 1, units: 3, revenue: 57.5, currency: "USD" }),
      row({ purchases: 2 }), // legacy: no amount recorded
      row({ purchases: 1, units: 1, revenue: 40, currency: "EUR" }),
    ], "USD", priceOf, 5);
    expect(metrics.revenue).toBe(97.5);
    expect(metrics.estimatedRevenue).toBe(40);
    expect(metrics.otherCurrencies).toEqual({ EUR: 40 });
    expect(metrics.units).toBe(4);
    expect(metrics.purchases).toBe(4);
    expect(metrics.sessions).toBe(5);
  });

  it("normalizes numeric product ids when estimating", () => {
    expect(sumRows([row({ productId: "1", purchases: 1 })], "USD", priceOf).revenue).toBe(20);
  });

  it("groups and buckets rows", () => {
    const rows = [row({ clicks: 1 }), row({ articleId: "a2", clicks: 2 }), row({ date: new Date("2026-11-11T00:00:00Z"), clicks: 4 })];
    expect(groupRows(rows, (item) => item.articleId, "USD", priceOf).get("a1")?.clicks).toBe(5);
    const days = bucketByDay(rows, new Date("2026-11-10T00:00:00Z"), new Date("2026-11-12T00:00:00Z"), "USD", priceOf);
    expect(days.map((day) => day.clicks)).toEqual([3, 4, 0]);
    expect(rate(1, 4)).toBe(25);
  });
});

describe("time zones", () => {
  it("assigns events to the shop's calendar day", () => {
    const instant = new Date("2026-11-10T20:30:00Z"); // 03:30 on Nov 11 in Ho Chi Minh City
    expect(shopDay(instant, "Asia/Ho_Chi_Minh").toISOString()).toBe("2026-11-11T00:00:00.000Z");
    expect(shopDay(instant, "America/Los_Angeles").toISOString()).toBe("2026-11-10T00:00:00.000Z");
    expect(shopDay(instant, "Not/AZone").toISOString()).toBe("2026-11-10T00:00:00.000Z");
  });

  it("builds equal current and previous windows", () => {
    const window = analyticsWindow(new Date("2026-11-10T12:00:00Z"), 7, "UTC");
    expect(window.currentStart.toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(window.previousStart.toISOString()).toBe("2026-10-28T00:00:00.000Z");
  });
});

describe("money and sources", () => {
  it("formats in the shop currency", () => {
    expect(formatMoney(1299.5, "EUR", "en-US")).toBe("€1,299.50");
    expect(formatMoney(150000, "VND", "en-US")).toContain("150,000");
  });

  it("keeps only referrer hostnames and classifies channels", () => {
    expect(referrerHost("https://www.Google.com/search?q=private&email=a@b.c")).toBe("google.com");
    expect(sourceChannel("google.com")).toBe("Organic search");
    expect(sourceChannel("coccoc.com")).toBe("Organic search");
    expect(sourceChannel("l.facebook.com")).toBe("Social");
    expect(sourceChannel("")).toBe("Direct");
    expect(sourceChannel("partner.blog")).toBe("Referral");
  });
});
