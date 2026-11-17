import { describe, expect, it } from "vitest";
import { buildCatalogUpdate, hasNewerVersion, type CatalogSnapshot, type CatalogSubmission } from "./catalog-save";

const original: CatalogSnapshot = {
  title: "Silver ring",
  handle: "silver-ring",
  descriptionHtml: "<p>Handmade silver ring with a brushed finish.</p>",
  seoTitle: "",
  seoDescription: "",
  status: "DRAFT",
  vendor: "Atelier",
  productType: "Rings",
  tags: "silver, handmade",
  updatedAt: "2026-11-10T00:00:00Z",
};

function submit(overrides: Partial<CatalogSubmission> = {}): CatalogSubmission {
  return {
    ...original,
    seoTitle: original.title,
    seoDescription: "Handmade silver ring with a brushed finish.",
    seoTitleAutomatic: true,
    seoDescriptionAutomatic: true,
    createRedirect: true,
    ...overrides,
  };
}

describe("buildCatalogUpdate", () => {
  it("sends nothing when nothing changed, even with automatic SEO values shown", () => {
    expect(buildCatalogUpdate("product", original, submit()).changed).toEqual([]);
  });

  it("never re-sends status, vendor or tags the merchant did not touch", () => {
    const { input, changed } = buildCatalogUpdate("product", original, submit({ title: "Silver ring, brushed" }));
    expect(changed).toEqual(["title"]);
    expect(input).not.toHaveProperty("status");
    expect(input).not.toHaveProperty("tags");
  });

  it("creates a redirect when the handle changes", () => {
    expect(buildCatalogUpdate("collection", original, submit({ handle: "silver-rings" })).input).toMatchObject({ handle: "silver-rings", redirectNewHandle: true });
    expect(buildCatalogUpdate("collection", original, submit({ handle: "silver-rings", createRedirect: false })).input).not.toHaveProperty("redirectNewHandle");
  });

  it("stores custom SEO values but clears values equal to Shopify's fallback", () => {
    expect(buildCatalogUpdate("product", original, submit({ seoTitle: "Brushed silver ring | Atelier", seoTitleAutomatic: false })).input.seo)
      .toEqual({ title: "Brushed silver ring | Atelier", description: null });
    const custom = { ...original, seoTitle: "Old custom title" };
    expect(buildCatalogUpdate("product", custom, submit({ seoTitle: "Silver ring", seoTitleAutomatic: false })).input.seo)
      .toEqual({ title: null, description: null });
  });

  it("compares tags as a set and validates status", () => {
    expect(buildCatalogUpdate("product", original, submit({ tags: " handmade , silver,silver" })).changed).toEqual(["tags"]);
    expect(buildCatalogUpdate("product", original, submit({ status: "PUBLISHED" })).changed).toEqual([]);
    expect(buildCatalogUpdate("product", original, submit({ status: "ACTIVE" })).input.status).toBe("ACTIVE");
  });
});

describe("hasNewerVersion", () => {
  it("detects edits made after the editor opened", () => {
    expect(hasNewerVersion("2026-11-10T00:00:00Z", "2026-11-10T00:00:00.000Z")).toBe(false);
    expect(hasNewerVersion("2026-11-10T00:00:00Z", "2026-11-11T08:00:00Z")).toBe(true);
    expect(hasNewerVersion("", "2026-11-11T08:00:00Z")).toBe(false);
  });
});
