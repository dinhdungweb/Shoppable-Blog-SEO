import { describe, expect, it } from "vitest";
import { analyzeInternalLinks, insertApprovedLink } from "./internal-linking";

const articles = [
  { id: "1", title: "Running Shoe Guide", handle: "running-shoes", blogHandle: "news", body: '<p>Read our shoe sizing advice.</p><a href="/blogs/news/shoe-sizing">Sizing</a>' },
  { id: "2", title: "Shoe Sizing Advice", handle: "shoe-sizing", blogHandle: "news", body: '<p>Choose the correct running shoe size.</p><a href="/products/deleted-shoe">Product</a>' },
  { id: "3", title: "Marathon Training Tips", handle: "marathon-training", blogHandle: "news", body: "<p>Training advice for runners.</p>" },
];

describe("internal linking assistant", () => {
  it("finds orphan content, broken links and related suggestions", () => {
    const report = analyzeInternalLinks(articles, ["active-shoe"]);
    expect(report.orphanArticles.map((article) => article.id)).toEqual(expect.arrayContaining(["1", "3"]));
    expect(report.brokenLinks).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: "2", kind: "product" })]));
    expect(report.suggestions.some((suggestion) => suggestion.sourceId === "2" && suggestion.targetId === "1")).toBe(true);
  });

  it("inserts an approved link into matching text without nesting anchors", () => {
    const result = insertApprovedLink("<p>See our Shoe Sizing Advice today.</p>", "Shoe Sizing Advice", "/blogs/news/shoe-sizing");
    expect(result.insertedInContext).toBe(true);
    expect(result.body).toContain('<a href="/blogs/news/shoe-sizing">Shoe Sizing Advice</a>');
  });

  it("does not report external blog URLs as broken internal links", () => {
    const report = analyzeInternalLinks([
      { id: "1", title: "Source", handle: "source", blogHandle: "news", body: '<a href="https://external.example/blogs/news/missing">Reference</a>' },
    ], [], ["shop.example"]);
    expect(report.brokenLinks).toHaveLength(0);
    expect(report.internalLinks).toBe(0);
  });
});
