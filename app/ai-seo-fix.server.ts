import type { SeoAuditIssue } from "./seo-audit";
import { isNineRouterConfigured } from "./ai-seo.server";
import { createNineRouterResponseError, fetchNineRouter, getNineRouterGenerationOptions, readNineRouterJson } from "./nine-router.server";

export const AI_SEO_FIX_FIELDS = ["body", "excerpt", "metaTitle", "metaDescription", "featuredImageAlt"] as const;

export type AiSeoFixField = typeof AI_SEO_FIX_FIELDS[number];

export type AiSeoFixChange = {
  field: AiSeoFixField;
  after: string;
  explanation: string;
  issueTypes: string[];
};

export type AiSeoFixManualAction = {
  issueType: string;
  explanation: string;
  action: string;
};

export type AiSeoFixSuggestion = {
  summary: string;
  changes: AiSeoFixChange[];
  manualActions: AiSeoFixManualAction[];
};

export type AiSeoFixInput = {
  issues: SeoAuditIssue[];
  title: string;
  body: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  featuredImageAlt: string;
  hasFeaturedImage: boolean;
  focusKeyword: string;
};

const MAX_ARTICLE_CHARS = 50_000;
const MAX_ISSUES = 30;
const MAX_OUTPUT_CHARS = 70_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MARKER_PATTERN = /\[\[SBS_(?:PRODUCTS|TOC)(?::[a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+)?)?\]\]/g;
const MANUAL_ONLY_TYPES = new Set([
  "url_length",
  "kw_url",
  "kw_missing",
  "external_links",
  "dofollow_external_links",
  "internal_links",
  "media",
  "images_missing_dimensions",
  "generic_image_filenames",
  "uncrawlable_image_urls",
  "small_article_images",
  "toc",
  "eeat_author",
  "eeat_sources",
  "eeat_experience",
  "products",
]);

export function isManualOnlySeoIssue(type: string) {
  return MANUAL_ONLY_TYPES.has(type);
}

export async function generateAiSeoFix(input: AiSeoFixInput): Promise<AiSeoFixSuggestion> {
  if (!isNineRouterConfigured()) throw new Error("9Router is not configured");

  const issues = input.issues
    .filter((issue) => issue?.type && issue.severity !== "good")
    .slice(0, MAX_ISSUES);
  if (!issues.length) throw new Error("Choose at least one SEO issue to fix");
  if (input.body.length > MAX_ARTICLE_CHARS) {
    throw new Error("This article is too large for SEO Fix Copilot. Shorten it or fix smaller sections first");
  }

  const baseUrl = process.env.NINE_ROUTER_BASE_URL!.trim().replace(/\/+$/, "");
  const apiKey = process.env.NINE_ROUTER_API_KEY!.trim();
  const model = process.env.NINE_ROUTER_MODEL!.trim();
  const timeoutValue = Number(process.env.NINE_ROUTER_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutValue) && timeoutValue >= 1_000
    ? Math.min(timeoutValue, 60_000)
    : DEFAULT_TIMEOUT_MS;
  const currentBody = input.body;
  const selectedTypes = new Set(issues.map((issue) => issue.type));

  const response = await fetchNineRouter(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: false,
      ...getNineRouterGenerationOptions(model, 0.2),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You are an ecommerce SEO Fix Copilot. Return only one JSON object with summary, changes, and manualActions.",
            "changes is an array of objects with field, after, explanation, and issueTypes. Allowed fields are body, excerpt, metaTitle, metaDescription, and featuredImageAlt.",
            "manualActions is an array of objects with issueType, explanation, and action.",
            "Fix only the supplied issues and preserve the article language, meaning, voice, factual claims, and useful detail.",
            "Never invent products, links, sources, statistics, prices, testimonials, guarantees, author credentials, tests, or first-hand experience.",
            "For manualOnly issues, do not change a field; return a concrete manual action instead.",
            "When changing body, return the complete HTML fragment. Do not use h1, scripts, styles, iframes, forms, SVG, event attributes, inline CSS, or markdown fences.",
            "Preserve every existing href and img src exactly. Preserve every [[SBS_PRODUCTS...]] and [[SBS_TOC...]] marker exactly.",
            "You may edit inline image alt attributes only when an image-alt issue was selected. Do not remove images, links, tables, or product blocks.",
            "Use natural keywords; do not stuff or force exact matches. Do not expand content with unsupported claims merely to reach a word count.",
            "metaTitle must be at most 70 characters, metaDescription at most 160, excerpt at most 400, and featuredImageAlt at most 255.",
            "Return only fields that actually change. Every change and manual action must reference only supplied issue types.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            issues: issues.map((issue) => ({
              type: issue.type,
              label: issue.label,
              message: issue.message,
              severity: issue.severity,
              fix: issue.fix || "",
              manualOnly: isManualOnlySeoIssue(issue.type),
            })),
            article: {
              title: input.title.slice(0, 300),
              focusKeyword: input.focusKeyword.slice(0, 300),
              excerpt: input.excerpt.slice(0, 400),
              metaTitle: input.metaTitle.slice(0, 70),
              metaDescription: input.metaDescription.slice(0, 160),
              featuredImageAlt: input.featuredImageAlt.slice(0, 255),
              hasFeaturedImage: input.hasFeaturedImage,
              bodyHtml: currentBody,
            },
          }),
        },
      ],
    }),
  }, timeoutMs);

  if (!response.ok) {
    throw await createNineRouterResponseError(response, "SEO fixes");
  }

  const payload: any = await readNineRouterJson(response);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("9Router returned no message content");
  if (content.length > MAX_OUTPUT_CHARS) throw new Error("9Router returned an SEO fix that is too large");

  const parsed = parseJsonObject(content);
  const changes = parseChanges(parsed.changes, selectedTypes, input);
  const manualActions = ensureManualActions(parseManualActions(parsed.manualActions, selectedTypes), issues);
  if (!changes.length && !manualActions.length) {
    throw new Error("9Router returned no usable SEO fixes");
  }

  return {
    summary: cleanLine(parsed.summary).slice(0, 500) || "Review the proposed SEO improvements below.",
    changes,
    manualActions,
  };
}

function ensureManualActions(actions: AiSeoFixManualAction[], issues: SeoAuditIssue[]) {
  const covered = new Set(actions.map((action) => action.issueType));
  const complete = [...actions];
  for (const issue of issues) {
    if (!isManualOnlySeoIssue(issue.type) || covered.has(issue.type)) continue;
    complete.push({
      issueType: issue.type,
      explanation: manualIssueExplanation(issue.type),
      action: issue.fix || manualIssueAction(issue.type),
    });
    covered.add(issue.type);
  }
  return complete;
}

function manualIssueExplanation(type: string) {
  if (["external_links", "dofollow_external_links", "eeat_sources"].includes(type)) return "A trustworthy, relevant source must be chosen by a person.";
  if (type === "eeat_experience") return "AI cannot claim experience, testing, or results that did not happen.";
  if (type === "eeat_author") return "Author identity and credentials must be verified by the merchant.";
  if (["media", "generic_image_filenames", "uncrawlable_image_urls", "small_article_images", "images_missing_dimensions"].includes(type)) return "This requires choosing or updating a real media asset.";
  if (["url_length", "kw_url"].includes(type)) return "Changing a published URL can require a redirect and should be reviewed first.";
  if (type === "kw_missing") return "The focus keyword is a merchant strategy choice and is not an article field Copilot should guess.";
  if (type === "internal_links") return "Choose a real, relevant store page with the internal link assistant.";
  return "This issue needs a setting or merchant decision outside the article text.";
}

function manualIssueAction(type: string) {
  if (["external_links", "dofollow_external_links", "eeat_sources"].includes(type)) return "Choose a primary or authoritative source that supports a specific claim, then add the relevant link.";
  if (type === "eeat_experience") return "Add only genuine first-hand observations, original photos, comparisons, or test results.";
  if (type === "eeat_author") return "Assign the correct author and verify the storefront displays the byline.";
  if (type === "internal_links") return "Use the internal link assistant to review and add a relevant store link.";
  if (type === "toc") return "Open Content navigation settings and enable the table of contents when the article has enough headings.";
  if (["url_length", "kw_url"].includes(type)) return "Review the handle and create a redirect before changing the published URL.";
  if (type === "kw_missing") return "Enter a primary focus keyword in the SEO panel, then run Copilot again.";
  if (type === "media") return "Add a relevant Shopify image, product block, or video that helps the reader.";
  if (type === "images_missing_dimensions") return "Set accurate width and height values from the original image dimensions.";
  if (type === "generic_image_filenames") return "Replace the asset with a Shopify-hosted image that has a short descriptive filename.";
  if (type === "uncrawlable_image_urls") return "Upload the image to Shopify Files and replace the source with its HTTPS CDN URL.";
  if (type === "small_article_images") return "Replace important images with higher-resolution Shopify-hosted versions.";
  if (type === "products") return "Open the Products tab and choose products that genuinely match the article.";
  return "Review the issue and complete the recommended action manually.";
}

function parseChanges(value: unknown, selectedTypes: Set<string>, input: AiSeoFixInput) {
  if (!Array.isArray(value)) return [];
  const changes: AiSeoFixChange[] = [];
  const seenFields = new Set<string>();
  let firstValidationError: unknown;

  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const field = cleanLine(item.field) as AiSeoFixField;
    if (!AI_SEO_FIX_FIELDS.includes(field) || seenFields.has(field)) continue;
    const issueTypes = Array.isArray(item.issueTypes)
      ? [...new Set(item.issueTypes.map(cleanLine).filter((type) => selectedTypes.has(type)))]
      : [];
    if (!issueTypes.length || issueTypes.every(isManualOnlySeoIssue)) continue;
    let after = stringValue(item.after).trim();
    if (!after) continue;

    if (field === "body") {
      try {
        validateBodyChange(input.body, after, issueTypes);
      } catch (error) {
        firstValidationError ||= error;
        console.warn("Rejected unsafe or structurally invalid AI body change", error instanceof Error ? error.message : String(error));
        continue;
      }
    }
    else after = cleanLine(after);
    const limit = field === "metaTitle" ? 70 : field === "metaDescription" ? 160 : field === "excerpt" ? 400 : field === "featuredImageAlt" ? 255 : MAX_ARTICLE_CHARS;
    if (after.length > limit) throw new Error(`9Router returned ${field} over the allowed length`);
    if (field === "featuredImageAlt" && !input.hasFeaturedImage) continue;
    if (after === currentFieldValue(input, field)) continue;

    changes.push({
      field,
      after,
      explanation: cleanLine(item.explanation).slice(0, 500) || "Improves the selected SEO issue.",
      issueTypes,
    });
    seenFields.add(field);
  }

  if (!changes.length && firstValidationError) throw firstValidationError;
  return changes;
}

function parseManualActions(value: unknown, selectedTypes: Set<string>) {
  if (!Array.isArray(value)) return [];
  const actions: AiSeoFixManualAction[] = [];
  const seenTypes = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const issueType = cleanLine(item.issueType);
    const action = cleanLine(item.action).slice(0, 500);
    if (!selectedTypes.has(issueType) || seenTypes.has(issueType) || !action) continue;
    actions.push({
      issueType,
      explanation: cleanLine(item.explanation).slice(0, 500),
      action,
    });
    seenTypes.add(issueType);
  }
  return actions;
}

function validateBodyChange(original: string, proposed: string, issueTypes: string[]) {
  if (proposed.length > MAX_ARTICLE_CHARS) throw new Error("9Router returned body over the allowed length");
  if (/<\s*\/?\s*(script|style|iframe|object|embed|svg|form|input|button|meta|link)\b/i.test(proposed)
    || /\son[a-z]+\s*=/i.test(proposed)
    || /\sstyle\s*=/i.test(proposed)
    || /(?:javascript|data|vbscript)\s*:/i.test(proposed)) {
    throw new Error("9Router returned unsafe article markup");
  }
  if (/<\s*h1\b/i.test(proposed)) throw new Error("9Router returned an H1 inside the article body");
  if (!sameStringMultiset(extractAttributeValues(original, "href"), extractAttributeValues(proposed, "href"))) {
    throw new Error("9Router did not preserve the article links");
  }
  if (!sameStringMultiset(extractAttributeValues(original, "src"), extractAttributeValues(proposed, "src"))) {
    throw new Error("9Router did not preserve the article images");
  }
  if (!sameStringMultiset(original.match(MARKER_PATTERN) || [], proposed.match(MARKER_PATTERN) || [])) {
    throw new Error("9Router did not preserve the article blocks");
  }
  const altIssueSelected = issueTypes.some((type) => ["inline_images_missing_alt", "image_alt_stuffing", "decorative_image_alt", "kw_alt"].includes(type));
  if (!altIssueSelected && !sameStringMultiset(extractAttributeValues(original, "alt"), extractAttributeValues(proposed, "alt"))) {
    throw new Error("9Router changed image alt text for an unrelated issue");
  }
}

function currentFieldValue(input: AiSeoFixInput, field: AiSeoFixField) {
  if (field === "body") return input.body;
  if (field === "excerpt") return input.excerpt;
  if (field === "metaTitle") return input.metaTitle;
  if (field === "metaDescription") return input.metaDescription;
  return input.featuredImageAlt;
}

function extractAttributeValues(html: string, attribute: string) {
  const pattern = new RegExp(`\\s${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "gi");
  return [...html.matchAll(pattern)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}

function parseJsonObject(value: string): Record<string, unknown> {
  const normalized = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(normalized);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("9Router returned invalid JSON");
  return parsed;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function cleanLine(value: unknown) {
  return stringValue(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function sameStringMultiset(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const sortedRight = [...right].sort();
  return [...left].sort().every((value, index) => value === sortedRight[index]);
}
