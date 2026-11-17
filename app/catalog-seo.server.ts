import type { CatalogResourceInput, CatalogResourceType } from "./catalog-seo";

type FetchProgress = (type: CatalogResourceType, loaded: number) => Promise<void>;

/** Active products, published collections and published online-store pages. */
export async function fetchShopifyCatalogResources(admin: any, onPage?: FetchProgress) {
  const [products, collections, pages] = await Promise.all([
    fetchConnection(admin, "product", onPage),
    fetchConnection(admin, "collection", onPage),
    fetchConnection(admin, "page", onPage),
  ]);
  return [...products, ...collections, ...pages];
}

const CONNECTIONS: Record<CatalogResourceType, { key: string; normalize: (node: any) => CatalogResourceInput }> = {
  product: { key: "products", normalize: normalizeProduct },
  collection: { key: "collections", normalize: normalizeCollection },
  page: { key: "pages", normalize: normalizePage },
};

async function fetchConnection(admin: any, type: CatalogResourceType, onPage?: FetchProgress): Promise<CatalogResourceInput[]> {
  const { key, normalize } = CONNECTIONS[type];
  const query = type === "product" ? PRODUCT_QUERY : type === "collection" ? COLLECTION_QUERY : PAGE_QUERY;
  const resources: CatalogResourceInput[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const response = await admin.graphql(query, { variables: { cursor } });
    const payload: any = await response.json();
    if (payload.errors?.length) throw new Error(payload.errors.map((entry: any) => entry.message).join("; "));
    const connection = payload.data?.[key];
    if (!connection) throw new Error(`Shopify did not return the ${type} connection.`);
    for (const node of connection.nodes || []) resources.push(normalize(node));
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
    seoHidden: node.seoHidden?.value === "1",
  };
}

function normalizeCollection(node: any): CatalogResourceInput {
  const image = node.image || {};
  return {
    id: String(node.id || ""), type: "collection", title: String(node.title || ""), handle: String(node.handle || ""),
    descriptionHtml: String(node.descriptionHtml || ""), updatedAt: String(node.updatedAt || ""), status: "",
    seoTitle: String(node.seo?.title || ""), seoDescription: String(node.seo?.description || ""),
    imageUrl: String(image.url || ""), imageAlt: String(image.altText || ""), imageWidth: Number(image.width || 0), imageHeight: Number(image.height || 0), itemCount: Number(node.productsCount?.count || 0),
    seoHidden: node.seoHidden?.value === "1",
  };
}

function normalizePage(node: any): CatalogResourceInput {
  return {
    id: String(node.id || ""), type: "page", title: String(node.title || ""), handle: String(node.handle || ""),
    descriptionHtml: String(node.body || ""), updatedAt: String(node.updatedAt || ""), status: node.isPublished ? "ACTIVE" : "DRAFT",
    seoTitle: String(node.seoTitle?.value || ""), seoDescription: String(node.seoDescription?.value || ""),
    imageUrl: "", imageAlt: "", imageWidth: 0, imageHeight: 0, itemCount: 0,
    seoHidden: node.seoHidden?.value === "1",
  };
}

const PRODUCT_QUERY = `#graphql
  query CatalogSeoProducts($cursor: String) {
    products(first: 100, after: $cursor, query: "status:active", sortKey: UPDATED_AT) {
      nodes {
        id title handle descriptionHtml updatedAt status
        seo { title description }
        seoHidden: metafield(namespace: "seo", key: "hidden") { value }
        featuredMedia { preview { image { url altText width height } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// Unpublished collections are not on the storefront, so they cannot rank.
const COLLECTION_QUERY = `#graphql
  query CatalogSeoCollections($cursor: String) {
    collections(first: 100, after: $cursor, query: "published_status:published", sortKey: UPDATED_AT) {
      nodes {
        id title handle descriptionHtml updatedAt
        seo { title description }
        seoHidden: metafield(namespace: "seo", key: "hidden") { value }
        image { url altText width height }
        productsCount { count }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PAGE_QUERY = `#graphql
  query CatalogSeoPages($cursor: String) {
    pages(first: 100, after: $cursor, query: "published_status:published", sortKey: UPDATED_AT) {
      nodes {
        id title handle body updatedAt isPublished
        seoTitle: metafield(namespace: "global", key: "title_tag") { value }
        seoDescription: metafield(namespace: "global", key: "description_tag") { value }
        seoHidden: metafield(namespace: "seo", key: "hidden") { value }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
