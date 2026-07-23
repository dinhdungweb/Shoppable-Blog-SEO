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
  const deadlineAt = Date.now() + timeoutMs;

  const systemMessage = [
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
    "Return only one JSON object.",
  ].join(" ");
  const userMessage = JSON.stringify({
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
  });
  const requestContent = async ({
    responseFormat,
    system,
    label,
  }: {
    responseFormat?: Record<string, unknown>;
    system: string;
    label: string;
  }) => {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs < 1_000) throw new Error("9Router internal link review exhausted its retry time budget");
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
        ...(responseFormat ? { response_format: responseFormat } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMessage },
        ],
      }),
    }, Math.min(timeoutMs, remainingMs));
    if (!response.ok) throw await createNineRouterResponseError(response, label);
    const payload: any = await readNineRouterJson(response);
    const rawContent = payload?.choices?.[0]?.message?.content;
    const content = typeof rawContent === "string"
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent.map((part) => typeof part === "string" ? part : typeof part?.text === "string" ? part.text : "").join("")
        : "";
    if (!content) throw new Error("9Router returned no message content");
    return content;
  };

  const exactFormat = 'The root key must be recommendations. Each item must use {"suggestionId":"one supplied candidate ID","relevanceScore":0,"explanation":"short reason","anchorOptions":["exact source phrase"],"warnings":[]}. Begin with { and end with }.';
  const attempts: Array<{ responseFormat?: Record<string, unknown>; system: string; label: string }> = [
    {
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "internal_link_recommendations",
          strict: true,
          schema: internalLinkResponseSchema(),
        },
      },
      system: systemMessage,
      label: "internal link review",
    },
    {
      responseFormat: { type: "json_object" },
      system: `${systemMessage} This is a JSON object retry. ${exactFormat}`,
      label: "internal link JSON retry",
    },
    {
      system: `${systemMessage} Your API may not support response_format, so follow the JSON format in the prompt itself. ${exactFormat}`,
      label: "internal link plain JSON fallback",
    },
  ];
  let recommendations: Array<Record<string, unknown>> | null = null;
  let lastError: unknown = null;
  let receivedContent = false;
  for (const attempt of attempts) {
    try {
      const content = await requestContent(attempt);
      receivedContent = true;
      recommendations = normalizeRecommendationPayload(parseJsonObject(content));
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!recommendations && receivedContent) {
    const repairSystem = `${systemMessage} Repair your previous output. ${exactFormat} Do not add Markdown, commentary, URLs or candidate IDs that were not supplied.`;
    for (const responseFormat of [{ type: "json_object" } as Record<string, unknown>, undefined]) {
      try {
        const content = await requestContent({
          responseFormat,
          system: repairSystem,
          label: responseFormat ? "internal link recommendation repair" : "internal link plain recommendation repair",
        });
        recommendations = normalizeRecommendationPayload(parseJsonObject(content));
        break;
      } catch (error) {
        lastError = error;
      }
    }
  }
  if (!recommendations) {
    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`9Router returned invalid internal link recommendations after JSON fallback and repair: ${detail}`);
  }
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

function internalLinkResponseSchema() {
  return {
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
  };
}

function parseJsonObject(value: string): Record<string, unknown> {
  const normalized = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch (directError) {
    const extracted = extractFirstJsonValue(normalized);
    if (!extracted) throw directError;
    parsed = JSON.parse(extracted);
  }
  if (Array.isArray(parsed)) return { recommendations: parsed };
  if (!parsed || typeof parsed !== "object") throw new Error("9Router returned invalid JSON");
  return parsed as Record<string, unknown>;
}

function extractFirstJsonValue(value: string) {
  const objectStart = value.indexOf("{");
  const arrayStart = value.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (!starts.length) return "";
  const start = Math.min(...starts);
  const opening = value[start];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === opening) depth += 1;
    if (character === closing) {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }
  return "";
}

function normalizeRecommendationPayload(raw: Record<string, unknown>) {
  const nestedData = raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)
    ? raw.data as Record<string, unknown>
    : null;
  const source = raw.recommendations
    ?? raw.suggestions
    ?? raw.links
    ?? raw.internalLinks
    ?? raw.internal_links
    ?? nestedData?.recommendations
    ?? nestedData?.suggestions;
  if (!Array.isArray(source)) throw new Error("9Router returned no recommendation array");
  if (!source.length) return [];

  const normalized = source.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    const suggestionId = cleanLine(item.suggestionId ?? item.suggestion_id ?? item.candidateId ?? item.candidate_id ?? item.id);
    if (!suggestionId) return [];
    const rawAnchors = item.anchorOptions
      ?? item.anchor_options
      ?? item.anchors
      ?? item.proposedAnchors
      ?? item.proposed_anchors
      ?? item.anchorTexts
      ?? item.anchor_texts
      ?? item.anchorText
      ?? item.anchor;
    const anchorOptions = Array.isArray(rawAnchors)
      ? rawAnchors.map(cleanAnchor).filter(Boolean)
      : [cleanAnchor(rawAnchors)].filter(Boolean);
    const rawWarnings = item.warnings ?? item.risks ?? item.flags;
    const warnings = Array.isArray(rawWarnings)
      ? rawWarnings.map(cleanLine).filter(Boolean)
      : [cleanLine(rawWarnings)].filter(Boolean);
    return [{
      suggestionId,
      relevanceScore: item.relevanceScore ?? item.relevance_score ?? item.score ?? item.confidence ?? 0,
      explanation: cleanLine(item.explanation ?? item.reason ?? item.rationale ?? item.why),
      anchorOptions,
      warnings,
    }];
  }).slice(0, MAX_CANDIDATES);
  if (!normalized.length) throw new Error("9Router returned malformed internal link recommendations");
  return normalized;
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
