import type { SeoAuditIssue } from "./seo-audit";
import { isNineRouterConfigured } from "./ai-seo.server";
import { createNineRouterResponseError, fetchNineRouter, getNineRouterGenerationOptions, readNineRouterJson } from "./nine-router.server";

export const AI_SEO_FIX_FIELDS = ["title", "body", "excerpt", "metaTitle", "metaDescription", "featuredImageAlt"] as const;

export type AiSeoFixField = typeof AI_SEO_FIX_FIELDS[number];

export type AiSeoFixChange = {
  field: AiSeoFixField;
  after: string;
  replacements?: AiSeoFixReplacement[];
  explanation: string;
  issueTypes: string[];
};

export type AiSeoFixReplacement = {
  find: string;
  replace: string;
};

export type AiSeoFixManualAction = {
  issueType: string;
  explanation: string;
  action: string;
  suggestedLinks: AiSeoFixSuggestedLink[];
};

export type AiSeoFixSuggestedLink = {
  url: string;
  title: string;
  anchorText: string;
  reason: string;
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
const SEO_FIX_RESPONSE_SCHEMA = {
  name: "seo_fix_result",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "changes", "manualActions"],
    properties: {
      summary: { type: "string" },
      changes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["field", "after", "replacements", "explanation", "issueTypes"],
          properties: {
            field: { type: "string", enum: [...AI_SEO_FIX_FIELDS] },
            after: { type: "string" },
            replacements: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["find", "replace"],
                properties: { find: { type: "string" }, replace: { type: "string" } },
              },
            },
            explanation: { type: "string" },
            issueTypes: { type: "array", items: { type: "string" } },
          },
        },
      },
      manualActions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["issueType", "explanation", "action", "suggestedLinks"],
          properties: {
            issueType: { type: "string" },
            explanation: { type: "string" },
            action: { type: "string" },
            suggestedLinks: {
              type: "array",
              maxItems: 3,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["url", "title", "anchorText", "reason"],
                properties: {
                  url: { type: "string" },
                  title: { type: "string" },
                  anchorText: { type: "string" },
                  reason: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

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
      response_format: { type: "json_schema", json_schema: SEO_FIX_RESPONSE_SCHEMA },
      messages: [
        {
          role: "system",
          content: [
            "You are an ecommerce SEO Fix Copilot. Return only one JSON object with summary, changes, and manualActions.",
            "changes is an array of objects with field, after, replacements, explanation, and issueTypes. Allowed fields are title, body, excerpt, metaTitle, metaDescription, and featuredImageAlt.",
            "manualActions is an array of objects with issueType, explanation, action, and suggestedLinks.",
            "Fix only the supplied issues and preserve the article language, meaning, voice, factual claims, and useful detail.",
            "Never invent products, links, sources, statistics, prices, testimonials, guarantees, author credentials, tests, or first-hand experience.",
            "For manualOnly issues, do not change a field; return a concrete manual action instead.",
            "For external_links, dofollow_external_links, or eeat_sources, suggest up to 3 specific HTTPS links in suggestedLinks. Each link needs its page title, natural anchorText, and a reason tied to a claim in the supplied article. Prefer primary sources, official standards, government, universities, or established subject-matter organizations. Never use search-result URLs, affiliate pages, competitors' product pages, or a generic homepage when a relevant deep page is known. If you cannot confidently provide a relevant public URL, return an empty suggestedLinks array.",
            "For all other issue types, suggestedLinks must be an empty array. Never claim that a suggested URL was verified or accessed.",
            "For article_title, return only one title change. Create a clear, specific article title that matches the supplied body, preserves the article language and voice, and uses the focus keyword naturally when relevant.",
            "For excerpt_summary, return only one excerpt change. Summarize the supplied article accurately in one or two useful sentences without unsupported claims, HTML, or a generic call to action.",
            "Treat metadata, content, media, authority, linking, and settings issue groups independently. Do not rewrite body content to solve a metadata, media, linking, authority, or settings-only issue.",
            "For body changes, never return the complete article in after. Set after to an empty string and return at most 12 small replacements, each with an exact find substring copied verbatim from bodyHtml and its replacement HTML. Each find must occur exactly once.",
            "If a safe exact body replacement is not possible, do not return a body change; return a manual action. Do not use h1, scripts, styles, iframes, forms, SVG, event attributes, inline CSS, or markdown fences.",
            "Preserve every existing href and img src exactly. Preserve every [[SBS_PRODUCTS...]] and [[SBS_TOC...]] marker exactly.",
            "You may edit inline image alt attributes only when an image-alt issue was selected. Do not remove images, links, tables, or product blocks.",
            "Use natural keywords; do not stuff or force exact matches. Do not expand content with unsupported claims merely to reach a word count.",
            "Metadata fixes must accurately describe the supplied article. Use the focus keyword naturally only when one is supplied. Body fixes should address search intent, clarity, heading structure, readability, or early topical relevance only when the selected issue requires it.",
            "For paragraph_length, modify only the paragraphs identified in issue details. Either split the paragraph into two or three shorter paragraphs at natural transitions, or make it moderately more concise by removing repetition and filler. Preserve every fact, number, quotation, link, image, and the original meaning. Never return an empty replacement or delete the paragraph.",
            "Image alt fixes must describe what the supplied image context actually supports; never turn alt text into a keyword list.",
            "metaTitle must be at most 70 characters, metaDescription at most 160, excerpt at most 400, and featuredImageAlt at most 255.",
            "Return only fields that actually change. Every change and manual action must reference only supplied issue types.",
            "The summary must describe only entries actually returned in changes and manualActions, without claiming that anything was published or saved.",
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
              details: issue.details || [],
              group: seoIssueGroup(issue.type),
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
  const parsedChanges = parseChanges(parsed.changes, selectedTypes, input);
  const paragraphFallback = !parsedChanges.changes.some((change) => change.field === "body")
    && parsedChanges.rejectedIssueTypes.includes("paragraph_length")
    ? buildParagraphLengthFallback(input, issues)
    : null;
  const rejectedIssueTypes = parsedChanges.rejectedIssueTypes
    .filter((issueType) => !(issueType === "paragraph_length" && paragraphFallback));
  const rejectedBodyActions = rejectedIssueTypes.map((issueType) => ({
    issueType,
    explanation: "The AI-proposed article markup did not pass the app's safety and structure checks.",
    action: "Review this issue and edit the article content manually. No unsafe AI markup was added to the draft.",
    suggestedLinks: [],
  }));
  const changes = paragraphFallback ? [...parsedChanges.changes, paragraphFallback] : parsedChanges.changes;
  const manualActions = ensureManualActions([
    ...parseManualActions(parsed.manualActions, selectedTypes),
    ...rejectedBodyActions,
  ], issues);
  if (!changes.length && !manualActions.length) {
    throw new Error("9Router returned no usable SEO fixes");
  }

  return {
    summary: rejectedIssueTypes.length
      ? "Safe SEO changes are ready for review. Some article-content suggestions were moved to manual actions because they did not pass safety checks."
      : cleanLine(parsed.summary).slice(0, 500) || "Review the proposed SEO improvements below.",
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
      suggestedLinks: [],
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
  if (!Array.isArray(value)) return { changes: [] as AiSeoFixChange[], rejectedIssueTypes: [] as string[] };
  const changes: AiSeoFixChange[] = [];
  const seenFields = new Set<string>();
  const rejectedIssueTypes = new Set<string>();

  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const field = cleanLine(item.field) as AiSeoFixField;
    if (!AI_SEO_FIX_FIELDS.includes(field) || seenFields.has(field)) continue;
    const issueTypes = Array.isArray(item.issueTypes)
      ? [...new Set(item.issueTypes.map(cleanLine).filter((type) => selectedTypes.has(type)))]
      : [];
    if (!issueTypes.length || issueTypes.every(isManualOnlySeoIssue)) continue;
    if (selectedTypes.size === 1 && selectedTypes.has("article_title") && field !== "title") continue;
    if (selectedTypes.size === 1 && selectedTypes.has("excerpt_summary") && field !== "excerpt") continue;
    const bodyReplacement = field === "body" ? parseBodyReplacements(input.body, item.replacements) : null;
    let after = field === "body"
      ? bodyReplacement?.after || stringValue(item.after).trim()
      : stringValue(item.after).trim();
    if (!after) continue;

    if (field === "body") {
      try {
        if (issueTypes.includes("paragraph_length")) {
          if (!bodyReplacement?.replacements.length) throw new Error("9Router did not return an exact paragraph replacement");
          bodyReplacement.replacements.forEach((replacement) => {
            validateParagraphLengthChange(replacement.find, replacement.replace);
          });
        }
        validateBodyChange(input.body, after, issueTypes);
      } catch (error) {
        issueTypes.forEach((type) => rejectedIssueTypes.add(type));
        console.warn("Rejected unsafe or structurally invalid AI body change", error instanceof Error ? error.message : String(error));
        continue;
      }
    }
    else after = cleanLine(after);
    const limit = field === "metaTitle" ? 70 : field === "metaDescription" ? 160 : field === "excerpt" ? 400 : field === "title" || field === "featuredImageAlt" ? 255 : MAX_ARTICLE_CHARS;
    if (after.length > limit) throw new Error(`9Router returned ${field} over the allowed length`);
    if (field === "featuredImageAlt" && !input.hasFeaturedImage) continue;
    if (after === currentFieldValue(input, field)) continue;

    changes.push({
      field,
      after,
      ...(bodyReplacement?.replacements.length ? { replacements: bodyReplacement.replacements } : {}),
      explanation: cleanLine(item.explanation).slice(0, 500) || "Improves the selected SEO issue.",
      issueTypes,
    });
    seenFields.add(field);
  }

  return { changes, rejectedIssueTypes: [...rejectedIssueTypes] };
}

function seoIssueGroup(type: string) {
  if (["meta_title", "meta_description", "kw_title", "kw_meta", "title_length", "description_length"].includes(type)) return "metadata";
  if (/image|media|alt/.test(type)) return "media";
  if (/link|url/.test(type)) return "linking";
  if (/eeat|source|author|experience/.test(type)) return "authority";
  if (["toc", "products", "kw_missing"].includes(type)) return "settings";
  return "content";
}

function parseBodyReplacements(original: string, value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 12) return null;
  let updated = original;
  const replacements: AiSeoFixReplacement[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const find = stringValue(item.find);
    const replace = stringValue(item.replace);
    if (find.length < 3 || find.length > 4_000 || replace.length > 8_000) return null;
    const firstIndex = updated.indexOf(find);
    if (firstIndex < 0 || updated.indexOf(find, firstIndex + find.length) >= 0) return null;
    updated = `${updated.slice(0, firstIndex)}${replace}${updated.slice(firstIndex + find.length)}`;
    replacements.push({ find, replace });
  }
  return updated === original ? null : { after: updated, replacements };
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
      suggestedLinks: parseSuggestedLinks(item.suggestedLinks, issueType),
    });
    seenTypes.add(issueType);
  }
  return actions;
}

function parseSuggestedLinks(value: unknown, issueType: string): AiSeoFixSuggestedLink[] {
  if (!["external_links", "dofollow_external_links", "eeat_sources"].includes(issueType) || !Array.isArray(value)) return [];
  const links: AiSeoFixSuggestedLink[] = [];
  const seenUrls = new Set<string>();
  for (const raw of value.slice(0, 3)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const url = safePublicHttpsUrl(stringValue(item.url));
    if (!url || seenUrls.has(url)) continue;
    links.push({
      url,
      title: cleanLine(item.title).slice(0, 200) || new URL(url).hostname,
      anchorText: cleanLine(item.anchorText).slice(0, 160),
      reason: cleanLine(item.reason).slice(0, 300),
    });
    seenUrls.add(url);
  }
  return links;
}

function safePublicHttpsUrl(value: string) {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return "";
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname.endsWith(".local")
      || hostname.endsWith(".internal")
      || /^(?:10|127|169\.254|192\.168)\./.test(hostname)
      || /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname)
      || hostname === "::1"
      || hostname.startsWith("fc")
      || hostname.startsWith("fd")
      || hostname.startsWith("fe80:")) return "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function validateBodyChange(original: string, proposed: string, issueTypes: string[]) {
  if (proposed.length > MAX_ARTICLE_CHARS) throw new Error("9Router returned body over the allowed length");
  if (hasNewUnsafeMarkup(original, proposed)) {
    throw new Error("9Router returned unsafe article markup");
  }
  if (countMatches(proposed, /<\s*h1\b/gi) > countMatches(original, /<\s*h1\b/gi)) {
    throw new Error("9Router returned an H1 inside the article body");
  }
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

function validateParagraphLengthChange(original: string, proposed: string) {
  const originalText = normalizeArticleText(original);
  const proposedText = normalizeArticleText(proposed);
  const originalWords = originalText.split(" ").filter(Boolean);
  const proposedWords = proposedText.split(" ").filter(Boolean);
  const minimumWords = Math.max(3, Math.min(20, Math.floor(originalWords.length * 0.55)));
  if (!proposedText || proposedWords.length < minimumWords) {
    throw new Error("9Router removed too much text from the long paragraph");
  }
  if (proposedWords.length > Math.ceil(originalWords.length * 1.1)) {
    throw new Error("9Router expanded the long paragraph instead of improving readability");
  }
  if (!sameStringMultiset(extractNumbers(originalText), extractNumbers(proposedText))) {
    throw new Error("9Router changed or removed a number from the long paragraph");
  }
  const originalQuotes = extractQuotedText(originalText);
  if (originalQuotes.some((quote) => !proposedText.includes(quote))) {
    throw new Error("9Router changed or removed quoted text from the long paragraph");
  }
}

function extractNumbers(value: string) {
  return value.match(/\b\d+(?:[.,]\d+)*(?:%|[a-zA-Z]+)?\b/g) || [];
}

function extractQuotedText(value: string) {
  return [...value.matchAll(/["“”']([^"“”']{8,})["“”']/g)].map((match) => match[1].trim());
}

function buildParagraphLengthFallback(input: AiSeoFixInput, issues: SeoAuditIssue[]): AiSeoFixChange | null {
  const issue = issues.find((candidate) => candidate.type === "paragraph_length");
  const indexes = new Set((issue?.details || []).map((detail) => detail.index));
  if (!indexes.size) return null;
  const paragraphs = [...input.body.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)];
  const replacements: AiSeoFixReplacement[] = [];
  for (const [zeroIndex, match] of paragraphs.entries()) {
    if (!indexes.has(zeroIndex + 1)) continue;
    const fullParagraph = match[0];
    const parts = fullParagraph.match(/^(<p\b[^>]*>)([\s\S]*)(<\/p>)$/i);
    if (!parts || /<[^>]+>/.test(parts[2])) continue;
    const split = splitLongPlainParagraph(parts[2]);
    if (split.length < 2) continue;
    replacements.push({
      find: fullParagraph,
      replace: split.map((part, index) => `${index === 0 ? parts[1] : "<p>"}${part}</p>`).join(""),
    });
  }
  if (!replacements.length) return null;
  const parsed = parseBodyReplacements(input.body, replacements);
  if (!parsed) return null;
  validateBodyChange(input.body, parsed.after, ["paragraph_length"]);
  return {
    field: "body",
    after: parsed.after,
    replacements: parsed.replacements,
    explanation: "Splits only the identified long paragraph at natural sentence boundaries without rewriting or deleting its text.",
    issueTypes: ["paragraph_length"],
  };
}

function splitLongPlainParagraph(value: string) {
  const sentences = value.match(/[^.!?。！？]+(?:[.!?。！？]+|$)/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [];
  if (sentences.length < 2) return [];
  const totalWords = normalizeArticleText(value).split(" ").filter(Boolean).length;
  const targetParts = totalWords > 220 ? 3 : 2;
  const targetWords = Math.ceil(totalWords / targetParts);
  const parts: string[] = [];
  let current: string[] = [];
  let currentWords = 0;
  for (const sentence of sentences) {
    const sentenceWords = normalizeArticleText(sentence).split(" ").filter(Boolean).length;
    if (current.length
      && (currentWords >= targetWords || currentWords + sentenceWords > targetWords)
      && parts.length < targetParts - 1) {
      parts.push(current.join(" "));
      current = [];
      currentWords = 0;
    }
    current.push(sentence);
    currentWords += sentenceWords;
  }
  if (current.length) parts.push(current.join(" "));
  return parts.length >= 2 ? parts : [];
}

function normalizeArticleText(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

function hasNewUnsafeMarkup(original: string, proposed: string) {
  const unsafePatterns = [
    /<\s*\/?\s*(?:script|style|iframe|object|embed|svg|form|input|button|meta|link)\b[^>]*>/gi,
    /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
    /\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
    /\s(?:href|src)\s*=\s*(?:"\s*(?:javascript|data|vbscript)\s*:[^"]*"|'\s*(?:javascript|data|vbscript)\s*:[^']*'|(?:javascript|data|vbscript)\s*:[^\s>]+)/gi,
  ];
  return unsafePatterns.some((pattern) => !isSubsetMultiset(
    extractNormalizedMatches(proposed, pattern),
    extractNormalizedMatches(original, pattern),
  ));
}

function extractNormalizedMatches(value: string, pattern: RegExp) {
  return [...value.matchAll(pattern)].map((match) => match[0].replace(/\s+/g, " ").trim().toLowerCase());
}

function isSubsetMultiset(values: string[], allowedValues: string[]) {
  const allowed = new Map<string, number>();
  for (const value of allowedValues) allowed.set(value, (allowed.get(value) || 0) + 1);
  for (const value of values) {
    const remaining = allowed.get(value) || 0;
    if (remaining < 1) return false;
    allowed.set(value, remaining - 1);
  }
  return true;
}

function countMatches(value: string, pattern: RegExp) {
  return [...value.matchAll(pattern)].length;
}

function currentFieldValue(input: AiSeoFixInput, field: AiSeoFixField) {
  if (field === "title") return input.title;
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
