import crypto from "node:crypto";

export type CatalogResourceType = "product" | "collection";

export type CatalogResourceInput = {
  id: string;
  type: CatalogResourceType;
  title: string;
  handle: string;
  descriptionHtml: string;
  updatedAt: string;
  status: string;
  seoTitle: string;
  seoDescription: string;
  imageUrl: string;
  imageAlt: string;
  imageWidth: number;
  imageHeight: number;
  itemCount: number;
};

export type CatalogSeoIssue = {
  type: string;
  label: string;
  message: string;
  impact: "High" | "Medium" | "Low";
  effort: "Medium" | "Low";
  fix: string;
};

export type CatalogSeoAudit = CatalogResourceInput & {
  score: number;
  issues: CatalogSeoIssue[];
  effectiveSeoTitle: string;
  effectiveSeoDescription: string;
  contentHash: string;
};

export function auditCatalogResource(resource: CatalogResourceInput): CatalogSeoAudit {
  const issues: CatalogSeoIssue[] = [];
  const text = stripHtml(resource.descriptionHtml);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const seoTitle = resource.seoTitle.trim() || resource.title.trim();
  // Shopify uses the resource description as the search-description fallback when no custom SEO value is saved.
  const seoDescription = resource.seoDescription.trim() || text.slice(0, 160).trim();
  let score = 100;
  const add = (penalty: number, issue: CatalogSeoIssue) => { score -= penalty; issues.push(issue); };

  if (!seoTitle) add(20, issue("missing_seo_title", "Missing SEO title", "High", "Low", "Add a unique search title in Shopify search engine listing."));
  else if (seoTitle.length > 70) add(7, issue("long_seo_title", "SEO title is too long", "Medium", "Low", "Shorten the search title to 70 characters or fewer."));
  else if (seoTitle.length < 20) add(4, issue("short_seo_title", "SEO title is very short", "Low", "Low", "Make the search title more descriptive without keyword stuffing."));

  if (!seoDescription) add(18, issue("missing_meta_description", "Missing meta description", "High", "Low", "Add a unique description in Shopify search engine listing."));
  else if (seoDescription.length < 70) add(6, issue("short_meta_description", "Meta description is too short", "Medium", "Low", "Expand it with the main benefit and search intent."));
  else if (seoDescription.length > 165) add(5, issue("long_meta_description", "Meta description is too long", "Low", "Low", "Keep it at 165 characters or fewer."));

  const minimumWords = resource.type === "product" ? 40 : 30;
  if (!text) add(15, issue("missing_description", `Missing ${resource.type} description`, "High", "Medium", `Add useful, original ${resource.type} content in Shopify.`));
  else if (wordCount < minimumWords) add(7, issue("thin_description", "Thin description", "Medium", "Medium", `Expand the ${resource.type} description with useful shopper information.`));

  if (!resource.handle.trim()) add(8, issue("missing_handle", "Missing URL handle", "High", "Low", "Add a short descriptive Shopify URL handle."));
  else if (resource.handle.length > 80) add(3, issue("long_handle", "URL handle is too long", "Low", "Low", "Shorten the handle while preserving the primary topic."));

  if (!resource.imageUrl) add(8, issue("missing_featured_image", `Missing ${resource.type} image`, "Medium", "Medium", `Add a representative image to this ${resource.type}.`));
  else {
    if (!resource.imageAlt.trim()) add(6, issue("missing_image_alt", "Image alt text is missing", "Medium", "Low", "Add concise descriptive alt text in Shopify."));
    if ((resource.imageWidth > 0 && resource.imageWidth < 600) || (resource.imageHeight > 0 && resource.imageHeight < 600)) {
      add(3, issue("small_image", "Image may be too small", "Low", "Medium", "Use a higher-resolution Shopify image where appropriate."));
    }
  }

  if (resource.type === "collection" && resource.itemCount === 0) {
    add(12, issue("empty_collection", "Collection has no products", "High", "Medium", "Add relevant products or remove the empty collection from storefront navigation."));
  }

  return {
    ...resource,
    score: Math.max(0, Math.min(100, score)),
    issues,
    effectiveSeoTitle: seoTitle,
    effectiveSeoDescription: seoDescription,
    contentHash: getCatalogContentHash(resource),
  };
}

export function applyCatalogDuplicateIssues(audits: CatalogSeoAudit[]) {
  for (const [field, type, label] of [
    ["effectiveSeoTitle", "duplicate_seo_title", "Duplicate SEO title"],
    ["effectiveSeoDescription", "duplicate_meta_description", "Duplicate meta description"],
  ] as const) {
    const groups = new Map<string, CatalogSeoAudit[]>();
    for (const audit of audits) {
      const value = audit[field].trim().toLowerCase();
      if (!value) continue;
      const group = groups.get(value) || [];
      group.push(audit);
      groups.set(value, group);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      for (const audit of group) {
        if (audit.issues.some((entry) => entry.type === type)) continue;
        audit.issues.push(issue(type, label, "High", "Low", `Write a unique search listing for this ${audit.type}.`));
        audit.score = Math.max(0, audit.score - 10);
      }
    }
  }
}

export function getCatalogContentHash(resource: CatalogResourceInput) {
  return crypto.createHash("sha256").update(JSON.stringify({
    title: resource.title, handle: resource.handle, descriptionHtml: resource.descriptionHtml,
    status: resource.status, seoTitle: resource.seoTitle, seoDescription: resource.seoDescription,
    imageUrl: resource.imageUrl, imageAlt: resource.imageAlt, imageWidth: resource.imageWidth,
    imageHeight: resource.imageHeight, itemCount: resource.itemCount,
  })).digest("hex");
}

function issue(type: string, label: string, impact: CatalogSeoIssue["impact"], effort: CatalogSeoIssue["effort"], fix: string): CatalogSeoIssue {
  return { type, label, impact, effort, fix, message: fix };
}

function stripHtml(value: string) {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}
