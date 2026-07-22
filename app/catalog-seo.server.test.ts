import { describe, expect, it, vi } from "vitest";
import { fetchShopifyCatalogResources } from "./catalog-seo.server";

describe("Shopify catalog SEO fetch", () => {
  it("normalizes product and collection GraphQL nodes", async () => {
    const admin = {
      graphql: vi.fn(async (query: string) => ({
        json: async () => query.includes("CatalogSeoProducts") ? {
          data: { products: { nodes: [{
            id: "gid://shopify/Product/1", title: "Ring", handle: "ring", descriptionHtml: "<p>Silver</p>", updatedAt: "2026-07-22T00:00:00Z", status: "ACTIVE",
            seo: { title: "Silver ring", description: "Ring description" }, featuredMedia: { preview: { image: { url: "https://cdn.shopify.com/ring.jpg", altText: "Ring", width: 1000, height: 1000 } } },
          }], pageInfo: { hasNextPage: false, endCursor: null } } },
        } : {
          data: { collections: { nodes: [{
            id: "gid://shopify/Collection/2", title: "Silver", handle: "silver", descriptionHtml: "<p>Collection</p>", updatedAt: "2026-07-22T00:00:00Z",
            seo: { title: null, description: null }, image: null, productsCount: { count: 4 },
          }], pageInfo: { hasNextPage: false, endCursor: null } } },
        },
      })),
    };

    const resources = await fetchShopifyCatalogResources(admin);

    expect(resources).toHaveLength(2);
    expect(resources.find((entry) => entry.type === "product")).toMatchObject({ title: "Ring", imageAlt: "Ring" });
    expect(resources.find((entry) => entry.type === "collection")).toMatchObject({ title: "Silver", itemCount: 4, imageUrl: "" });
  });
});
