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
  focusKeyword?: string;
  mediaId?: string;
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
  const focusKeyword = (resource.focusKeyword || "").trim().toLowerCase();
  let score = 100;
  const add = (penalty: number, issue: CatalogSeoIssue) => { score -= penalty; issues.push(issue); };

  if (!seoTitle) add(20, issue("missing_seo_title", "Missing SEO title", "High", "Low", "Add a unique search title in Shopify search engine listing."));
  else if (seoTitle.length > 70) add(7, issue("long_seo_title", "SEO title is too long", "Medium", "Low", "Shorten the search title to 70 characters or fewer."));
  else if (seoTitle.length < 20) add(4, issue("short_seo_title", "SEO title is very short", "Low", "Low", "Make the search title more descriptive without keyword stuffing."));
  const titleWords = seoTitle.split(/\s+/).filter(Boolean);
  if (titleWords.length > 0 && (titleWords.length < 4 || titleWords.length > 12)) add(2, issue("title_word_count", "SEO title word count needs review", "Low", "Low", "Aim for a clear title of roughly 4–12 words."));
  if (seoTitle.length >= 8 && seoTitle === seoTitle.toUpperCase()) add(2, issue("title_all_caps", "SEO title uses all capital letters", "Low", "Low", "Use natural title casing so the search result is easier to scan."));
  if (hasRepeatedWords(seoTitle)) add(2, issue("title_repeated_words", "SEO title repeats words", "Low", "Low", "Remove repeated terms from the SEO title."));

  if (!seoDescription) add(18, issue("missing_meta_description", "Missing meta description", "High", "Low", "Add a unique description in Shopify search engine listing."));
  else if (seoDescription.length < 70) add(6, issue("short_meta_description", "Meta description is too short", "Medium", "Low", "Expand it with the main benefit and search intent."));
  else if (seoDescription.length > 165) add(5, issue("long_meta_description", "Meta description is too long", "Low", "Low", "Keep it at 165 characters or fewer."));

  const minimumWords = resource.type === "product" ? 40 : 30;
  if (!text) add(15, issue("missing_description", `Missing ${resource.type} description`, "High", "Medium", `Add useful, original ${resource.type} content in Shopify.`));
  else if (wordCount < minimumWords) add(7, issue("thin_description", "Thin description", "Medium", "Medium", `Expand the ${resource.type} description with useful shopper information.`));

  if (!resource.handle.trim()) add(8, issue("missing_handle", "Missing URL handle", "High", "Low", "Add a short descriptive Shopify URL handle."));
  else if (resource.handle.length > 80) add(3, issue("long_handle", "URL handle is too long", "Low", "Low", "Shorten the handle while preserving the primary topic."));
  if (/[A-Z_\s]/.test(resource.handle)) add(2, issue("unclean_handle", "URL handle is not search friendly", "Low", "Low", "Use lowercase words separated by hyphens in the Shopify handle."));

  if (!resource.imageUrl) add(8, issue("missing_featured_image", `Missing ${resource.type} image`, "Medium", "Medium", `Add a representative image to this ${resource.type}.`));
  else {
    if (!resource.imageAlt.trim()) add(6, issue("missing_image_alt", "Image alt text is missing", "Medium", "Low", "Add concise descriptive alt text in Shopify."));
    else if (resource.imageAlt.trim().split(/\s+/).length > 18) add(2, issue("long_image_alt", "Image alt text is too long", "Low", "Low", "Keep alt text concise and describe only what is useful in the image."));
    if ((resource.imageWidth > 0 && resource.imageWidth < 600) || (resource.imageHeight > 0 && resource.imageHeight < 600)) {
      add(3, issue("small_image", "Image may be too small", "Low", "Medium", "Use a higher-resolution Shopify image where appropriate."));
    }
    const filename = imageFilename(resource.imageUrl);
    if (!filename || /^(image|img|photo|dsc|untitled|default)[-_\d]*$/i.test(filename)) add(1, issue("generic_image_filename", "Image filename is not descriptive", "Low", "Medium", "Use a descriptive filename when replacing this Shopify image."));
  }

  if (text) {
    const deeperMinimum = resource.type === "product" ? 80 : 60;
    if (wordCount >= minimumWords && wordCount < deeperMinimum) add(3, issue("limited_content_depth", "Description could be more comprehensive", "Low", "Medium", `Add useful ${resource.type === "product" ? "benefits, materials, use and care details" : "context about the products and shopper intent"}.`));
    if (!/<h[2-4]\b/i.test(resource.descriptionHtml)) add(2, issue("missing_subheadings", "Description has no subheadings", "Low", "Low", "Use H2 or H3 headings to organize longer content."));
    if (!/<a\b[^>]*href=["'](?:\/[^"']*|https?:\/\/[^"']+)["']/i.test(resource.descriptionHtml)) add(3, issue("missing_internal_link", "Description has no contextual link", "Low", "Low", "Add a useful link to a related Shopify page or article."));
    if (hasLongParagraph(resource.descriptionHtml)) add(2, issue("long_paragraph", "A paragraph is difficult to scan", "Low", "Low", "Break long paragraphs into shorter sections for mobile shoppers."));
  }

  if (resource.type === "collection" && resource.itemCount === 0) {
    add(12, issue("empty_collection", "Collection has no products", "High", "Medium", "Add relevant products or remove the empty collection from storefront navigation."));
  }

  if (!focusKeyword) {
    add(8, issue("missing_focus_keyword", "Focus keyword is not configured", "Medium", "Low", "Add a primary search phrase to evaluate this page against its intended topic."));
  } else {
    const titleText = seoTitle.toLowerCase();
    const descriptionText = seoDescription.toLowerCase();
    const bodyText = text.toLowerCase();
    if (!titleText.includes(focusKeyword)) add(5, issue("keyword_missing_title", "Focus keyword is missing from the SEO title", "Medium", "Low", "Use the focus keyword naturally in the SEO title."));
    if (!descriptionText.includes(focusKeyword)) add(3, issue("keyword_missing_description", "Focus keyword is missing from the meta description", "Low", "Low", "Use the focus keyword naturally in the meta description."));
    if (!bodyText.includes(focusKeyword)) add(5, issue("keyword_missing_content", "Focus keyword is missing from the description", "Medium", "Medium", `Explain the ${resource.type} using the focus keyword naturally.`));
    if (!resource.handle.toLowerCase().includes(slugify(focusKeyword))) add(2, issue("keyword_missing_url", "Focus keyword is missing from the URL", "Low", "Medium", "Include the primary topic in the Shopify URL handle when a redirect is acceptable."));
    if (/<h[2-4]\b/i.test(resource.descriptionHtml) && !headingText(resource.descriptionHtml).includes(focusKeyword)) add(2, issue("keyword_missing_heading", "Focus keyword is missing from subheadings", "Low", "Low", "Use the focus keyword naturally in one relevant H2 or H3 heading."));
    if (resource.imageAlt.trim() && !resource.imageAlt.toLowerCase().includes(focusKeyword)) add(2, issue("keyword_missing_image_alt", "Focus keyword is missing from image alt text", "Low", "Low", "Use the focus keyword in alt text only when it accurately describes the image."));
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
  const value = JSON.stringify({
    title: resource.title, handle: resource.handle, descriptionHtml: resource.descriptionHtml,
    status: resource.status, seoTitle: resource.seoTitle, seoDescription: resource.seoDescription,
    imageUrl: resource.imageUrl, imageAlt: resource.imageAlt, imageWidth: resource.imageWidth,
    imageHeight: resource.imageHeight, itemCount: resource.itemCount,
    focusKeyword: resource.focusKeyword || "",
  });
  // A fast deterministic fingerprint is sufficient here; this value only detects changed content.
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function issue(type: string, label: string, impact: CatalogSeoIssue["impact"], effort: CatalogSeoIssue["effort"], fix: string): CatalogSeoIssue {
  return { type, label, impact, effort, fix, message: fix };
}

function stripHtml(value: string) {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

function hasRepeatedWords(value: string) {
  const words = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return words.some((word, index) => word.length > 2 && words[index - 1] === word);
}
function imageFilename(value: string) { try { return decodeURIComponent(new URL(value).pathname.split("/").pop() || "").replace(/\.[a-z0-9]+$/i, ""); } catch { return ""; } }
function hasLongParagraph(value: string) { return [...value.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].some((match) => stripHtml(match[1]).split(/\s+/).filter(Boolean).length > 80); }
function headingText(value: string) { return [...value.matchAll(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/gi)].map((match) => stripHtml(match[1]).toLowerCase()).join(" "); }
function slugify(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
