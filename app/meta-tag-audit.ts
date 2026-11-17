import { META_DESCRIPTION_RANGE, SEO_TITLE_RANGE } from "./seo-audit";

export type MetaTagProblem =
  | "missing_description"
  | "description_too_long"
  | "description_too_short"
  | "title_too_long"
  | "title_too_short"
  | "missing_featured_alt";

export const META_TAG_PROBLEM_LABELS: Record<MetaTagProblem, string> = {
  missing_description: "Missing meta description",
  description_too_long: "Meta description too long",
  description_too_short: "Meta description too short",
  title_too_long: "SEO title too long",
  title_too_short: "SEO title too short",
  missing_featured_alt: "Featured image missing alt",
};

// Same thresholds as the SEO engine, so Bulk Optimize and SEO Audit agree.
export const META_TITLE_RANGE = SEO_TITLE_RANGE;
export { META_DESCRIPTION_RANGE };

export type MetaTagAuditInput = {
  articleTitle: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
};

/**
 * Checks the fields that Bulk Optimize → Meta tags can fix. Shopify falls back to
 * the article title when no SEO title is set, so the effective title is audited.
 */
export function auditMetaTags(input: MetaTagAuditInput): MetaTagProblem[] {
  const problems: MetaTagProblem[] = [];
  const title = clean(input.metaTitle) || clean(input.articleTitle);
  const description = clean(input.metaDescription);

  if (!description) problems.push("missing_description");
  else if (description.length > META_DESCRIPTION_RANGE.max) problems.push("description_too_long");
  else if (description.length < META_DESCRIPTION_RANGE.min) problems.push("description_too_short");

  if (title.length > META_TITLE_RANGE.max) problems.push("title_too_long");
  else if (title && title.length < META_TITLE_RANGE.min) problems.push("title_too_short");

  if (clean(input.imageUrl) && !clean(input.imageAlt)) problems.push("missing_featured_alt");

  return problems;
}

function clean(value: string | null | undefined) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
