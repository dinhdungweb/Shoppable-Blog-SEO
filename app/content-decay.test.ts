import { describe, expect, it } from "vitest";
import { analyzeContentDecay } from "./content-decay";

const article = {
  id: "gid://shopify/Article/1",
  title: "Best silver rings 2024",
  handle: "silver-rings",
  blogHandle: "news",
  updatedAt: "2024-01-01",
  publishedAt: "2024-01-01",
  body: "<p>Guide</p>",
};

describe("content decay analysis", () => {
  it("detects traffic, CTR, freshness, year, product and outbound decay", () => {
    const report = analyzeContentDecay({
      articles: [article],
      now: new Date("2026-07-21T00:00:00Z"),
      metrics: [
        { pageUrl: "https://shop.example/blogs/news/silver-rings", period: "previous", clicks: 20, impressions: 200, ctr: 0.1 },
        { pageUrl: "https://shop.example/blogs/news/silver-rings/", period: "current", clicks: 5, impressions: 200, ctr: 0.025 },
      ],
      products: [{ articleId: article.id, productId: "gid://shopify/Product/1", productTitle: "Silver ring", exists: true, available: false }],
      brokenOutboundByArticle: new Map([[article.id, ["https://example.com/missing"]]]),
      externalLinksChecked: 1,
    });
    expect(new Set(report.issues.map((issue) => issue.type))).toEqual(new Set(["traffic_decline", "ctr_decline", "stale_content", "outdated_year", "unavailable_product", "broken_outbound"]));
    expect(report.externalLinksChecked).toBe(1);
    expect(report.inventoryDataAvailable).toBe(true);
  });

  it("does not flag healthy recent content", () => {
    const report = analyzeContentDecay({
      articles: [{ ...article, title: "Silver rings", updatedAt: "2026-07-01" }],
      now: new Date("2026-07-21T00:00:00Z"),
      metrics: [],
      products: [],
      schemaEnabled: true,
    });
    expect(report.issues).toHaveLength(0);
    expect(report.searchDataAvailable).toBe(false);
  });

  it("detects an empty Shopify product block after product removal", () => {
    const report = analyzeContentDecay({
      articles: [{ ...article, title: "Silver rings", updatedAt: "2026-07-01", body: "[[SBS_PRODUCTS]]" }],
      now: new Date("2026-07-21T00:00:00Z"),
      metrics: [],
      products: [],
    });
    expect(report.issues).toEqual([expect.objectContaining({ type: "unavailable_product", message: "Product block has no active products" })]);
  });
});
