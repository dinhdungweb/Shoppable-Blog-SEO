import { describe, expect, it } from "vitest";
import { emptyMetrics, type Metrics } from "./analytics-core";
import { buildDataInsights, postKpis, toCsv, type PostPerformance } from "./analytics-insights";

const money = (value: number) => `$${value.toFixed(2)}`;

function post(id: string, metrics: Partial<Metrics>, extra: Partial<PostPerformance> = {}): PostPerformance {
  return { id: `gid://shopify/Article/${id}`, title: `Post ${id}`, blogTitle: "News", productCount: 2, seoScore: 80, metrics: { ...emptyMetrics(), ...metrics }, ...extra };
}

describe("post KPIs", () => {
  it("measures the reader funnel", () => {
    const kpis = postKpis({ ...emptyMetrics(), views: 1000, seen: 400, impressions: 400, clicks: 20, purchases: 5, revenue: 250 });
    expect(kpis).toEqual({ readers: 1000, productVisibility: 40, productCtr: 5, conversionRate: 0.5, revenuePerThousandReaders: 250 });
  });
});

describe("data-driven insights", () => {
  it("flags products placed where readers never see them", () => {
    const [insight] = buildDataInsights([post("1", { views: 500, seen: 50, impressions: 150, clicks: 5 })], money);
    expect(insight.id).toBe("low-visibility");
    expect(insight.detail).toContain("10%");
    expect(insight.url).toBe("/app/blogs/1");
  });

  it("flags popular posts without products first", () => {
    const insights = buildDataInsights([
      post("1", { views: 800, seen: 50, impressions: 50 }),
      post("2", { views: 900 }, { productCount: 0 }),
    ], money);
    expect(insights[0].id).toBe("no-products");
  });

  it("finds low CTR, abandoned carts, search upside and the best earner", () => {
    const insights = buildDataInsights([
      post("1", { views: 300, seen: 250, impressions: 250, clicks: 1 }),
      post("2", { views: 200, seen: 150, impressions: 150, clicks: 30, addToCarts: 10, purchases: 1, revenue: 40 }, { google: { clicks: 5, impressions: 2000 } }),
    ], money, 10);
    expect(insights.map((insight) => insight.id)).toEqual(expect.arrayContaining(["low-ctr", "abandoned", "search-upside", "best"]));
  });

  it("ignores tiny samples", () => {
    expect(buildDataInsights([post("1", { views: 10, impressions: 1 })], money)).toEqual([]);
  });
});

describe("CSV export", () => {
  it("quotes values and neutralizes spreadsheet formulas", () => {
    expect(toCsv([["Title", "Revenue"], ["Shoes, \"best\"", 12.346], ["=HYPERLINK(1)", -5]])).toBe('Title,Revenue\r\n"Shoes, ""best""",12.35\r\n\'=HYPERLINK(1),-5');
  });
});
