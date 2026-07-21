import { describe, expect, it } from "vitest";
import { auditContentQuality, auditSeo } from "./seo-audit";

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
});

describe("content quality and E-E-A-T checklist", () => {
  it("recognizes author, freshness, citations and first-hand evidence", () => {
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
    expect(issues.find((issue) => issue.type === "eeat_dates")?.severity).toBe("info");
    expect(issues.find((issue) => issue.type === "eeat_dates")?.message).toContain("Shopify");
    expect(issues.find((issue) => issue.type === "eeat_sources")?.severity).toBe("good");
    expect(issues.find((issue) => issue.type === "eeat_experience")?.severity).toBe("good");
  });

  it("flags missing authors and unclear introductions without guessing manual checks", () => {
    const issues = auditContentQuality({ body: "<p>Welcome.</p>", summary: "", authorName: "", productCount: 0 });

    expect(issues.find((issue) => issue.type === "eeat_author")?.severity).toBe("warning");
    expect(issues.find((issue) => issue.type === "eeat_direct_answer")?.severity).toBe("warning");
    expect(issues.find((issue) => issue.type === "eeat_ai_disclosure")?.severity).toBe("info");
  });
});
