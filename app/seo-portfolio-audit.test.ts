import { describe, expect, it } from "vitest";
import { auditSeoPortfolio, type PortfolioSeoPost } from "./seo-portfolio-audit";

function post(overrides: Partial<PortfolioSeoPost>): PortfolioSeoPost {
  return {
    id: "1",
    title: "Guide to running shoes",
    seoTitle: "Guide to running shoes",
    seoDescription: "Learn how to choose running shoes for daily training.",
    focusKeyword: "running shoes",
    body: "<p>Original useful article content.</p>",
    blogHandle: "news",
    handle: "running-shoes",
    ...overrides,
  };
}

describe("SEO portfolio audit", () => {
  it("detects duplicate metadata and primary-topic cannibalization", () => {
    const result = auditSeoPortfolio([
      post({ id: "1" }),
      post({ id: "2", title: "Another shoe guide", handle: "shoe-guide-two" }),
    ]);
    const types = result.get("1")?.map((issue) => issue.type);
    expect(types).toContain("duplicate_seo_title");
    expect(types).toContain("duplicate_meta_description");
    expect(types).toContain("keyword_cannibalization");
  });

  it("detects orphan posts and respects contextual inbound links", () => {
    const result = auditSeoPortfolio([
      post({ id: "1", body: '<a href="/blogs/news/second-post">Read next</a>' }),
      post({ id: "2", title: "Second", seoTitle: "Second", seoDescription: "Unique second description", focusKeyword: "second topic", handle: "second-post" }),
    ]);
    expect(result.get("2")?.some((issue) => issue.type === "orphan_article")).toBe(false);
    expect(result.get("1")?.some((issue) => issue.type === "orphan_article")).toBe(true);
  });
});
