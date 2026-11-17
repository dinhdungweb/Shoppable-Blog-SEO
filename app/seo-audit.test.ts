import { describe, expect, it } from "vitest";
import {
  HIDDEN_SCORE_CAP,
  analyzeImageSeo,
  analyzeTechnicalMarkup,
  auditContentQuality,
  auditSeo,
  containsPhrase,
  countPhrase,
  getSeoIssueArea,
  stripHtml,
  toStoredSeoIssues,
} from "./seo-audit";

const base = {
  title: "A useful guide to silver ring care",
  handle: "useful-guide",
  summary: "A practical description that explains what readers will learn from this useful guide to caring for rings.",
  body: "<h2>Introduction</h2><p>This guide gives readers practical, original advice based on experience.</p>",
  hasImage: true,
  imageAlt: "A useful illustration",
  productCount: 1,
};

const goodBody = [
  "<p>We tested twelve pairs over three months. The short answer: pick trail running shoes with a snug heel, a rock plate and 4mm lugs, then check the fit late in the day when feet are largest.</p>",
  "<h2>How we tested trail running shoes</h2>",
  `<p>${"Each pair covered rocky, muddy and dry routes so we could compare grip, cushioning and durability. ".repeat(10)}</p>`,
  "<h2>Fit</h2><h3>Heel lock</h3>",
  `<p>${"A secure heel prevents blisters on descents and keeps the foot stable on uneven ground. ".repeat(10)}</p>`,
  '<img src="https://cdn.shopify.com/trail-shoe-sole.jpg" alt="Trail shoe sole with deep lugs" width="1200" height="800">',
  '<p>See the <a href="https://example.org/study">gait study</a> and our <a href="/blogs/news/sock-guide">sock guide</a>.</p>',
].join("");

const goodPost = {
  title: "12 best trail running shoes we tested",
  handle: "best-trail-running-shoes",
  summary: "We tested 12 trail running shoes for grip, fit and durability so you can choose the right pair for rocky trails.",
  body: goodBody,
  hasImage: true,
  imageAlt: "Trail running shoes on a rock",
  imageWidth: 1200,
  imageHeight: 800,
  productCount: 2,
  authorName: "Lan",
  focusKeyword: "trail running shoes",
  shopDomain: "shop.myshopify.com",
};

describe("people-first SEO scoring", () => {
  it("does not impose a 600-word requirement", () => {
    const result = auditSeo(base);
    const lengthIssue = result.issues.find((issue) => issue.type === "content_length");
    expect(lengthIssue?.message).toContain("no preferred word count");
    expect(result.score).toBeGreaterThan(50);
  });

  it("scores a strong post highly and exposes an area breakdown", () => {
    const result = auditSeo(goodPost);
    expect(result.score).toBeGreaterThanOrEqual(95);
    expect(result.breakdown.search_appearance).toEqual({ score: 30, max: 30 });
    expect(Object.values(result.breakdown).reduce((sum, area) => sum + area.max, 0)).toBe(100);
  });

  it("treats a missing meta description as more serious than a missing focus keyword", () => {
    const noDescription = auditSeo({ ...goodPost, summary: "" });
    const noKeyword = auditSeo({ ...goodPost, focusKeyword: "" });
    expect(noDescription.issues.find((issue) => issue.type === "meta_description")?.severity).toBe("critical");
    expect(noKeyword.issues.find((issue) => issue.type === "kw_missing")?.severity).toBe("warning");
    expect(noDescription.score).toBeLessThan(noKeyword.score);
  });

  it("penalizes SEO titles that will be truncated", () => {
    const result = auditSeo({ ...goodPost, title: "12 best trail running shoes we tested on rocky and muddy mountain routes this year" });
    expect(result.issues.find((issue) => issue.type === "meta_title")?.severity).toBe("warning");
    expect(result.score).toBeLessThan(auditSeo(goodPost).score);
  });

  it("does not deduct points for advisory heuristics", () => {
    const result = auditSeo({ ...goodPost, title: "Best trail running shoes we tested", body: goodBody.replace(/<a href="https:\/\/example.org\/study">gait study<\/a>/, "gait study") });
    for (const type of ["title_number", "external_links", "kw_alt"]) {
      const issue = result.issues.find((item) => item.type === type);
      if (issue) expect(issue.severity === "good" || (issue.severity === "info" && !issue.points)).toBe(true);
    }
  });

  it("caps posts hidden from search engines", () => {
    const result = auditSeo({ ...goodPost, hiddenFromSearch: true });
    expect(result.score).toBe(HIDDEN_SCORE_CAP);
    expect(result.issues.find((issue) => issue.type === "hidden_from_search")?.severity).toBe("critical");
  });

  it("still reflects resolved issues when no focus keyword is configured", () => {
    const missingDimensions = auditSeo({ ...base, body: '<img src="https://cdn.shopify.com/silver-ring.jpg" alt="Silver ring">' });
    const fixedDimensions = auditSeo({ ...base, body: '<img src="https://cdn.shopify.com/silver-ring.jpg" alt="Silver ring" width="800" height="600">' });
    expect(fixedDimensions.score).toBeGreaterThan(missingDimensions.score);
  });

  it("identifies each paragraph over 120 words with a preview", () => {
    const longText = Array.from({ length: 125 }, (_, index) => `word${index + 1}`).join(" ");
    const result = auditSeo({ ...base, body: `<p>Short introduction.</p><p>${longText}</p>` });
    const issue = result.issues.find((item) => item.type === "paragraph_length");
    expect(issue).toMatchObject({
      severity: "warning",
      message: "1 paragraph is over 120 words.",
      details: [expect.objectContaining({ index: 2, wordCount: 125 })],
    });
    expect(issue?.details?.[0]?.preview).toContain("word1");
  });

  it("does not show a table-of-contents nag when the plan cannot use it", () => {
    const result = auditSeo({ ...goodPost, canUseTableOfContents: false });
    expect(result.issues.some((issue) => issue.type === "toc")).toBe(false);
  });
});

describe("keyword matching", () => {
  it("matches whole words only", () => {
    expect(containsPhrase("How to start a party", "art")).toBe(false);
    expect(containsPhrase("Modern art for small homes", "art")).toBe(true);
    expect(countPhrase("Trail running shoes. TRAIL   RUNNING shoes!", "trail running shoes")).toBe(2);
  });

  it("matches Vietnamese regardless of Unicode composition", () => {
    const keyword = "giày chạy địa hình";
    expect(containsPhrase(`Chọn ${keyword.normalize("NFD")} phù hợp`, keyword)).toBe(true);
    expect(containsPhrase("giày chạy địa hình", "chạy đ")).toBe(false);
  });

  it("does not credit substring keywords in the SEO title", () => {
    const result = auditSeo({ ...goodPost, title: "How to start a party at home", focusKeyword: "art" });
    expect(result.issues.find((issue) => issue.type === "kw_title")?.severity).toBe("critical");
  });

  it("finds a decomposed Vietnamese keyword in the body", () => {
    const keyword = "giày chạy địa hình";
    const result = auditSeo({ ...goodPost, title: `12 ${keyword} tốt nhất`, body: goodBody.replace(/trail running shoes/g, keyword.normalize("NFD")), focusKeyword: keyword });
    expect(result.issues.find((issue) => issue.type === "kw_content")?.severity).toBe("good");
  });
});

describe("stored issues", () => {
  it("keeps only actionable problems and maps them to SEO Audit categories", () => {
    const stored = toStoredSeoIssues(auditSeo({ ...goodPost, summary: "", imageAlt: "" }).issues);
    expect(stored.every((issue) => issue.severity === "warning" || issue.severity === "critical")).toBe(true);
    expect(stored.find((issue) => issue.type === "meta_description")?.category).toBe("on_page");
    expect(stored.find((issue) => issue.type === "featured_image_alt")?.category).toBe("image");
    expect(stored.every((issue) => issue.fix)).toBe(true);
  });

  it("assigns every issue type to a score area", () => {
    expect(getSeoIssueArea("kw_alt")).toBe("keywords");
    expect(getSeoIssueArea("featured_image_alt")).toBe("media");
    expect(getSeoIssueArea("meta_description")).toBe("search_appearance");
    expect(getSeoIssueArea("unsafe_links")).toBe("links");
    expect(getSeoIssueArea("eeat_author")).toBe("content");
  });
});

describe("HTML analysis", () => {
  it("ignores named anchors when looking for broken links", () => {
    expect(analyzeTechnicalMarkup('<a id="top"></a><a href="">x</a><a href="javascript:void(0)">y</a>').unsafeLinks).toBe(2);
  });

  it("decodes common entities and drops scripts", () => {
    expect(stripHtml("<p>Fish&nbsp;&amp;&nbsp;chips</p><script>var a=1</script>")).toBe("Fish & chips");
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
    expect(result.issues.find((issue) => issue.type === "images_missing_dimensions")).toMatchObject({ category: "image_seo", severity: "good" });
    expect(result.issues.find((issue) => issue.type === "uncrawlable_image_urls")).toMatchObject({ category: "image_seo", severity: "good" });
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
  });
});
