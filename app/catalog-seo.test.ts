import { describe, expect, it } from "vitest";
import { applyCatalogDuplicateIssues, auditCatalogResource, galleryAltCounts, type CatalogResourceInput } from "./catalog-seo";

const base: CatalogResourceInput = {
  id: "gid://shopify/Product/1", type: "product", title: "Silver ring", handle: "silver-ring",
  descriptionHtml: `<h2>Silver ring details</h2><p>Silver ring ${"useful product details ".repeat(15)}</p><p>${"Materials sizing and care guidance ".repeat(10)} <a href="/collections/rings">Explore rings</a>.</p>`, updatedAt: "2026-07-22T00:00:00Z", status: "ACTIVE",
  seoTitle: "Silver ring for everyday wear", seoDescription: "Explore a handcrafted silver ring with practical sizing details, materials, care guidance and secure delivery from our Shopify store.",
  imageUrl: "https://cdn.shopify.com/ring.jpg", imageAlt: "Handcrafted silver ring", imageWidth: 1200, imageHeight: 1200, itemCount: 0,
  focusKeyword: "silver ring",
};

describe("catalog SEO audit", () => {
  it("scores complete Shopify products without false errors", () => {
    const audit = auditCatalogResource(base);
    expect(audit.issues).toEqual([]);
    expect(audit.score).toBe(100);
  });

  it("finds actionable collection issues", () => {
    const audit = auditCatalogResource({ ...base, id: "gid://shopify/Collection/2", type: "collection", descriptionHtml: "", seoDescription: "", imageAlt: "", itemCount: 0 });
    expect(audit.issues.map((entry) => entry.type)).toEqual(expect.arrayContaining(["missing_meta_description", "missing_description", "missing_image_alt", "empty_collection"]));
    expect(audit.score).toBeLessThan(70);
  });

  it("uses Shopify title and description fallbacks when custom SEO fields are blank", () => {
    const audit = auditCatalogResource({ ...base, seoTitle: "", seoDescription: "" });
    expect(audit.issues.some((entry) => entry.type === "missing_seo_title")).toBe(false);
    expect(audit.issues.some((entry) => entry.type === "missing_meta_description")).toBe(false);
  });

  it("adds duplicate metadata issues within a resource type", () => {
    const audits = [auditCatalogResource(base), auditCatalogResource({ ...base, id: "gid://shopify/Product/2", handle: "silver-ring-two" })];
    applyCatalogDuplicateIssues(audits);
    expect(audits.every((audit) => audit.issues.some((entry) => entry.type === "duplicate_seo_title"))).toBe(true);
  });
});

describe("catalog SEO scope", () => {
  it("audits online store pages without product image requirements", () => {
    const audit = auditCatalogResource({ ...base, id: "gid://shopify/Page/3", type: "page", imageUrl: "", imageAlt: "", focusKeyword: "" });
    expect(audit.issues.some((entry) => /image/.test(entry.type))).toBe(false);
  });

  it("caps resources hidden from search engines", () => {
    const audit = auditCatalogResource({ ...base, seoHidden: true });
    expect(audit.issues[0]?.type).toBe("hidden_from_search");
    expect(audit.score).toBe(20);
  });

  it("matches focus keywords as whole words", () => {
    const audit = auditCatalogResource({ ...base, focusKeyword: "ring", seoTitle: "Silver earrings for everyday wear", descriptionHtml: base.descriptionHtml.replace(/ring/gi, "earrings") });
    expect(audit.issues.map((entry) => entry.type)).toEqual(expect.arrayContaining(["keyword_missing_title", "keyword_missing_content"]));
  });
});

describe("catalog SEO audit: images, thin collections and duplicates", () => {
  it("flags gallery images without alt text", () => {
    const audit = auditCatalogResource({ ...base, galleryImageCount: 4, galleryMissingAlt: 3 });
    expect(audit.issues.find((entry) => entry.type === "gallery_images_missing_alt")?.label).toBe("3 more product images have no alt text");
    expect(audit.score).toBe(96);
  });

  it("counts gallery alt text after the featured image", () => {
    expect(galleryAltCounts([
      { mediaContentType: "IMAGE", alt: "" },
      { mediaContentType: "IMAGE", alt: "Side view" },
      { mediaContentType: "VIDEO", alt: "" },
      { mediaContentType: "IMAGE", alt: " " },
    ])).toEqual({ galleryImageCount: 2, galleryMissingAlt: 1 });
  });

  it("flags collections with only a few products", () => {
    const audit = auditCatalogResource({ ...base, id: "gid://shopify/Collection/2", type: "collection", itemCount: 2 });
    expect(audit.issues.map((entry) => entry.type)).toContain("thin_collection");
  });

  it("does not penalize products without links, and only advises collections", () => {
    const noLink = base.descriptionHtml.replace(/ <a [^>]*>Explore rings<\/a>/, "");
    expect(auditCatalogResource({ ...base, descriptionHtml: noLink }).issues.map((entry) => entry.type)).not.toContain("missing_internal_link");
    const collection = auditCatalogResource({ ...base, id: "gid://shopify/Collection/2", type: "collection", itemCount: 20, descriptionHtml: noLink });
    expect(collection.issues.map((entry) => entry.type)).toContain("missing_internal_link");
    expect(collection.score).toBe(100);
  });

  it("detects descriptions copied across products", () => {
    const audits = [
      auditCatalogResource(base),
      auditCatalogResource({ ...base, id: "gid://shopify/Product/2", title: "Gold ring", seoTitle: "Gold ring for everyday wear", seoDescription: "Another unique description for the gold ring with sizing details, materials, care guidance and delivery." }),
      auditCatalogResource({ ...base, id: "gid://shopify/Product/3", title: "Bracelet", seoTitle: "Silver bracelet", seoDescription: "Bracelet", descriptionHtml: "<p>Short and different.</p>" }),
    ];
    applyCatalogDuplicateIssues(audits);
    expect(audits[0].issues.map((entry) => entry.type)).toContain("duplicate_description");
    expect(audits[1].issues.map((entry) => entry.type)).toContain("duplicate_description");
    expect(audits[2].issues.map((entry) => entry.type)).not.toContain("duplicate_description");
  });
});
