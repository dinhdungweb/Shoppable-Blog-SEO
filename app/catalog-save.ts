/**
 * Builds the Shopify update for the product/collection editor from the values
 * loaded when the editor opened (`original`) and the submitted form.
 *
 * - Only fields the merchant changed are sent, so concurrent edits elsewhere
 *   (status, tags, vendor…) are not silently reverted.
 * - A changed handle creates a URL redirect from the old URL by default.
 * - SEO title/description equal to Shopify's automatic values are stored as
 *   empty, so search listings keep following the title and description.
 */

export type CatalogKind = "product" | "collection";

export type CatalogSnapshot = {
  title: string;
  handle: string;
  descriptionHtml: string;
  /** Raw custom SEO values from Shopify ("" when Shopify uses its fallback). */
  seoTitle: string;
  seoDescription: string;
  status: string;
  vendor: string;
  productType: string;
  tags: string;
  updatedAt: string;
};

export type CatalogSubmission = Omit<CatalogSnapshot, "updatedAt"> & {
  seoTitleAutomatic: boolean;
  seoDescriptionAutomatic: boolean;
  createRedirect: boolean;
};

const PRODUCT_STATUSES = new Set(["ACTIVE", "DRAFT", "ARCHIVED"]);
export const SEO_DESCRIPTION_FALLBACK_LENGTH = 165;

export function stripTags(html: string) {
  return String(html || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

function sameText(a: string, b: string) {
  return String(a || "").replace(/\s+/g, " ").trim().toLowerCase() === String(b || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function normalizeTags(value: string) {
  return [...new Set(String(value || "").split(",").map((tag) => tag.trim()).filter(Boolean))].slice(0, 250);
}

/** The custom SEO title to store: "" when it equals Shopify's automatic value (the title). */
export function customSeoTitle(value: string, title: string) {
  return sameText(value, title) ? "" : String(value || "").trim();
}

/** The custom meta description to store: "" when it equals Shopify's automatic value. */
export function customSeoDescription(value: string, descriptionHtml: string) {
  return sameText(value, stripTags(descriptionHtml).slice(0, SEO_DESCRIPTION_FALLBACK_LENGTH)) ? "" : String(value || "").trim();
}

export function buildCatalogUpdate(type: CatalogKind, original: CatalogSnapshot, submitted: CatalogSubmission) {
  const input: Record<string, unknown> = {};
  const changed: string[] = [];
  const set = (key: string, value: unknown) => {
    input[key] = value;
    changed.push(key);
  };

  if (submitted.title !== original.title) set("title", submitted.title);
  if (submitted.descriptionHtml !== original.descriptionHtml) set("descriptionHtml", submitted.descriptionHtml);
  if (submitted.handle && submitted.handle !== original.handle) {
    set("handle", submitted.handle);
    if (submitted.createRedirect) input.redirectNewHandle = true;
  }

  const seoTitle = submitted.seoTitleAutomatic ? "" : customSeoTitle(submitted.seoTitle, submitted.title);
  const seoDescription = submitted.seoDescriptionAutomatic ? "" : customSeoDescription(submitted.seoDescription, submitted.descriptionHtml);
  if (seoTitle !== original.seoTitle.trim() || seoDescription !== original.seoDescription.trim()) {
    set("seo", { title: seoTitle || null, description: seoDescription || null });
  }

  if (type === "product") {
    if (submitted.status !== original.status && PRODUCT_STATUSES.has(submitted.status)) set("status", submitted.status);
    if (submitted.vendor !== original.vendor) set("vendor", submitted.vendor);
    if (submitted.productType !== original.productType) set("productType", submitted.productType);
    const tags = normalizeTags(submitted.tags);
    if (tags.join("\u0000") !== normalizeTags(original.tags).join("\u0000")) set("tags", tags);
  }

  return { input, changed };
}

/** True when Shopify has a newer version than the one the editor opened. */
export function hasNewerVersion(openedUpdatedAt: string, currentUpdatedAt: string) {
  if (!openedUpdatedAt || !currentUpdatedAt) return false;
  return new Date(currentUpdatedAt).getTime() !== new Date(openedUpdatedAt).getTime();
}
