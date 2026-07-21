import { describe, expect, it } from "vitest";
import { buildSearchOpportunities, summarizeSearchMetrics } from "./search-console-opportunities";

describe("Search Console opportunities", () => {
  it("finds low CTR, striking distance and cannibalization", () => {
    const rows = [
      { pageUrl: "https://x/a", query: "shoes", clicks: 1, impressions: 200, ctr: 0.005, position: 8, period: "current" },
      { pageUrl: "https://x/b", query: "shoes", clicks: 2, impressions: 100, ctr: 0.02, position: 12, period: "current" },
    ];
    expect(new Set(buildSearchOpportunities(rows).map((item) => item.type))).toEqual(new Set(["low_ctr", "striking_distance", "cannibalization"]));
  });
  it("weights aggregate position by impressions", () => {
    expect(summarizeSearchMetrics([
      { pageUrl: "a", query: "a", clicks: 10, impressions: 100, ctr: .1, position: 2, period: "current" },
      { pageUrl: "b", query: "b", clicks: 10, impressions: 300, ctr: .03, position: 10, period: "current" },
    ]).position).toBe(8);
  });
  it("compares query totals across all ranking pages", () => {
    const opportunities = buildSearchOpportunities([
      { pageUrl: "https://x/a", query: "sunrock group", clicks: 4, impressions: 10, ctr: .4, position: 2, period: "current" },
      { pageUrl: "https://x/b", query: "sunrock group", clicks: 1, impressions: 5, ctr: .2, position: 4, period: "current" },
      { pageUrl: "https://x/a", query: "sunrock group", clicks: 12, impressions: 20, ctr: .6, position: 2, period: "previous" },
      { pageUrl: "https://x/b", query: "sunrock group", clicks: 6, impressions: 10, ctr: .6, position: 4, period: "previous" },
    ]);
    expect(opportunities.find((item) => item.type === "decay")).toMatchObject({
      previousValue: "18 clicks",
      currentValue: "5 clicks",
      changeValue: "-72%",
    });
  });
});
