/**
 * Checks what a storefront page actually serves to search engines. Theme code,
 * apps and Shopify settings all affect the final HTML, so these checks catch
 * problems that the article data alone cannot show (noindex, wrong canonical,
 * duplicate structured data, missing H1…). Pure functions: no network access.
 */

export type LivePageSnapshot = {
  title: string;
  metaDescription: string;
  canonical: string;
  robots: string;
  h1Count: number;
  jsonLdTypes: string[];
  invalidJsonLdBlocks: number;
  hasOgImage: boolean;
  isPasswordPage: boolean;
};

export type LivePageIssue = {
  type: string;
  label: string;
  message: string;
  severity: "critical" | "warning";
  impact: "High" | "Medium" | "Low";
  effort: "Medium" | "Low";
  fix: string;
  /** Points deducted from the page score. */
  points: number;
  /** Where the issue belongs in SEO Audit. */
  category: "on_page" | "schema";
};

export const LIVE_ISSUE_PREFIX = "live_";
const ARTICLE_TYPES = new Set(["article", "blogposting", "newsarticle"]);

export function parseLivePage(html: string): LivePageSnapshot {
  const head = html.slice(0, 400_000);
  const metaContent = (attribute: "name" | "property", value: string) => {
    for (const match of head.matchAll(/<meta\b[^>]*>/gi)) {
      const tag = match[0];
      if (new RegExp(`\\b${attribute}\\s*=\\s*["']${value}["']`, "i").test(tag)) return decodeEntities(attr(tag, "content"));
    }
    return "";
  };
  let canonical = "";
  for (const match of head.matchAll(/<link\b[^>]*>/gi)) {
    if (/\brel\s*=\s*["']canonical["']/i.test(match[0])) {
      canonical = attr(match[0], "href");
      break;
    }
  }

  const jsonLdTypes: string[] = [];
  let invalidJsonLdBlocks = 0;
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      collectTypes(JSON.parse(match[1].trim()), jsonLdTypes);
    } catch {
      invalidJsonLdBlocks += 1;
    }
  }

  const body = html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  return {
    title: decodeEntities((head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim()),
    metaDescription: metaContent("name", "description"),
    canonical,
    robots: [metaContent("name", "robots"), metaContent("name", "googlebot")].filter(Boolean).join(", ").toLowerCase(),
    h1Count: (body.match(/<h1\b/gi) || []).length,
    jsonLdTypes,
    invalidJsonLdBlocks,
    hasOgImage: Boolean(metaContent("property", "og:image")),
    isPasswordPage: /<form\b[^>]*action\s*=\s*["'][^"']*\/password["']/i.test(html) || /\btemplate-password\b/i.test(html),
  };
}

export function auditLivePage(
  snapshot: LivePageSnapshot,
  options: { pageUrl: string; expectArticleSchema: boolean },
): LivePageIssue[] {
  const issues: LivePageIssue[] = [];
  const add = (issue: Omit<LivePageIssue, "type"> & { type: string }) => issues.push({ ...issue, type: `${LIVE_ISSUE_PREFIX}${issue.type}` });
  if (snapshot.isPasswordPage) return issues;

  if (/\bnoindex\b|\bnone\b/.test(snapshot.robots)) {
    add({ type: "noindex", label: "Page blocks search engines", message: `The live page sends robots "${snapshot.robots}", so it will not appear in search results.`, severity: "critical", impact: "High", effort: "Low", fix: "Remove the noindex robots tag from the theme or the page's search engine settings, unless hiding it is intended.", points: 20, category: "on_page" });
  }
  if (!snapshot.title) {
    add({ type: "missing_title", label: "Missing <title> tag", message: "The live page has no <title> tag.", severity: "critical", impact: "High", effort: "Low", fix: "Make sure the theme outputs page_title in the <head>.", points: 10, category: "on_page" });
  }
  if (snapshot.canonical) {
    const canonicalPath = pathOf(snapshot.canonical);
    const pagePath = pathOf(options.pageUrl);
    if (canonicalPath && pagePath && canonicalPath !== pagePath) {
      add({ type: "canonical_mismatch", label: "Canonical points to another page", message: `The canonical URL is ${snapshot.canonical}, so search engines may index that page instead.`, severity: "warning", impact: "High", effort: "Medium", fix: "Point the canonical tag to this page's own URL (Shopify themes use canonical_url).", points: 8, category: "on_page" });
    }
  } else {
    add({ type: "missing_canonical", label: "Missing canonical tag", message: "The live page has no canonical link tag.", severity: "warning", impact: "Low", effort: "Low", fix: "Add <link rel=\"canonical\" href=\"{{ canonical_url }}\"> to the theme's <head>.", points: 2, category: "on_page" });
  }
  if (snapshot.h1Count === 0) {
    add({ type: "missing_h1", label: "No H1 heading", message: "The live page has no H1 heading.", severity: "warning", impact: "Medium", effort: "Low", fix: "Make the theme render the page or article title as the single H1.", points: 3, category: "on_page" });
  } else if (snapshot.h1Count > 1) {
    add({ type: "multiple_h1", label: "Multiple H1 headings", message: `The live page has ${snapshot.h1Count} H1 headings. Content often adds a second H1 under the theme's title.`, severity: "warning", impact: "Low", effort: "Low", fix: "Keep one H1 (the title) and change headings inside the content to H2.", points: 1, category: "on_page" });
  }
  if (snapshot.invalidJsonLdBlocks > 0) {
    add({ type: "invalid_json_ld", label: "Invalid structured data", message: `${snapshot.invalidJsonLdBlocks} JSON-LD block(s) cannot be parsed, so search engines ignore them.`, severity: "warning", impact: "Medium", effort: "Medium", fix: "Fix the JSON syntax in the theme or app that outputs this structured data.", points: 3, category: "schema" });
  }
  if (options.expectArticleSchema) {
    const articleSchemas = snapshot.jsonLdTypes.filter((type) => ARTICLE_TYPES.has(type.toLowerCase())).length;
    if (articleSchemas === 0) {
      add({ type: "missing_article_schema", label: "No Article structured data", message: "The live page has no Article or BlogPosting JSON-LD.", severity: "warning", impact: "Medium", effort: "Low", fix: "Add the “SEO Schema (JSON-LD)” app block to the blog post template in the theme editor.", points: 2, category: "schema" });
    } else if (articleSchemas > 1) {
      add({ type: "duplicate_article_schema", label: "Duplicate Article structured data", message: `The live page declares ${articleSchemas} Article/BlogPosting entities, usually from both the theme and an app.`, severity: "warning", impact: "Medium", effort: "Low", fix: "Keep one source of Article schema: remove the app block or disable the theme's built-in article schema.", points: 3, category: "schema" });
    }
  }
  if (!snapshot.hasOgImage) {
    add({ type: "missing_og_image", label: "No social sharing image", message: "The live page has no og:image, so shared links may show no preview image.", severity: "warning", impact: "Low", effort: "Low", fix: "Add a featured image, or make the theme output og:image for this template.", points: 1, category: "on_page" });
  }
  return issues;
}

export function livePenalty(issues: Array<{ points?: number }>, cap = 25) {
  return Math.min(cap, issues.reduce((sum, issue) => sum + (issue.points || 0), 0));
}

function collectTypes(node: unknown, types: string[]) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectTypes(item, types));
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  const type = record["@type"];
  if (typeof type === "string") types.push(type);
  else if (Array.isArray(type)) type.forEach((item) => typeof item === "string" && types.push(item));
  if (record["@graph"]) collectTypes(record["@graph"], types);
}

function attr(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return (match?.[2] ?? match?.[3] ?? match?.[4] ?? "").trim();
}

function pathOf(url: string) {
  try {
    return decodeURIComponent(new URL(url, "https://store.invalid").pathname).replace(/\/+$/, "").toLowerCase() || "/";
  } catch {
    return "";
  }
}

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export type StorePageAuditIssue = {
  type: string;
  label: string;
  message: string;
  impact: "High" | "Medium" | "Low";
  effort: "Medium" | "Low";
  fix: string;
};

/**
 * Pages the Admin API does not describe as content (homepage, blog listing)
 * are audited from their live HTML: search listing plus live technical checks.
 */
export function auditStorePageSnapshot(snapshot: LivePageSnapshot | null, liveIssues: LivePageIssue[]) {
  const issues: StorePageAuditIssue[] = [];
  let score = 100;
  const add = (points: number, issue: StorePageAuditIssue) => { score -= points; issues.push(issue); };
  if (snapshot) {
    const title = snapshot.title;
    const description = snapshot.metaDescription;
    if (title.length > 60) add(5, { type: "long_seo_title", label: "SEO title is too long", message: `The page title is ${title.length} characters and may be cut off in search results.`, impact: "Medium", effort: "Low", fix: "Shorten the title to 60 characters or fewer in Shopify's search engine listing or theme settings." });
    if (!description) add(15, { type: "missing_meta_description", label: "Missing meta description", message: "The live page has no meta description.", impact: "High", effort: "Low", fix: "Add a meta description in Shopify (Online Store › Preferences for the homepage, or the blog's search engine listing)." });
    else if (description.length < 70) add(4, { type: "short_meta_description", label: "Meta description is too short", message: `The meta description is only ${description.length} characters.`, impact: "Medium", effort: "Low", fix: "Expand it with the main benefit and what visitors will find." });
    else if (description.length > 165) add(3, { type: "long_meta_description", label: "Meta description is too long", message: `The meta description is ${description.length} characters.`, impact: "Low", effort: "Low", fix: "Keep it at 165 characters or fewer." });
  }
  for (const issue of liveIssues) {
    score -= issue.points;
    issues.push({ type: issue.type, label: issue.label, message: issue.message, impact: issue.impact, effort: issue.effort, fix: issue.fix });
  }
  return { score: Math.max(0, Math.min(100, score)), issues };
}
