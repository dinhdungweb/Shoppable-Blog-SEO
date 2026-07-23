import { isNineRouterConfigured } from "./ai-seo.server";
import { createNineRouterResponseError, fetchNineRouter, getNineRouterGenerationOptions, readNineRouterJson } from "./nine-router.server";
import { stripInvalidProductMarkers } from "./content-brief-products";

export type AiWritingMode = "draft" | "improve" | "expand" | "shorten";

export type AiBlogDraft = {
  title: string;
  bodyHtml: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  suggestedLinks: AiBlogSuggestedLink[];
};

export type AiBlogSuggestedLink = {
  url: string;
  title: string;
  anchorText: string;
  reason: string;
};

type AiBlogInput = {
  mode: AiWritingMode;
  title: string;
  body: string;
  excerpt: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  instruction: string;
};

const MAX_ARTICLE_CHARS = 12_000;
const MAX_INSTRUCTION_CHARS = 12_000;
const MAX_OUTPUT_CHARS = 50_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const PRODUCT_MARKER_PATTERN = /\[\[SBS_PRODUCTS(?::[a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+)?)?\]\]/g;
const LINK_PATTERN = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

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

  const response = await fetchNineRouter(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: false,
      ...getNineRouterGenerationOptions(model, input.mode === "draft" ? 0.5 : 0.25),
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "seo_article_draft",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["title", "bodyHtml", "excerpt", "metaTitle", "metaDescription", "suggestedLinks"],
            properties: {
              title: { type: "string" },
              bodyHtml: { type: "string" },
              excerpt: { type: "string" },
              metaTitle: { type: "string" },
              metaDescription: { type: "string" },
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
      messages: [
        {
          role: "system",
          content: [
            "You are an expert ecommerce blog editor.",
            "Return only one JSON object with title, bodyHtml, excerpt, metaTitle, metaDescription, and suggestedLinks.",
            "Preserve the language used by the title and current article.",
            "Write people-first SEO content around the primary keyword and use secondary keywords only where they fit naturally. Satisfy likely search intent, use a clear heading structure, give the useful answer early, and avoid keyword stuffing.",
            "bodyHtml must be a clean HTML fragment using only p, h2, h3, ul, ol, li, strong, em, blockquote, and a tags.",
            "Do not include an h1, scripts, styles, images, iframes, markdown fences, or inline CSS.",
            "Do not invent products, prices, statistics, testimonials, guarantees, or factual claims.",
            "Do not add new links inside bodyHtml. Preserve every existing href exactly. Put up to 3 optional authoritative HTTPS source suggestions in suggestedLinks with url, title, anchorText, and reason. Prefer primary sources and return an empty array when no source is confidently relevant.",
            "Preserve every existing [[SBS_PRODUCTS...]] marker exactly, including its position near relevant content. Never create a new SBS_PRODUCTS marker and never put a product title inside one; the application manages product blocks separately.",
            "title must be at most 255 characters. excerpt must be a plain-text summary. metaTitle must be at most 70 characters and metaDescription at most 160 characters.",
            MODE_INSTRUCTIONS[input.mode],
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            title: input.title.slice(0, 300),
            primaryKeyword: input.primaryKeyword.slice(0, 200),
            secondaryKeywords: input.secondaryKeywords.slice(0, 12).map((keyword) => keyword.slice(0, 100)),
            instruction: input.instruction.slice(0, MAX_INSTRUCTION_CHARS),
            currentExcerpt: input.excerpt.slice(0, 1_000),
            currentBodyHtml: currentBody,
          }),
        },
      ],
    }),
  }, timeoutMs);

  if (!response.ok) {
    throw await createNineRouterResponseError(response, "blog draft");
  }

  const payload: any = await readNineRouterJson(response);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("9Router returned no message content");
  const parsed = parseJsonObject(content);
  let bodyHtml = stripInvalidProductMarkers(stringValue(parsed.bodyHtml).trim());
  if (!bodyHtml) throw new Error("9Router returned an empty article draft");
  if (bodyHtml.length > MAX_OUTPUT_CHARS) throw new Error("9Router returned an article draft that is too large");
  if (/<\s*\/?\s*(script|style|iframe|object|embed|svg|form|input|button)\b/i.test(bodyHtml)
    || /\son[a-z]+\s*=/i.test(bodyHtml)
    || /\sstyle\s*=/i.test(bodyHtml)
    || /(?:javascript|data|vbscript)\s*:/i.test(bodyHtml)) {
    throw new Error("9Router returned unsafe article markup");
  }

  const returnedProductMarkers = bodyHtml.match(PRODUCT_MARKER_PATTERN) || [];
  if (!sameStringMultiset(requiredProductMarkers, returnedProductMarkers)) {
    throw new Error("9Router did not preserve the article product blocks");
  }
  bodyHtml = restoreExistingLinks(currentBody, bodyHtml);

  return {
    title: truncateAtWord(cleanLine(parsed.title), 255) || input.title,
    bodyHtml,
    excerpt: truncateAtWord(cleanLine(parsed.excerpt), 400),
    metaTitle: truncateAtWord(cleanLine(parsed.metaTitle), 70),
    metaDescription: truncateAtWord(cleanLine(parsed.metaDescription), 160),
    suggestedLinks: parseSuggestedLinks(parsed.suggestedLinks),
  };
}

function parseSuggestedLinks(value: unknown): AiBlogSuggestedLink[] {
  if (!Array.isArray(value)) return [];
  const links: AiBlogSuggestedLink[] = [];
  const seen = new Set<string>();
  for (const raw of value.slice(0, 3)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    try {
      const parsed = new URL(stringValue(item.url).trim());
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) continue;
      const hostname = parsed.hostname.toLowerCase();
      if (hostname === "localhost" || hostname.endsWith(".local") || /^(?:10|127|169\.254|192\.168)\./.test(hostname)) continue;
      parsed.hash = "";
      const url = parsed.toString();
      if (seen.has(url)) continue;
      links.push({
        url,
        title: cleanLine(item.title).slice(0, 200) || hostname,
        anchorText: cleanLine(item.anchorText).slice(0, 160),
        reason: cleanLine(item.reason).slice(0, 300),
      });
      seen.add(url);
    } catch {
      continue;
    }
  }
  return links;
}

function extractLinks(html: string) {
  return [...html.matchAll(LINK_PATTERN)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}

function restoreExistingLinks(original: string, proposed: string) {
  const originalLinks = extractLinks(original);
  const proposedLinks = extractLinks(proposed);
  if (!originalLinks.length) {
    return proposed.replace(/<a\b[^>]*>/gi, "").replace(/<\/a\s*>/gi, "");
  }
  if (originalLinks.length !== proposedLinks.length) {
    throw new Error("9Router did not preserve the article links");
  }
  let index = 0;
  return proposed.replace(/<a\b([^>]*)>/gi, (tag, attributes: string) => {
    const href = originalLinks[index++];
    const withoutHref = attributes.replace(/\shref\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, "");
    return `<a${withoutHref} href="${escapeAttribute(href)}">`;
  });
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
