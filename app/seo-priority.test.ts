import { describe, expect, it } from "vitest";
import { articleSearchPath, buildImpressionsByPath, formatImpressions, issuePriority, normalizeSearchPagePath } from "./seo-priority";

describe("search-weighted SEO priority", () => {
  it("normalizes Search Console URLs to article paths", () => {
    expect(normalizeSearchPagePath("https://shop.com/blogs/news/Trail-Shoes/")).toBe("/blogs/news/trail-shoes");
    expect(normalizeSearchPagePath("https://shop.com/fr-ca/blogs/news/trail-shoes?utm=1")).toBe("/blogs/news/trail-shoes");
    expect(normalizeSearchPagePath("https://shop.com/blogs/tin-tuc/gi%C3%A0y")).toBe("/blogs/tin-tuc/giày");
    expect(articleSearchPath("news", "Trail-Shoes")).toBe("/blogs/news/trail-shoes");
  });

  it("sums query rows per page", () => {
    const totals = buildImpressionsByPath([
      { pageUrl: "https://shop.com/blogs/news/a", impressions: 100 },
      { pageUrl: "https://shop.com/en/blogs/news/a/", impressions: 50 },
      { pageUrl: "https://shop.com/blogs/news/b", impressions: 7 },
    ]);
    expect(totals.get("/blogs/news/a")).toBe(150);
    expect(totals.get("/blogs/news/b")).toBe(7);
  });

  it("ranks a medium issue on a busy page above a high issue nobody sees", () => {
    expect(issuePriority("Medium", 10_000)).toBeGreaterThan(issuePriority("High", 0));
    expect(issuePriority("High", 100)).toBeGreaterThan(issuePriority("Medium", 100));
  });

  it("formats impressions compactly", () => {
    expect(formatImpressions(0)).toBe("—");
    expect(formatImpressions(950)).toBe("950");
    expect(formatImpressions(12_340)).toBe("12.3k");
    expect(formatImpressions(2_000_000)).toBe("2M");
  });
});
