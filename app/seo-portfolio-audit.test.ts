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
      post({ id: "2", handle: "shoe-guide-two" }),
    ]);
    const types = result.get("1")?.map((issue) => issue.type);
    expect(types).toContain("duplicate_seo_title");
    expect(types).toContain("duplicate_article_title");
    expect(types).toContain("duplicate_meta_description");
    expect(types).toContain("keyword_cannibalization");
  });

  it("detects overlapping search intent without matching focus keywords", () => {
    const result = auditSeoPortfolio([
      post({ id: "1", title: "Running shoes selection guide", seoTitle: "Running shoes selection guide", focusKeyword: "running shoe guide" }),
      post({ id: "2", title: "Running shoes buying guide", seoTitle: "Running shoes buying guide", focusKeyword: "best shoes for runners", handle: "best-running-shoes" }),
    ]);

    expect(result.get("1")?.some((issue) => issue.type === "search_intent_overlap")).toBe(true);
    expect(result.get("2")?.find((issue) => issue.type === "search_intent_overlap")?.fix).toContain("Shopify URL redirect");
  });

  it("checks near-duplicate content for libraries larger than 300 posts", () => {
    const duplicateBody = `<p>${Array.from({ length: 45 }, (_, index) => `sharedtopic${index}`).join(" ")}</p>`;
    const posts = [
      post({ id: "duplicate-1", title: "First unique title", seoTitle: "First unique title", focusKeyword: "first topic", body: duplicateBody }),
      post({ id: "duplicate-2", title: "Second unique title", seoTitle: "Second unique title", focusKeyword: "second topic", body: duplicateBody }),
      ...Array.from({ length: 300 }, (_, index) => post({
        id: `filler-${index}`,
        title: `Subject fillerword${index}`,
        seoTitle: `Topic uniqueword${index}`,
        seoDescription: `A unique description for unrelated subject ${index}.`,
        focusKeyword: `separate topic ${index}`,
        handle: `unrelated-${index}`,
        body: `<p>independent${index} standalone${index} exclusive${index} material${index}</p>`,
      })),
    ];

    const result = auditSeoPortfolio(posts);
    expect(result.get("duplicate-1")?.some((issue) => issue.type === "near_duplicate_content")).toBe(true);
  });

  it("detects orphan posts and respects contextual inbound links", () => {
    const result = auditSeoPortfolio([
      post({ id: "1", body: '<a href="https://example.com/blogs/news/second-post?utm_source=blog">Read next</a>' }),
      post({ id: "2", title: "Second", seoTitle: "Second", seoDescription: "Unique second description", focusKeyword: "second topic", handle: "second-post" }),
    ]);
    expect(result.get("2")?.some((issue) => issue.type === "orphan_article")).toBe(false);
    expect(result.get("1")?.some((issue) => issue.type === "orphan_article")).toBe(true);
  });
});
