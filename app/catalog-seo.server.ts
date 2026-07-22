import type { CatalogResourceInput, CatalogResourceType } from "./catalog-seo";

export async function fetchShopifyCatalogResources(admin: any, onPage?: (type: CatalogResourceType, loaded: number) => Promise<void>) {
  const [products, collections] = await Promise.all([
    fetchConnection(admin, "product", onPage),
    fetchConnection(admin, "collection", onPage),
  ]);
  return [...products, ...collections];
}

async function fetchConnection(admin: any, type: CatalogResourceType, onPage?: (type: CatalogResourceType, loaded: number) => Promise<void>): Promise<CatalogResourceInput[]> {
  const resources: CatalogResourceInput[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const response = await admin.graphql(type === "product" ? PRODUCT_QUERY : COLLECTION_QUERY, { variables: { cursor } });
    const payload: any = await response.json();
    if (payload.errors?.length) throw new Error(payload.errors.map((entry: any) => entry.message).join("; "));
    const connection = type === "product" ? payload.data?.products : payload.data?.collections;
    if (!connection) throw new Error(`Shopify did not return the ${type} connection.`);
    for (const node of connection.nodes || []) resources.push(type === "product" ? normalizeProduct(node) : normalizeCollection(node));
    hasNextPage = Boolean(connection.pageInfo?.hasNextPage);
    cursor = connection.pageInfo?.endCursor || null;
    if (onPage) await onPage(type, resources.length);
    if (hasNextPage && !cursor) throw new Error(`Shopify ${type} pagination did not return a cursor.`);
  }
  return resources;
}

function normalizeProduct(node: any): CatalogResourceInput {
  const image = node.featuredMedia?.preview?.image || {};
  return {
    id: String(node.id || ""), type: "product", title: String(node.title || ""), handle: String(node.handle || ""),
    descriptionHtml: String(node.descriptionHtml || ""), updatedAt: String(node.updatedAt || ""), status: String(node.status || ""),
    seoTitle: String(node.seo?.title || ""), seoDescription: String(node.seo?.description || ""),
    imageUrl: String(image.url || ""), imageAlt: String(image.altText || ""), imageWidth: Number(image.width || 0), imageHeight: Number(image.height || 0), itemCount: 0,
  };
}

function normalizeCollection(node: any): CatalogResourceInput {
  const image = node.image || {};
  return {
    id: String(node.id || ""), type: "collection", title: String(node.title || ""), handle: String(node.handle || ""),
    descriptionHtml: String(node.descriptionHtml || ""), updatedAt: String(node.updatedAt || ""), status: "",
    seoTitle: String(node.seo?.title || ""), seoDescription: String(node.seo?.description || ""),
    imageUrl: String(image.url || ""), imageAlt: String(image.altText || ""), imageWidth: Number(image.width || 0), imageHeight: Number(image.height || 0), itemCount: Number(node.productsCount?.count || 0),
  };
}

const PRODUCT_QUERY = `#graphql
  query CatalogSeoProducts($cursor: String) {
    products(first: 100, after: $cursor, query: "status:active", sortKey: UPDATED_AT) {
      nodes {
        id title handle descriptionHtml updatedAt status
        seo { title description }
        featuredMedia { preview { image { url altText width height } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const COLLECTION_QUERY = `#graphql
  query CatalogSeoCollections($cursor: String) {
    collections(first: 100, after: $cursor, sortKey: UPDATED_AT) {
      nodes {
        id title handle descriptionHtml updatedAt
        seo { title description }
        image { url altText width height }
        productsCount { count }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
