import { describe, expect, it } from "vitest";
import { buildContentRefreshQueries, normalizeRefreshPath } from "./content-refresh-context";

describe("content refresh context", () => {
  it("keeps metrics for the exact article path and compares periods", () => {
    const rows = [
      { pageUrl: "https://shop.example/blogs/news/bags?x=1", query: "travel bag", period: "current", clicks: 4, impressions: 200, ctr: 0.02, position: 8 },
      { pageUrl: "https://shop.example/blogs/news/bags/", query: "travel bag", period: "previous", clicks: 12, impressions: 180, ctr: 0.066, position: 6 },
      { pageUrl: "https://shop.example/blogs/news/other", query: "travel bag", period: "current", clicks: 50, impressions: 500, ctr: 0.1, position: 2 },
    ];
    const result = buildContentRefreshQueries(rows, "/blogs/news/bags");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ query: "travel bag", clicks: 4, previousClicks: 12, impressions: 200 });
  });

  it("normalizes absolute, relative, query, and trailing-slash URLs", () => {
    expect(normalizeRefreshPath("https://shop.example/Blogs/News/Bags/?a=1")).toBe("/blogs/news/bags");
    expect(normalizeRefreshPath("/blogs/news/bags/")).toBe("/blogs/news/bags");
  });
});
