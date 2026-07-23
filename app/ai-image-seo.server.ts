import { isNineRouterConfigured } from "./ai-seo.server";
import type { ImageSeoCandidate, ImageSeoIssue } from "./image-seo";
import { validateProposedAlt } from "./image-seo";
import {
  createNineRouterResponseError,
  fetchNineRouter,
  getNineRouterGenerationOptions,
  readNineRouterJson,
} from "./nine-router.server";

export type AiImageAltSuggestion = {
  id: string;
  altText: string;
  reason: string;
  issues: ImageSeoIssue[];
};

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_CANDIDATES = 15;

export async function generateAiImageAltSuggestions(input: {
  candidates: ImageSeoCandidate[];
  maxDurationMs?: number;
}) {
  if (!isNineRouterConfigured()) throw new Error("9Router is not configured");
  const candidates = input.candidates.slice(0, MAX_CANDIDATES);
  if (!candidates.length) throw new Error("No image candidates were supplied");

  const baseUrl = process.env.NINE_ROUTER_BASE_URL!.trim().replace(/\/+$/, "");
  const apiKey = process.env.NINE_ROUTER_API_KEY!.trim();
  const model = process.env.NINE_ROUTER_MODEL!.trim();
  const configuredTimeout = Number(process.env.NINE_ROUTER_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout >= 1_000
    ? Math.min(configuredTimeout, 60_000)
    : DEFAULT_TIMEOUT_MS;
  const requestedBudget = Number(input.maxDurationMs);
  const totalBudgetMs = Number.isFinite(requestedBudget) && requestedBudget >= 1_000
    ? Math.min(requestedBudget, timeoutMs * 2, 60_000)
    : Math.min(timeoutMs * 2, 60_000);
  const deadlineAt = Date.now() + totalBudgetMs;
  const systemMessage = [
    "You are an accessibility-focused ecommerce image alt editor.",
    "Return one suggestion for every supplied image ID when possible.",
    "Use the language of the article context.",
    "Describe only details supported by the current alt, article context, article title, or meaningful image filename.",
    "Do not guess colors, materials, people, brands, product variants, prices, claims, text inside the image, or visual details that are not supplied.",
    "Alt text must communicate the image's useful purpose in its immediate context, not summarize the full article.",
    "Keep descriptive alt text natural and concise, at most 160 characters. Do not begin with 'image of' or 'picture of' and do not keyword-stuff.",
    "For decorative images, altText must be an empty string.",
    "Never create or modify an ID, URL, filename, image source, width, height, or any other HTML attribute.",
  ].join(" ");
  const userMessage = JSON.stringify({
    images: candidates.map((candidate) => ({
      id: candidate.id,
      kind: candidate.kind,
      currentAlt: candidate.currentAlt,
      decorative: candidate.decorative,
      issues: candidate.issues,
      articleTitle: candidate.articleTitle,
      imageFilename: filename(candidate.src),
      immediateContext: candidate.context.slice(0, 1_200),
    })),
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
    if (remainingMs < 1_000) throw new Error("9Router image SEO exhausted its JSON retry time budget");
    const response = await fetchNineRouter(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        stream: false,
        ...getNineRouterGenerationOptions(model, 0.2),
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
        : rawContent && typeof rawContent === "object"
          ? JSON.stringify(rawContent)
          : "";
    if (!content) throw new Error("9Router returned no message content");
    return content;
  };
  const exactFormat = [
    'Return exactly one JSON object whose root key is "suggestions".',
    'Every item must use {"id":"one supplied image ID","altText":"concise alt text or empty for decorative","reason":"short explanation"}.',
    "Do not return Markdown, commentary, URLs, or IDs that were not supplied. Begin with { and end with }.",
  ].join(" ");
  const attempts: Array<{ responseFormat?: Record<string, unknown>; system: string; label: string }> = [
    {
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "bulk_image_alt_suggestions",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["suggestions"],
            properties: {
              suggestions: {
                type: "array",
                maxItems: MAX_CANDIDATES,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "altText", "reason"],
                  properties: {
                    id: { type: "string" },
                    altText: { type: "string" },
                    reason: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
      system: systemMessage,
      label: "bulk image SEO",
    },
    {
      responseFormat: { type: "json_object" },
      system: `${systemMessage} This is a JSON object retry. ${exactFormat}`,
      label: "bulk image SEO JSON retry",
    },
    {
      system: `${systemMessage} Your API may not support response_format, so follow the JSON format in the prompt itself. ${exactFormat}`,
      label: "bulk image SEO plain JSON fallback",
    },
  ];
  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const content = await requestContent(attempt);
      return parseSuggestions(content, candidates);
    } catch (error) {
      lastError = error;
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`9Router returned invalid image alt suggestions after JSON fallback: ${detail}`);
}

function parseSuggestions(content: string, candidates: ImageSeoCandidate[]) {
  const parsed = normalizeSuggestionPayload(parseObject(content));
  const allowed = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const suggestions = parsed.flatMap((raw) => {
    const id = clean(raw.id ?? raw.imageId ?? raw.image_id ?? raw.candidateId ?? raw.candidate_id, 500);
    const candidate = allowed.get(id);
    if (!candidate) return [];
    let altText: string;
    try {
      altText = validateProposedAlt(clean(raw.altText ?? raw.alt_text ?? raw.alt, 300), candidate.decorative);
    } catch {
      return [];
    }
    if (altText === candidate.currentAlt) return [];
    return [{
      id,
      altText,
      reason: clean(raw.reason ?? raw.explanation, 400) || (candidate.decorative ? "Keeps a decorative image silent for assistive technology." : "Adds concise context for assistive technology."),
      issues: candidate.issues,
    }];
  });
  const unique = [...new Map(suggestions.map((suggestion) => [suggestion.id, suggestion])).values()];
  if (!unique.length) throw new Error("9Router returned no usable image alt suggestions");
  return unique;
}

function filename(src: string) {
  try {
    return decodeURIComponent(new URL(src, "https://shop.invalid").pathname.split("/").pop() || "").slice(0, 200);
  } catch {
    return "";
  }
}

function parseObject(value: string): Record<string, unknown> {
  const normalized = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch (directError) {
    const extracted = extractFirstJsonValue(normalized);
    if (!extracted) throw directError;
    parsed = JSON.parse(extracted);
  }
  if (Array.isArray(parsed)) return { suggestions: parsed };
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

function normalizeSuggestionPayload(raw: Record<string, unknown>) {
  const nestedData = raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)
    ? raw.data as Record<string, unknown>
    : null;
  const source = raw.suggestions
    ?? raw.results
    ?? raw.images
    ?? raw.altSuggestions
    ?? raw.alt_suggestions
    ?? nestedData?.suggestions
    ?? nestedData?.results;
  if (!Array.isArray(source)) throw new Error("9Router returned no image suggestion array");
  return arrayOfObjects(source);
}

function arrayOfObjects(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
}
