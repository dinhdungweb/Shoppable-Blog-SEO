import { describe, expect, it } from "vitest";
import { bulkProblems, initialBulkValues, parseBulkPayload, parseCatalogIds, planBulkChange } from "./catalog-bulk";

const product = {
  title: "Handmade brushed silver ring",
  descriptionHtml: "<p>Handmade silver ring with a brushed finish, made to order in our studio.</p>",
  seoTitle: "",
  seoDescription: "",
  imageUrl: "https://cdn.shopify.com/ring.jpg",
  imageAlt: "",
};

describe("catalog bulk helpers", () => {
  it("maps issue types to fixable fields", () => {
    expect(bulkProblems(["missing_image_alt", "thin_description", "long_seo_title"])).toEqual(["seo_title", "image_alt"]);
  });

  it("only suggests values for fields with problems", () => {
    const values = initialBulkValues({ ...product, issueTypes: ["missing_image_alt"] });
    expect(values.seoTitle).toBe(product.title);
    expect(values.imageAlt).toBe(product.title);
    expect(planBulkChange(product, values)).toMatchObject({ seoChanged: false, altChanged: true });
  });

  it("stores automatic SEO values as empty and detects real changes", () => {
    expect(planBulkChange(product, { seoTitle: product.title, seoDescription: "", imageAlt: "" }).changed).toBe(false);
    const plan = planBulkChange(product, { seoTitle: "Brushed silver ring | Atelier", seoDescription: "", imageAlt: "" });
    expect(plan).toMatchObject({ seoChanged: true, seoTitle: "Brushed silver ring | Atelier", seoDescription: "" });
  });

  it("ignores alt text for resources without an image", () => {
    expect(planBulkChange({ ...product, imageUrl: "" }, { seoTitle: product.title, seoDescription: "", imageAlt: "Ring" }).changed).toBe(false);
  });

  it("validates ids and payloads", () => {
    expect(parseCatalogIds("gid://shopify/Product/1, gid://shopify/Article/2,gid://shopify/Collection/3,gid://shopify/Product/1"))
      .toEqual(["gid://shopify/Product/1", "gid://shopify/Collection/3"]);
    expect(parseBulkPayload(JSON.stringify([{ id: "gid://shopify/Product/1", seoTitle: "x".repeat(71), seoDescription: "", imageAlt: "" }]))).toBeNull();
    expect(parseBulkPayload("not json")).toBeNull();
    expect(parseBulkPayload(JSON.stringify([{ id: "gid://shopify/Product/1", seoTitle: " A  ring ", seoDescription: "", imageAlt: "" }])))
      .toEqual([{ id: "gid://shopify/Product/1", seoTitle: "A ring", seoDescription: "", imageAlt: "" }]);
  });
});
