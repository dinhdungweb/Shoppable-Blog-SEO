import { isNineRouterConfigured } from "./ai-seo.server";
import {
  hasUnlinkedAnchor,
  previewApprovedLink,
  type LinkArticle,
  type LinkSuggestion,
} from "./internal-linking";
import {
  createNineRouterResponseError,
  fetchNineRouter,
  getNineRouterGenerationOptions,
  readNineRouterJson,
} from "./nine-router.server";

type AiInternalLinkInput = {
  articles: LinkArticle[];
  suggestions: LinkSuggestion[];
};

const MAX_CANDIDATES = 24;
const MAX_SOURCES = 8;
const MAX_SOURCE_CONTEXT = 6_000;
const MAX_TARGET_CONTEXT = 1_500;
const DEFAULT_TIMEOUT_MS = 45_000;
const AI_WARNING_TYPES = new Set(["possible_cannibalization", "anchor_overuse", "ambiguous_anchor"]);

export async function generateAiInternalLinkSuggestions(input: AiInternalLinkInput): Promise<LinkSuggestion[]> {
  if (!isNineRouterConfigured()) throw new Error("9Router is not configured");

  const articles = new Map(input.articles.map((article) => [article.id, article]));
  const candidates = input.suggestions
    .filter((suggestion) => articles.has(suggestion.sourceId) && articles.has(suggestion.targetId))
    .slice(0, MAX_CANDIDATES);
  if (!candidates.length) throw new Error("Run the internal link analysis before asking AI to review suggestions");

  const sourceIds = [...new Set(candidates.map((suggestion) => suggestion.sourceId))].slice(0, MAX_SOURCES);
  const allowedSources = new Set(sourceIds);
  const scopedCandidates = candidates.filter((suggestion) => allowedSources.has(suggestion.sourceId));
  const candidateMap = new Map(scopedCandidates.map((suggestion) => [suggestion.id, suggestion]));

  const baseUrl = process.env.NINE_ROUTER_BASE_URL!.trim().replace(/\/+$/, "");
  const apiKey = process.env.NINE_ROUTER_API_KEY!.trim();
  const model = process.env.NINE_ROUTER_MODEL!.trim();
  const timeoutValue = Number(process.env.NINE_ROUTER_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutValue) && timeoutValue >= 1_000
    ? Math.min(timeoutValue, 60_000)
    : DEFAULT_TIMEOUT_MS;

  const response = await fetchNineRouter(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: false,
      ...getNineRouterGenerationOptions(model, 0.15),
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "internal_link_recommendations",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["recommendations"],
            properties: {
              recommendations: {
                type: "array",
                maxItems: MAX_CANDIDATES,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["suggestionId", "relevanceScore", "explanation", "anchorOptions", "warnings"],
                  properties: {
                    suggestionId: { type: "string" },
                    relevanceScore: { type: "integer", minimum: 0, maximum: 100 },
                    explanation: { type: "string" },
                    anchorOptions: {
                      type: "array",
                      minItems: 1,
                      maxItems: 3,
                      items: { type: "string" },
                    },
                    warnings: {
                      type: "array",
                      maxItems: 3,
                      items: {
                        type: "string",
                        enum: ["possible_cannibalization", "anchor_overuse", "ambiguous_anchor"],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      messages: [
        {
          role: "system",
          content: [
            "You are an ecommerce internal linking editor.",
            "Review only the supplied Shopify article pairs and return only pairs where the destination adds genuinely useful context for the reader.",
            "Never invent an article, ID, URL, product, fact, or destination.",
            "For each accepted pair, explain the topical and reader benefit in one short sentence without promising ranking gains.",
            "Each anchor option must be a short, natural phrase copied verbatim from the supplied source text.",
            "Do not suggest generic anchors such as click here, read more, this article, or learn more.",
            "Prefer the sentence where the destination resolves a question or expands a closely related concept.",
            "Flag possible_cannibalization when source and target appear to satisfy the same primary search intent instead of a complementary intent.",
            "Flag anchor_overuse when a proposed phrase appears in the supplied siteAnchorUsage list, and ambiguous_anchor when the phrase could describe several destinations.",
            "Reject weak pairs even when their keyword overlap score is high.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            siteAnchorUsage: repeatedAnchorUsage(input.articles),
            sources: sourceIds.map((sourceId) => {
              const source = articles.get(sourceId)!;
              return {
                sourceId,
                title: source.title,
                sourceText: visibleText(source.body).slice(0, MAX_SOURCE_CONTEXT),
                candidates: scopedCandidates
                  .filter((suggestion) => suggestion.sourceId === sourceId)
                  .map((suggestion) => {
                    const target = articles.get(suggestion.targetId)!;
                    return {
                      suggestionId: suggestion.id,
                      targetTitle: target.title,
                      targetSummary: visibleText(target.body).slice(0, MAX_TARGET_CONTEXT),
                      deterministicTopicScore: suggestion.score,
                    };
                  }),
              };
            }),
          }),
        },
      ],
    }),
  }, timeoutMs);

  if (!response.ok) throw await createNineRouterResponseError(response, "internal link review");
  const payload: any = await readNineRouterJson(response);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("9Router returned no message content");

  const parsed = parseJsonObject(content);
  const recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
  const enriched: LinkSuggestion[] = [];
  const seen = new Set<string>();

  for (const raw of recommendations) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const suggestionId = cleanLine(item.suggestionId);
    const candidate = candidateMap.get(suggestionId);
    const source = candidate ? articles.get(candidate.sourceId) : null;
    if (!candidate || !source || seen.has(suggestionId)) continue;

    const proposedAnchors = Array.isArray(item.anchorOptions)
      ? item.anchorOptions.map(cleanAnchor).filter(Boolean)
      : [];
    const anchorOptions = [...new Set([...proposedAnchors, cleanAnchor(candidate.anchorText)])]
      .filter((anchor) => hasUnlinkedAnchor(source.body, anchor))
      .slice(0, 3);
    if (!anchorOptions.length) continue;

    const anchorText = anchorOptions[0];
    const preview = previewApprovedLink(source.body, anchorText, candidate.targetUrl);
    if (!preview.insertedInContext) continue;
    const aiScore = boundedScore(item.relevanceScore);
    if (aiScore < 45) continue;
    const aiWarnings = Array.isArray(item.warnings)
      ? [...new Set(item.warnings.map(cleanLine).filter((warning) => AI_WARNING_TYPES.has(warning)))]
        .slice(0, 3) as LinkSuggestion["aiWarnings"]
      : [];
    const anchorPreviews = anchorOptions.map((anchor) => {
      const anchorPreview = previewApprovedLink(source.body, anchor, candidate.targetUrl);
      return { anchorText: anchor, before: anchorPreview.before, after: anchorPreview.after };
    });

    enriched.push({
      ...candidate,
      anchorText,
      aiScore,
      aiExplanation: cleanLine(item.explanation).slice(0, 400) || "The destination expands a closely related point for the reader.",
      aiWarnings,
      anchorOptions,
      anchorPreviews,
      previewBefore: preview.before,
      previewAfter: preview.after,
      insertedInContext: true,
    });
    seen.add(suggestionId);
  }

  if (!enriched.length) throw new Error("AI found no safe, context-matched internal link suggestions");
  return enriched.sort((left, right) => (right.aiScore || 0) - (left.aiScore || 0));
}

function parseJsonObject(value: string): Record<string, unknown> {
  const normalized = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(normalized);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("9Router returned invalid JSON");
  return parsed;
}

function visibleText(value: string) {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanAnchor(value: unknown) {
  return cleanLine(value).replace(/[<>]/g, "").slice(0, 120);
}

function cleanLine(value: unknown) {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "";
}

function boundedScore(value: unknown) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
}

function repeatedAnchorUsage(articles: LinkArticle[]) {
  const usage = new Map<string, { uses: number; destinations: Set<string> }>();
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const article of articles) {
    for (const match of article.body.matchAll(pattern)) {
      const anchor = visibleText(match[2]).toLowerCase();
      if (!anchor) continue;
      const current = usage.get(anchor) || { uses: 0, destinations: new Set<string>() };
      current.uses += 1;
      current.destinations.add(match[1].toLowerCase());
      usage.set(anchor, current);
    }
  }
  return [...usage.entries()]
    .filter(([, value]) => value.uses >= 3 || value.destinations.size > 1)
    .sort((left, right) => right[1].uses - left[1].uses)
    .slice(0, 30)
    .map(([anchor, value]) => ({ anchor, uses: value.uses, destinations: value.destinations.size }));
}
