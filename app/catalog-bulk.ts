/**
 * Bulk search-listing optimization for products and collections: SEO title,
 * meta description and featured image alt. Pure helpers shared by the picker,
 * the review page and its action.
 */
import { SEO_DESCRIPTION_FALLBACK_LENGTH, customSeoDescription, customSeoTitle, stripTags } from "./catalog-save";

export type CatalogBulkType = "product" | "collection";
export type CatalogBulkFilter = "attention" | "all" | "seo_title" | "meta_description" | "image_alt";

export const MAX_CATALOG_BULK = 50;

/** Issue types the bulk tool can fix, grouped by field. */
export const CATALOG_BULK_ISSUES: Record<Exclude<CatalogBulkFilter, "attention" | "all">, { label: string; types: string[] }> = {
  seo_title: {
    label: "SEO title",
    types: ["missing_seo_title", "long_seo_title", "short_seo_title", "title_word_count", "title_all_caps", "title_repeated_words", "duplicate_seo_title", "keyword_missing_title"],
  },
  meta_description: {
    label: "Meta description",
    types: ["missing_meta_description", "short_meta_description", "long_meta_description", "duplicate_meta_description", "keyword_missing_description"],
  },
  image_alt: {
    label: "Image alt text",
    types: ["missing_image_alt", "long_image_alt", "keyword_missing_image_alt"],
  },
};

export const CATALOG_BULK_ISSUE_TYPES = new Set(Object.values(CATALOG_BULK_ISSUES).flatMap((group) => group.types));

/** Which bulk-fixable fields a resource has problems with. */
export function bulkProblems(issueTypes: string[]) {
  return (Object.keys(CATALOG_BULK_ISSUES) as Array<keyof typeof CATALOG_BULK_ISSUES>)
    .filter((key) => issueTypes.some((type) => CATALOG_BULK_ISSUES[key].types.includes(type)));
}

export function clean(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function suggestSeoTitle(title: string) {
  const value = clean(title);
  return value.length <= 60 ? value : `${value.slice(0, 57).replace(/[\s,:;|-]+$/g, "")}…`;
}

export function suggestSeoDescription(descriptionHtml: string, title: string) {
  const source = clean(stripTags(descriptionHtml)) || clean(title);
  if (source.length <= 155) return source;
  const shortened = source.slice(0, 155);
  const boundary = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, boundary > 110 ? boundary : 152).replace(/[\s,;:-]+$/g, "")}…`;
}

export function suggestImageAlt(title: string) {
  return clean(title).slice(0, 125);
}

export type BulkRowSource = {
  title: string;
  descriptionHtml: string;
  /** Raw custom values ("" = Shopify's automatic value). */
  seoTitle: string;
  seoDescription: string;
  imageUrl: string;
  imageAlt: string;
  issueTypes: string[];
};

/**
 * Starting values for the review table. Fields without a problem show what
 * Shopify displays today; fields with a problem get a conservative suggestion.
 */
export function initialBulkValues(row: BulkRowSource) {
  const problems = new Set(bulkProblems(row.issueTypes));
  const shownTitle = row.seoTitle || clean(row.title);
  const shownDescription = row.seoDescription || stripTags(row.descriptionHtml).slice(0, SEO_DESCRIPTION_FALLBACK_LENGTH).trim();
  return {
    seoTitle: problems.has("seo_title") && (!row.seoTitle || shownTitle.length > 70) ? suggestSeoTitle(shownTitle) : shownTitle,
    seoDescription: problems.has("meta_description") && (!shownDescription || shownDescription.length > 165) ? suggestSeoDescription(row.descriptionHtml, row.title) : shownDescription,
    imageAlt: row.imageUrl && problems.has("image_alt") && !row.imageAlt ? suggestImageAlt(row.title) : row.imageAlt,
  };
}

export type BulkCurrent = { title: string; descriptionHtml: string; seoTitle: string; seoDescription: string; imageUrl: string; imageAlt: string };
export type BulkEdit = { seoTitle: string; seoDescription: string; imageAlt: string };

/**
 * What to write for one resource. SEO values equal to Shopify's automatic
 * values are stored as empty so listings keep following the title/description.
 */
export function planBulkChange(current: BulkCurrent, edit: BulkEdit) {
  const seoTitle = customSeoTitle(clean(edit.seoTitle), current.title);
  const seoDescription = customSeoDescription(clean(edit.seoDescription), current.descriptionHtml);
  const seoChanged = seoTitle !== clean(current.seoTitle) || seoDescription !== clean(current.seoDescription);
  const imageAlt = clean(edit.imageAlt);
  const altChanged = Boolean(current.imageUrl) && imageAlt !== clean(current.imageAlt);
  return { seoTitle, seoDescription, seoChanged, imageAlt, altChanged, changed: seoChanged || altChanged };
}

const ID_PATTERN = /^gid:\/\/shopify\/(Product|Collection)\/\d+$/;

export function parseCatalogIds(value: string) {
  return [...new Set(String(value || "").split(",").map((id) => id.trim()).filter((id) => ID_PATTERN.test(id)))].slice(0, MAX_CATALOG_BULK);
}

export function catalogTypeOf(id: string): CatalogBulkType {
  return id.includes("/Collection/") ? "collection" : "product";
}

export type BulkPayloadItem = { id: string } & BulkEdit;

export function parseBulkPayload(value: string): BulkPayloadItem[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > MAX_CATALOG_BULK) return null;
  const items: BulkPayloadItem[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !ID_PATTERN.test(item.id)) return null;
    if (typeof item.seoTitle !== "string" || item.seoTitle.length > 70) return null;
    if (typeof item.seoDescription !== "string" || item.seoDescription.length > 320) return null;
    if (typeof item.imageAlt !== "string" || item.imageAlt.length > 512) return null;
    items.push({ id: item.id, seoTitle: clean(item.seoTitle), seoDescription: clean(item.seoDescription), imageAlt: clean(item.imageAlt) });
  }
  return items;
}
