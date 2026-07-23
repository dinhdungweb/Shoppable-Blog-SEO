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

export async function generateAiImageAltSuggestions(input: { candidates: ImageSeoCandidate[] }) {
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

  const response = await fetchNineRouter(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      stream: false,
      ...getNineRouterGenerationOptions(model, 0.2),
      response_format: {
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
      messages: [
        {
          role: "system",
          content: [
            "You are an accessibility-focused ecommerce image alt editor.",
            "Return one suggestion for every supplied image ID when possible.",
            "Use the language of the article context.",
            "Describe only details supported by the current alt, article context, article title, or meaningful image filename.",
            "Do not guess colors, materials, people, brands, product variants, prices, claims, text inside the image, or visual details that are not supplied.",
            "Alt text must communicate the image's useful purpose in its immediate context, not summarize the full article.",
            "Keep descriptive alt text natural and concise, at most 160 characters. Do not begin with 'image of' or 'picture of' and do not keyword-stuff.",
            "For decorative images, altText must be an empty string.",
            "Never create or modify an ID, URL, filename, image source, width, height, or any other HTML attribute.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
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
          }),
        },
      ],
    }),
  }, timeoutMs);

  if (!response.ok) throw await createNineRouterResponseError(response, "bulk image SEO");
  const payload: any = await readNineRouterJson(response);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("9Router returned no message content");
  const parsed = parseObject(content);
  const allowed = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const suggestions = arrayOfObjects(parsed.suggestions).flatMap((raw) => {
    const id = clean(raw.id, 500);
    const candidate = allowed.get(id);
    if (!candidate) return [];
    let altText: string;
    try {
      altText = validateProposedAlt(clean(raw.altText, 300), candidate.decorative);
    } catch {
      return [];
    }
    if (altText === candidate.currentAlt) return [];
    return [{
      id,
      altText,
      reason: clean(raw.reason, 400) || (candidate.decorative ? "Keeps a decorative image silent for assistive technology." : "Adds concise context for assistive technology."),
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
  const parsed = JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("9Router returned invalid JSON");
  return parsed;
}

function arrayOfObjects(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
}
