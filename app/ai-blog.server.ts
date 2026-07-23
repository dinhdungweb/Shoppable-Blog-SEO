import { isNineRouterConfigured } from "./ai-seo.server";
import { createNineRouterResponseError, getNineRouterGenerationOptions, readNineRouterJson } from "./nine-router.server";

export type AiWritingMode = "draft" | "improve" | "expand" | "shorten";

export type AiBlogDraft = {
  bodyHtml: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
};

type AiBlogInput = {
  mode: AiWritingMode;
  title: string;
  body: string;
  excerpt: string;
  focusKeyword: string;
  instruction: string;
};

const MAX_ARTICLE_CHARS = 12_000;
const MAX_INSTRUCTION_CHARS = 1_200;
const MAX_OUTPUT_CHARS = 50_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const PRODUCT_MARKER_PATTERN = /\[\[SBS_PRODUCTS(?::[a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+)?)?\]\]/g;

const MODE_INSTRUCTIONS: Record<AiWritingMode, string> = {
  draft: "Create a complete, useful article draft from the title and user instruction.",
  improve: "Improve clarity, flow, usefulness, and readability while preserving the meaning and factual claims.",
  expand: "Expand the article with useful detail and clearer structure without padding or invented facts.",
  shorten: "Make the article substantially more concise while retaining its essential information.",
};

export function isAiWritingMode(value: string): value is AiWritingMode {
  return value === "draft" || value === "improve" || value === "expand" || value === "shorten";
}

export async function generateAiBlogDraft(input: AiBlogInput): Promise<AiBlogDraft> {
  if (!isNineRouterConfigured()) throw new Error("9Router is not configured");

  const baseUrl = process.env.NINE_ROUTER_BASE_URL!.trim().replace(/\/+$/, "");
  const apiKey = process.env.NINE_ROUTER_API_KEY!.trim();
  const model = process.env.NINE_ROUTER_MODEL!.trim();
  const timeoutValue = Number(process.env.NINE_ROUTER_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutValue) && timeoutValue >= 1_000
    ? Math.min(timeoutValue, 60_000)
    : DEFAULT_TIMEOUT_MS;
  const currentBody = input.body.slice(0, MAX_ARTICLE_CHARS);
  const requiredProductMarkers = currentBody.match(PRODUCT_MARKER_PATTERN) || [];

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      stream: false,
      ...getNineRouterGenerationOptions(model, input.mode === "draft" ? 0.5 : 0.25),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You are an expert ecommerce blog editor.",
            "Return only one JSON object with string fields: bodyHtml, excerpt, metaTitle, metaDescription.",
            "Preserve the language used by the title and current article.",
            "bodyHtml must be a clean HTML fragment using only p, h2, h3, ul, ol, li, strong, em, blockquote, and a tags.",
            "Do not include an h1, scripts, styles, images, iframes, markdown fences, or inline CSS.",
            "Do not invent products, prices, statistics, testimonials, guarantees, links, or factual claims.",
            "Preserve every [[SBS_PRODUCTS...]] marker exactly, including its position near relevant content.",
            "excerpt must be a plain-text summary. metaTitle must be at most 70 characters and metaDescription at most 160 characters.",
            MODE_INSTRUCTIONS[input.mode],
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            title: input.title.slice(0, 300),
            focusKeyword: input.focusKeyword.slice(0, 300),
            instruction: input.instruction.slice(0, MAX_INSTRUCTION_CHARS),
            currentExcerpt: input.excerpt.slice(0, 1_000),
            currentBodyHtml: currentBody,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw await createNineRouterResponseError(response, "blog draft");
  }

  const payload: any = await readNineRouterJson(response);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("9Router returned no message content");
  const parsed = parseJsonObject(content);
  const bodyHtml = stringValue(parsed.bodyHtml).trim();
  if (!bodyHtml) throw new Error("9Router returned an empty article draft");
  if (bodyHtml.length > MAX_OUTPUT_CHARS) throw new Error("9Router returned an article draft that is too large");
  if (/<\s*\/?\s*(script|style|iframe|object|embed|svg|form|input|button)\b/i.test(bodyHtml)) {
    throw new Error("9Router returned unsafe article markup");
  }

  const returnedProductMarkers = bodyHtml.match(PRODUCT_MARKER_PATTERN) || [];
  if (!sameStringMultiset(requiredProductMarkers, returnedProductMarkers)) {
    throw new Error("9Router did not preserve the article product blocks");
  }

  return {
    bodyHtml,
    excerpt: truncateAtWord(cleanLine(parsed.excerpt), 400),
    metaTitle: truncateAtWord(cleanLine(parsed.metaTitle), 70),
    metaDescription: truncateAtWord(cleanLine(parsed.metaDescription), 160),
  };
}

function parseJsonObject(value: string): Record<string, unknown> {
  const normalized = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(normalized);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("9Router returned invalid JSON");
  }
  return parsed;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function cleanLine(value: unknown) {
  return stringValue(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function truncateAtWord(value: string, limit: number) {
  if (value.length <= limit) return value;
  const candidate = value.slice(0, limit + 1);
  const boundary = candidate.lastIndexOf(" ");
  return candidate.slice(0, boundary >= Math.floor(limit * 0.7) ? boundary : limit).replace(/[\s,;:.-]+$/g, "");
}

function sameStringMultiset(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const sortedRight = [...right].sort();
  return [...left].sort().every((value, index) => value === sortedRight[index]);
}
