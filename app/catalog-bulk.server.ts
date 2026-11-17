import prisma from "./db.server";
import { auditCatalogResource, type CatalogResourceInput } from "./catalog-seo";
import { catalogTypeOf, clean, type CatalogBulkType } from "./catalog-bulk";
import { PRODUCT_FACTS_FIELDS, productFacts } from "./ai-catalog.server";
import { galleryAltCounts } from "./catalog-seo";

/** A product or collection as the bulk tool needs it. */
export type BulkCatalogNode = CatalogResourceInput & {
  type: CatalogBulkType;
  mediaId: string;
  vendor: string;
  productType: string;
  tags: string[];
  facts: string[];
};

const NODES_QUERY = `#graphql
  query CatalogBulkNodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id title handle descriptionHtml updatedAt status vendor productType tags
        seo { title description }
        featuredMedia { id preview { image { url altText width height } } }
        media(first: 10) { nodes { mediaContentType alt } }
        ${PRODUCT_FACTS_FIELDS}
      }
      ... on Collection {
        id title handle descriptionHtml updatedAt
        seo { title description }
        image { url altText width height }
        productsCount { count }
      }
    }
  }
`;

export async function fetchBulkCatalogNodes(admin: any, ids: string[]): Promise<BulkCatalogNode[]> {
  if (!ids.length) return [];
  const response = await admin.graphql(NODES_QUERY, { variables: { ids } });
  const payload: any = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors.map((entry: any) => entry.message).join("; "));
  return (payload.data?.nodes || []).filter((node: any) => node?.id).map(normalizeNode);
}

function normalizeNode(node: any): BulkCatalogNode {
  const type = catalogTypeOf(String(node.id));
  const image = type === "product" ? node.featuredMedia?.preview?.image || {} : node.image || {};
  return {
    id: String(node.id),
    type,
    title: clean(node.title),
    handle: String(node.handle || ""),
    descriptionHtml: String(node.descriptionHtml || ""),
    updatedAt: String(node.updatedAt || ""),
    status: String(node.status || ""),
    seoTitle: clean(node.seo?.title),
    seoDescription: clean(node.seo?.description),
    imageUrl: String(image.url || ""),
    imageAlt: clean(image.altText),
    imageWidth: Number(image.width || 0),
    imageHeight: Number(image.height || 0),
    itemCount: type === "collection" ? Number(node.productsCount?.count || 0) : 0,
    mediaId: type === "product" ? String(node.featuredMedia?.id || "") : "",
    vendor: clean(node.vendor),
    productType: clean(node.productType),
    tags: Array.isArray(node.tags) ? node.tags.map(String) : [],
    facts: type === "product" ? productFacts(node) : [],
    ...(type === "product" ? galleryAltCounts(node.media?.nodes) : {}),
  };
}

function userErrors(payload: any, key: string) {
  return [...(payload.errors || []), ...(payload.data?.[key]?.userErrors || [])].map((error: any) => error?.message).filter(Boolean).join("; ");
}

/** Writes custom SEO values; empty values return the listing to Shopify's automatic title/description. */
export async function setCatalogSeo(admin: any, node: { id: string; type: CatalogBulkType }, seoTitle: string, seoDescription: string) {
  const seo = { title: seoTitle || null, description: seoDescription || null };
  if (node.type === "product") {
    const response = await admin.graphql(`#graphql
      mutation CatalogBulkProductSeo($product: ProductUpdateInput!) { productUpdate(product: $product) { userErrors { field message } } }
    `, { variables: { product: { id: node.id, seo } } });
    return userErrors(await response.json(), "productUpdate");
  }
  const response = await admin.graphql(`#graphql
    mutation CatalogBulkCollectionSeo($input: CollectionInput!) { collectionUpdate(input: $input) { userErrors { field message } } }
  `, { variables: { input: { id: node.id, seo } } });
  return userErrors(await response.json(), "collectionUpdate");
}

/** Product featured media alt goes through fileUpdate; a collection image is part of the collection. */
export async function setCatalogImageAlt(admin: any, node: { id: string; type: CatalogBulkType; mediaId: string; imageUrl: string }, altText: string) {
  if (!node.imageUrl) return "";
  if (node.type === "product") {
    if (!node.mediaId) return "This product image cannot be edited from the app.";
    const response = await admin.graphql(`#graphql
      mutation CatalogBulkMediaAlt($files: [FileUpdateInput!]!) { fileUpdate(files: $files) { userErrors { field message } } }
    `, { variables: { files: [{ id: node.mediaId, alt: altText }] } });
    return userErrors(await response.json(), "fileUpdate");
  }
  const response = await admin.graphql(`#graphql
    mutation CatalogBulkCollectionImageAlt($input: CollectionInput!) { collectionUpdate(input: $input) { userErrors { field message } } }
  `, { variables: { input: { id: node.id, image: { src: node.imageUrl, altText } } } });
  return userErrors(await response.json(), "collectionUpdate");
}

/** Re-audits a resource after a bulk change so Catalog and SEO Audit reflect it immediately. */
export async function refreshCatalogAudit(shop: string, node: BulkCatalogNode, seoChanged: boolean) {
  const saved = await prisma.resourceSEO.findUnique({
    where: { shop_resourceType_resourceId: { shop, resourceType: node.type, resourceId: node.id } },
    select: { focusKeyword: true, issues: true },
  });
  const audit = auditCatalogResource({ ...node, focusKeyword: saved?.focusKeyword || "" });
  // Duplicate checks need the whole catalog: keep the scan's duplicate flags while the listing is unchanged; the next scan re-checks.
  const keptDuplicates = seoChanged ? [] : parseIssues(saved?.issues).filter((issue) => issue.type.startsWith("duplicate_") && !audit.issues.some((entry) => entry.type === issue.type));
  const issues = [...audit.issues, ...keptDuplicates];
  const data = {
    title: audit.title,
    handle: audit.handle,
    status: audit.status,
    seoScore: Math.max(0, audit.score - keptDuplicates.length * 10),
    metaTitle: audit.effectiveSeoTitle,
    metaDescription: audit.effectiveSeoDescription,
    imageUrl: audit.imageUrl,
    imageAlt: audit.imageAlt,
    issues: JSON.stringify(issues),
    issueCount: issues.length,
    contentHash: audit.contentHash,
    lastAnalyzedAt: new Date(),
  };
  await prisma.resourceSEO.upsert({
    where: { shop_resourceType_resourceId: { shop, resourceType: node.type, resourceId: node.id } },
    update: data,
    create: { shop, resourceType: node.type, resourceId: node.id, focusKeyword: "", sourceUpdatedAt: new Date(), ...data },
  });
}

function parseIssues(value: string | null | undefined): Array<{ type: string; [key: string]: unknown }> {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((issue) => issue && typeof issue.type === "string") : [];
  } catch {
    return [];
  }
}
