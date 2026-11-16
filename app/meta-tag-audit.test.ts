import { describe, expect, it } from "vitest";
import { auditMetaTags } from "./meta-tag-audit";

const goodDescription = "A practical guide to choosing running shoes for trail and road, with fit tips and care advice.";

describe("auditMetaTags", () => {
  it("passes a well-formed article", () => {
    expect(auditMetaTags({
      articleTitle: "How to choose running shoes for trails",
      metaDescription: goodDescription,
      imageUrl: "https://cdn.shopify.com/a.jpg",
      imageAlt: "Trail running shoes on a rock",
    })).toEqual([]);
  });

  it("flags a missing description and missing featured alt", () => {
    expect(auditMetaTags({
      articleTitle: "How to choose running shoes for trails",
      imageUrl: "https://cdn.shopify.com/a.jpg",
      imageAlt: "  ",
    })).toEqual(["missing_description", "missing_featured_alt"]);
  });

  it("audits the effective title, falling back to the article title", () => {
    const longTitle = "x".repeat(61);
    expect(auditMetaTags({ articleTitle: longTitle, metaDescription: goodDescription })).toEqual(["title_too_long"]);
    expect(auditMetaTags({ articleTitle: longTitle, metaTitle: "A custom SEO title that fits well", metaDescription: goodDescription })).toEqual([]);
    expect(auditMetaTags({ articleTitle: "Short", metaDescription: goodDescription })).toEqual(["title_too_short"]);
  });

  it("flags description length bounds", () => {
    expect(auditMetaTags({ articleTitle: "How to choose running shoes for trails", metaDescription: "Too short." })).toEqual(["description_too_short"]);
    expect(auditMetaTags({ articleTitle: "How to choose running shoes for trails", metaDescription: "y".repeat(161) })).toEqual(["description_too_long"]);
  });

  it("does not require alt text without a featured image", () => {
    expect(auditMetaTags({ articleTitle: "How to choose running shoes for trails", metaDescription: goodDescription, imageAlt: "" })).toEqual([]);
  });
});
