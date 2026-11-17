import { describe, expect, it, vi } from "vitest";
import { fetchShopifyCatalogResources } from "./catalog-seo.server";

describe("Shopify catalog SEO fetch", () => {
  it("normalizes product, collection and page GraphQL nodes", async () => {
    const admin = {
      graphql: vi.fn(async (query: string) => ({
        json: async () => {
          if (query.includes("CatalogSeoProducts")) return {
            data: { products: { nodes: [{
              id: "gid://shopify/Product/1", title: "Ring", handle: "ring", descriptionHtml: "<p>Silver</p>", updatedAt: "2026-07-22T00:00:00Z", status: "ACTIVE",
              seo: { title: "Silver ring", description: "Ring description" }, seoHidden: { value: "1" },
              featuredMedia: { preview: { image: { url: "https://cdn.shopify.com/ring.jpg", altText: "Ring", width: 1000, height: 1000 } } },
            }], pageInfo: { hasNextPage: false, endCursor: null } } },
          };
          if (query.includes("CatalogSeoPages")) return {
            data: { pages: { nodes: [{
              id: "gid://shopify/Page/3", title: "About us", handle: "about", body: "<p>Our story</p>", updatedAt: "2026-07-22T00:00:00Z", isPublished: true,
              seoTitle: { value: "About Silver Co" }, seoDescription: null, seoHidden: null,
            }], pageInfo: { hasNextPage: false, endCursor: null } } },
          };
          return {
            data: { collections: { nodes: [{
              id: "gid://shopify/Collection/2", title: "Silver", handle: "silver", descriptionHtml: "<p>Collection</p>", updatedAt: "2026-07-22T00:00:00Z",
              seo: { title: null, description: null }, image: null, productsCount: { count: 4 },
            }], pageInfo: { hasNextPage: false, endCursor: null } } },
          };
        },
      })),
    };

    const resources = await fetchShopifyCatalogResources(admin);

    expect(resources).toHaveLength(3);
    expect(resources.find((entry) => entry.type === "product")).toMatchObject({ title: "Ring", imageAlt: "Ring", seoHidden: true });
    expect(resources.find((entry) => entry.type === "collection")).toMatchObject({ title: "Silver", itemCount: 4, imageUrl: "", seoHidden: false });
    expect(resources.find((entry) => entry.type === "page")).toMatchObject({ title: "About us", seoTitle: "About Silver Co", descriptionHtml: "<p>Our story</p>", status: "ACTIVE" });
    expect(admin.graphql.mock.calls.some(([query]) => query.includes('published_status:published'))).toBe(true);
  });
});
