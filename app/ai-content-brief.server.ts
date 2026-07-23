import { isNineRouterConfigured } from "./ai-seo.server";
import type { ContentBriefContext } from "./content-brief-context";
import { detectQueryCompetition } from "./content-brief-context";
import {
  createNineRouterResponseError,
  fetchNineRouter,
  getNineRouterGenerationOptions,
  readNineRouterJson,
} from "./nine-router.server";

export const CONTENT_BRIEF_SECTIONS = ["strategy", "keywords", "outline", "questions", "internalLinks", "products", "risks"] as const;
export type ContentBriefSection = typeof CONTENT_BRIEF_SECTIONS[number];

export type AiContentBrief = {
  title: string;
  searchIntent: "informational" | "commercial" | "comparison" | "transactional" | "navigational";
  audience: string;
  objective: string;
  contentAngle: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  entities: string[];
  outline: Array<{ level: "h2" | "h3"; heading: string; purpose: string }>;
  questions: string[];
  internalLinks: Array<{ articleId: string; articleTitle: string; targetUrl: string; anchorIdea: string; reason: string }>;
  productPlacements: Array<{ productId: string; productTitle: string; productUrl: string; section: string; reason: string }>;
  cannibalizationRisks: Array<{ articleId: string; articleTitle: string; reason: string; action: string }>;
  sourceQueries: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number; rationale: string }>;
};

type GenerateContentBriefInput = {
  title: string;
  seedKeyword: string;
  audience: string;
  objective: string;
  sourceArticleId: string;
  context: ContentBriefContext;
  existingBrief?: AiContentBrief | null;
  regenerateSection?: ContentBriefSection | null;
};

const DEFAULT_TIMEOUT_MS = 45_000;

export async function generateAiContentBrief(input: GenerateContentBriefInput): Promise<AiContentBrief> {
  if (!isNineRouterConfigured()) throw new Error("9Router is not configured");
  if (!input.title.trim() && !input.seedKeyword.trim()) throw new Error("Add a topic or seed keyword");

  const baseUrl = process.env.NINE_ROUTER_BASE_URL!.trim().replace(/\/+$/, "");
  const apiKey = process.env.NINE_ROUTER_API_KEY!.trim();
  const model = process.env.NINE_ROUTER_MODEL!.trim();
  const timeoutValue = Number(process.env.NINE_ROUTER_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutValue) && timeoutValue >= 1_000
    ? Math.min(timeoutValue, 60_000)
    : DEFAULT_TIMEOUT_MS;

  const systemMessage = [
    "You are an ecommerce SEO content strategist.",
    "Return only one JSON object matching the requested content-brief schema. Never return Markdown, headings, commentary, or code outside the JSON object.",
    "Create a review-only content brief using only the supplied Shopify articles, products and Search Console rows.",
    "Never invent an article ID, product ID, URL, query, metric, product property, customer claim, statistic or external source.",
    "Search Console metrics show observed performance, not guaranteed intent or causation.",
    "Choose one clear primary intent and make the outline useful to people before search engines.",
    "Use one primary keyword and non-duplicative secondary keywords naturally; do not keyword-stuff.",
    "Outline headings must be specific, non-repetitive and ordered logically. Do not include an H1.",
    "Internal links and product placements are optional. Return only supplied resources that genuinely help the planned section.",
    "Flag existing articles that may compete for the same primary intent and recommend differentiate, consolidate, update, or proceed.",
    input.regenerateSection
      ? `The merchant requested a new ${input.regenerateSection} section. Improve that area while keeping the rest of the existing brief coherent.`
      : "Create the complete brief.",
  ].join(" ");
  const userMessage = JSON.stringify({
    requestedTopic: input.title.slice(0, 255),
    seedKeyword: input.seedKeyword.slice(0, 200),
    audienceHint: input.audience.slice(0, 400),
    objectiveHint: input.objective.slice(0, 400),
    sourceArticleId: input.sourceArticleId,
    existingBrief: input.existingBrief || null,
    regenerateSection: input.regenerateSection || null,
    queryCompetition: detectQueryCompetition(input.context.queries),
    searchConsoleQueries: input.context.queries,
    existingArticles: input.context.articles.map((article) => ({
      id: article.id,
      title: article.title,
      focusKeyword: article.focusKeyword,
      url: articleUrl(article),
      excerpt: visibleText(article.body).slice(0, 1_500),
    })),
    catalogProducts: input.context.products.map((product) => ({
      id: product.id,
      title: product.title,
      url: `/products/${product.handle}`,
      productType: product.productType,
      vendor: product.vendor,
      description: visibleText(product.description).slice(0, 900),
    })),
  });
  const requestContent = async (responseFormat: Record<string, unknown>, retry = false) => {
    const response = await fetchNineRouter(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        stream: false,
        ...getNineRouterGenerationOptions(model, 0.2),
        response_format: responseFormat,
        messages: [
          {
            role: "system",
            content: retry
              ? `${systemMessage} This is a structured-output retry. The root object must contain exactly these keys: title, searchIntent, audience, objective, contentAngle, primaryKeyword, secondaryKeywords, entities, outline, questions, internalLinks, productPlacements, cannibalizationRisks, sourceQueries. Begin with { and end with }.`
              : systemMessage,
          },
          { role: "user", content: userMessage },
        ],
      }),
    }, timeoutMs);
    if (!response.ok) throw await createNineRouterResponseError(response, retry ? "content brief JSON retry" : "content brief");
    const payload: any = await readNineRouterJson(response);
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("9Router returned no message content");
    return content;
  };

  const primaryContent = await requestContent({
    type: "json_schema",
    json_schema: {
      name: "content_brief",
      strict: true,
      schema: contentBriefSchema(),
    },
  });
  try {
    return validateBrief(parseJsonObject(primaryContent), input);
  } catch (error) {
    console.warn("9Router ignored or failed the content brief JSON schema; retrying with JSON object mode", {
      error: error instanceof Error ? error.message : String(error),
      contentPrefix: primaryContent.slice(0, 80),
    });
  }

  const fallbackContent = await requestContent({ type: "json_object" }, true);
  try {
    return validateBrief(parseJsonObject(fallbackContent), input);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`9Router returned an invalid content brief after the JSON retry: ${detail}`);
  }
}

export function contentBriefDraftInstruction(brief: AiContentBrief) {
  const outline = brief.outline.map((item) => `${item.level.toUpperCase()}: ${item.heading} — ${item.purpose}`).join("\n");
  const questions = brief.questions.map((question) => `- ${question}`).join("\n");
  const links = brief.internalLinks.map((link) => `- ${link.articleTitle}: ${link.targetUrl} (${link.reason})`).join("\n");
  const products = brief.productPlacements.map((product) => `- ${product.productTitle} near "${product.section}" (${product.reason})`).join("\n");
  return [
    `Audience: ${brief.audience}`,
    `Objective: ${brief.objective}`,
    `Search intent: ${brief.searchIntent}`,
    `Content angle: ${brief.contentAngle}`,
    `Entities/topics to cover: ${brief.entities.join(", ") || "None specified"}`,
    `Required outline:\n${outline}`,
    `Questions to answer:\n${questions || "- None specified"}`,
    links ? `Internal links to consider (do not invent or automatically insert):\n${links}` : "",
    products ? `Real Shopify products to consider (mention only when contextually useful):\n${products}` : "",
    "Write a complete useful draft from this approved brief. Do not claim facts that are not supported by the brief.",
  ].filter(Boolean).join("\n\n").slice(0, 12_000);
}

function validateBrief(raw: Record<string, unknown>, input: GenerateContentBriefInput): AiContentBrief {
  const articleMap = new Map(input.context.articles.map((article) => [article.id, article]));
  const productMap = new Map(input.context.products.map((product) => [product.id, product]));
  const queryMap = new Map<string, ContentBriefContext["queries"][number]>();
  input.context.queries.forEach((query) => {
    const key = query.query.toLowerCase();
    const current = queryMap.get(key);
    if (!current || query.impressions > current.impressions) queryMap.set(key, query);
  });
  const intents = new Set(["informational", "commercial", "comparison", "transactional", "navigational"]);
  const searchIntent = cleanLine(raw.searchIntent).toLowerCase();

  const internalLinks = arrayOfObjects(raw.internalLinks).flatMap((item) => {
    const articleId = cleanLine(item.articleId);
    const article = articleMap.get(articleId);
    if (!article || article.id === input.sourceArticleId) return [];
    return [{
      articleId,
      articleTitle: article.title,
      targetUrl: articleUrl(article),
      anchorIdea: cleanLine(item.anchorIdea).slice(0, 120),
      reason: cleanLine(item.reason).slice(0, 400),
    }];
  }).slice(0, 8);

  const productPlacements = arrayOfObjects(raw.productPlacements).flatMap((item) => {
    const productId = cleanLine(item.productId);
    const product = productMap.get(productId);
    if (!product) return [];
    return [{
      productId,
      productTitle: product.title,
      productUrl: `/products/${product.handle}`,
      section: cleanLine(item.section).slice(0, 200),
      reason: cleanLine(item.reason).slice(0, 400),
    }];
  }).slice(0, 6);

  const cannibalizationRisks = arrayOfObjects(raw.cannibalizationRisks).flatMap((item) => {
    const articleId = cleanLine(item.articleId);
    const article = articleMap.get(articleId);
    if (!article || article.id === input.sourceArticleId) return [];
    return [{
      articleId,
      articleTitle: article.title,
      reason: cleanLine(item.reason).slice(0, 400),
      action: cleanLine(item.action).slice(0, 300),
    }];
  }).slice(0, 8);

  const sourceQueries = arrayOfObjects(raw.sourceQueries).flatMap((item) => {
    const query = cleanLine(item.query);
    const actual = queryMap.get(query.toLowerCase());
    if (!actual) return [];
    return [{
      query: actual.query,
      clicks: actual.clicks,
      impressions: actual.impressions,
      ctr: actual.ctr,
      position: actual.position,
      rationale: cleanLine(item.rationale).slice(0, 300),
    }];
  }).slice(0, 12);

  const outline = arrayOfObjects(raw.outline).flatMap((item) => {
    const level = cleanLine(item.level).toLowerCase();
    const heading = cleanLine(item.heading).slice(0, 200);
    if (!["h2", "h3"].includes(level) || !heading) return [];
    return [{ level: level as "h2" | "h3", heading, purpose: cleanLine(item.purpose).slice(0, 400) }];
  }).slice(0, 20);
  if (!outline.length) throw new Error("9Router returned no usable content outline");

  return {
    title: cleanLine(raw.title).slice(0, 255) || input.title.slice(0, 255),
    searchIntent: intents.has(searchIntent) ? searchIntent as AiContentBrief["searchIntent"] : "informational",
    audience: cleanLine(raw.audience).slice(0, 500) || input.audience.slice(0, 500),
    objective: cleanLine(raw.objective).slice(0, 500) || input.objective.slice(0, 500),
    contentAngle: cleanLine(raw.contentAngle).slice(0, 700),
    primaryKeyword: cleanLine(raw.primaryKeyword).slice(0, 200) || input.seedKeyword.slice(0, 200),
    secondaryKeywords: stringArray(raw.secondaryKeywords, 12, 120),
    entities: stringArray(raw.entities, 20, 120),
    outline,
    questions: stringArray(raw.questions, 15, 300),
    internalLinks: uniqueBy(internalLinks, (item) => item.articleId),
    productPlacements: uniqueBy(productPlacements, (item) => item.productId),
    cannibalizationRisks: uniqueBy(cannibalizationRisks, (item) => item.articleId),
    sourceQueries: uniqueBy(sourceQueries, (item) => item.query.toLowerCase()),
  };
}

function contentBriefSchema() {
  const stringArray = (maxItems: number) => ({ type: "array", maxItems, items: { type: "string" } });
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "searchIntent", "audience", "objective", "contentAngle", "primaryKeyword", "secondaryKeywords", "entities", "outline", "questions", "internalLinks", "productPlacements", "cannibalizationRisks", "sourceQueries"],
    properties: {
      title: { type: "string" },
      searchIntent: { type: "string", enum: ["informational", "commercial", "comparison", "transactional", "navigational"] },
      audience: { type: "string" },
      objective: { type: "string" },
      contentAngle: { type: "string" },
      primaryKeyword: { type: "string" },
      secondaryKeywords: stringArray(12),
      entities: stringArray(20),
      outline: {
        type: "array", minItems: 1, maxItems: 20, items: {
          type: "object", additionalProperties: false, required: ["level", "heading", "purpose"],
          properties: { level: { type: "string", enum: ["h2", "h3"] }, heading: { type: "string" }, purpose: { type: "string" } },
        },
      },
      questions: stringArray(15),
      internalLinks: resourceArray(["articleId", "anchorIdea", "reason"], { articleId: { type: "string" }, anchorIdea: { type: "string" }, reason: { type: "string" } }, 8),
      productPlacements: resourceArray(["productId", "section", "reason"], { productId: { type: "string" }, section: { type: "string" }, reason: { type: "string" } }, 6),
      cannibalizationRisks: resourceArray(["articleId", "reason", "action"], { articleId: { type: "string" }, reason: { type: "string" }, action: { type: "string" } }, 8),
      sourceQueries: resourceArray(["query", "rationale"], { query: { type: "string" }, rationale: { type: "string" } }, 12),
    },
  };
}

function resourceArray(required: string[], properties: Record<string, unknown>, maxItems: number) {
  return { type: "array", maxItems, items: { type: "object", additionalProperties: false, required, properties } };
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("9Router returned invalid JSON");
  return parsed;
}

function articleUrl(article: { blogHandle: string; handle: string }) {
  return `/blogs/${article.blogHandle}/${article.handle}`.toLowerCase();
}
function visibleText(value: string) { return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim(); }
function cleanLine(value: unknown) { return typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : ""; }
function arrayOfObjects(value: unknown) { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : []; }
function stringArray(value: unknown, maxItems: number, maxLength: number) {
  return Array.isArray(value) ? [...new Set(value.map(cleanLine).filter(Boolean))].slice(0, maxItems).map((item) => item.slice(0, maxLength)) : [];
}
function uniqueBy<T>(items: T[], key: (item: T) => string) { return [...new Map(items.map((item) => [key(item), item])).values()]; }
