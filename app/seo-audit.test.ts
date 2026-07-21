import { describe, expect, it } from "vitest";
import { analyzeImageSeo, auditContentQuality, auditSeo } from "./seo-audit";

const base = {
  title: "A useful guide",
  handle: "useful-guide",
  summary: "A practical description that explains what readers will learn from this useful guide.",
  body: "<h2>Introduction</h2><p>This guide gives readers practical, original advice based on experience.</p>",
  hasImage: true,
  imageAlt: "A useful illustration",
  productCount: 1,
};

describe("people-first SEO scoring", () => {
  it("does not impose a 600-word requirement", () => {
    const result = auditSeo(base);
    const lengthIssue = result.issues.find((issue) => issue.type === "content_length");
    expect(lengthIssue?.message).toContain("no preferred word count");
    expect(result.score).toBeGreaterThan(50);
  });

  it("does not award a high score before keyword checks are configured", () => {
    const withoutKeyword = auditSeo(base);
    const issue = withoutKeyword.issues.find((item) => item.type === "kw_missing");
    expect(issue?.severity).toBe("warning");
    expect(withoutKeyword.score).toBeLessThanOrEqual(79);
  });

  it("still reflects resolved issues when no focus keyword is configured", () => {
    const missingDimensions = auditSeo({
      ...base,
      body: '<img src="https://cdn.shopify.com/silver-ring.jpg" alt="Silver ring">',
    });
    const fixedDimensions = auditSeo({
      ...base,
      body: '<img src="https://cdn.shopify.com/silver-ring.jpg" alt="Silver ring" width="800" height="600">',
    });
    expect(fixedDimensions.score).toBeGreaterThan(missingDimensions.score);
    expect(fixedDimensions.score).toBeLessThanOrEqual(79);
  });
});

describe("Shopify image SEO", () => {
  it("detects actionable inline image problems", () => {
    const stats = analyzeImageSeo([
      '<img src="https://cdn.shopify.com/silver-ring-closeup.jpg" width="100" height="100">',
      '<img src="https://cdn.shopify.com/img-1.png" alt="silver ring silver ring silver ring">',
      '<img src="data:image/png;base64,abc" role="presentation" alt="Divider">',
    ].join(""));
    expect(stats.missingAlt).toBe(1);
    expect(stats.missingDimensions).toBe(2);
    expect(stats.genericFilenames).toBe(1);
    expect(stats.stuffedAlt).toBe(1);
    expect(stats.decorativeWithAlt).toBe(1);
    expect(stats.tooSmall).toBe(1);
    expect(stats.uncrawlableSources).toBe(1);
  });

  it("keeps resolved image checks visible as passed items", () => {
    const result = auditSeo({
      ...base,
      body: '<p>Useful content</p><img src="https://cdn.shopify.com/silver-ring.jpg" alt="Silver ring" width="800" height="600">',
      imageWidth: 1200,
      imageHeight: 800,
    });
    const dimensions = result.issues.find((issue) => issue.type === "images_missing_dimensions");
    const crawlable = result.issues.find((issue) => issue.type === "uncrawlable_image_urls");
    expect(dimensions).toMatchObject({ category: "image_seo", severity: "good" });
    expect(crawlable).toMatchObject({ category: "image_seo", severity: "good" });
  });
});

describe("content quality and E-E-A-T checklist", () => {
  it("recognizes actionable authorship, citations and first-hand evidence", () => {
    const issues = auditContentQuality({
      body: '<p>We tested this product and measured the results.</p><a href="https://example.org/research">Research</a>',
      summary: "A detailed answer that explains what readers should choose, why it matters, and what the test results mean in practice.",
      authorName: "Jane Doe",
      publishedAt: "2026-01-01",
      updatedAt: "2026-02-01",
      productCount: 1,
      shopDomain: "shop.myshopify.com",
    });

    expect(issues.find((issue) => issue.type === "eeat_author")?.severity).toBe("good");
    expect(issues.find((issue) => issue.type === "eeat_sources")?.severity).toBe("good");
    expect(issues.find((issue) => issue.type === "eeat_experience")?.severity).toBe("good");
    expect(issues).toHaveLength(4);
  });

  it("flags missing authors and unclear introductions without guessing manual checks", () => {
    const issues = auditContentQuality({ body: "<p>Welcome.</p>", summary: "", authorName: "", productCount: 0 });

    expect(issues.find((issue) => issue.type === "eeat_author")?.severity).toBe("warning");
    expect(issues.find((issue) => issue.type === "eeat_direct_answer")?.severity).toBe("warning");
    expect(issues.every((issue) => ["eeat_author", "eeat_sources", "eeat_experience", "eeat_direct_answer"].includes(issue.type))).toBe(true);
  });
});
