import { describe, expect, it } from "vitest";
import { applyCatalogDuplicateIssues, auditCatalogResource, type CatalogResourceInput } from "./catalog-seo";

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
