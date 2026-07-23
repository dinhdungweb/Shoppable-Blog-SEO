import { describe, expect, it } from "vitest";
import { applyInlineAltChanges, hashArticleBody, scanArticleImages, validateProposedAlt } from "./image-seo";

const article = {
  id: "gid://shopify/Article/1",
  title: "Travel bag guide",
  summary: "How to choose a carry-on bag.",
  featuredImageUrl: "https://cdn.shopify.com/featured.jpg",
  featuredImageAlt: "",
  body: [
    "<p>Compare the bag from the side.</p>",
    '<img src="https://cdn.shopify.com/side.jpg" width="800" height="600">',
    "<p>Choose a size that fits the trip.</p>",
    '<img src="https://cdn.shopify.com/divider.png" role="presentation" alt="Decorative divider">',
    '<img src="https://cdn.shopify.com/stuffed.jpg" alt="travel bag travel bag travel bag for trips">',
  ].join(""),
};

describe("bulk image SEO scanner", () => {
  it("finds featured, missing, decorative and stuffed alt issues with context", () => {
    const rows = scanArticleImages(article);
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.issues)).toEqual([
      ["missing_alt"],
      ["missing_alt"],
      ["decorative_alt"],
      ["stuffed_alt"],
    ]);
    expect(rows[1].context).toContain("Compare the bag from the side");
  });

  it("changes only reviewed alt attributes and preserves every other image attribute", () => {
    const rows = scanArticleImages(article);
    const next = applyInlineAltChanges(article.body, rows[1].bodyHash, [
      { id: rows[1].id, index: rows[1].index, src: rows[1].src, beforeAlt: "", afterAlt: "Black carry-on travel bag viewed from the side", decorative: false },
      { id: rows[2].id, index: rows[2].index, src: rows[2].src, beforeAlt: "Decorative divider", afterAlt: "", decorative: true },
    ]);
    expect(next).toContain('<img src="https://cdn.shopify.com/side.jpg" width="800" height="600" alt="Black carry-on travel bag viewed from the side">');
    expect(next).toContain('<img src="https://cdn.shopify.com/divider.png" role="presentation" alt="">');
    expect(next).toContain('src="https://cdn.shopify.com/stuffed.jpg"');
  });

  it("stops when the article body or image state changed", () => {
    const row = scanArticleImages(article)[1];
    expect(() => applyInlineAltChanges(`${article.body}<p>New edit</p>`, row.bodyHash, [{
      id: row.id, index: row.index, src: row.src, beforeAlt: "", afterAlt: "Travel bag", decorative: false,
    }])).toThrow("article body changed");
    expect(hashArticleBody(article.body)).toBe(row.bodyHash);
  });

  it("requires useful natural alt text and keeps decorative alt empty", () => {
    expect(validateProposedAlt("Black carry-on travel bag", false)).toBe("Black carry-on travel bag");
    expect(validateProposedAlt("", true)).toBe("");
    expect(() => validateProposedAlt("", false)).toThrow("require alt");
    expect(() => validateProposedAlt("bag bag bag bag bag", false)).toThrow("repeats");
    expect(() => validateProposedAlt("Divider", true)).toThrow("empty alt");
  });

  it("does not overwrite an explicit empty inline alt without decorative evidence", () => {
    expect(scanArticleImages({
      ...article,
      featuredImageUrl: "",
      body: '<p>Section break</p><img src="https://cdn.shopify.com/divider.png" alt="">',
    })).toEqual([]);
  });
});
