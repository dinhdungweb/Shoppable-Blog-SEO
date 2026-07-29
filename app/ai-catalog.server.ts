import { isNineRouterConfigured } from "./ai-seo.server";
import {
  createNineRouterResponseError,
  fetchNineRouter,
  getNineRouterGenerationOptions,
  readNineRouterJson,
} from "./nine-router.server";
import type { CatalogResourceType } from "./catalog-seo";

export type AiCatalogMode = "write" | "improve" | "seo";

export type AiCatalogInput = {
  type: CatalogResourceType;
  mode: AiCatalogMode;
  title: string;
  descriptionHtml: string;
  seoTitle: string;
  seoDescription: string;
  focusKeyword: string;
  instruction: string;
  imageAlt: string;
  hasImage: boolean;
  vendor?: string;
  productType?: string;
  tags?: string[];
};

export type AiCatalogDraft = {
  title: string;
  descriptionHtml: string;
  seoTitle: string;
  seoDescription: string;
  imageAlt: string;
  summary: string;
};

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_DESCRIPTION_CHARS = 50_000;
const MAX_INPUT_DESCRIPTION_CHARS = 20_000;
const MAX_INSTRUCTION_CHARS = 4_000;
const LINK_PATTERN = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const PROTECTED_FRAGMENT_PATTERN = /<table\b[^>]*>[\s\S]*?<\/table\s*>|<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>|<video\b[^>]*>[\s\S]*?<\/video\s*>|<img\b[^>]*\/?>/gi;
const ALLOWED_TAGS = new Set([
  "p", "br", "h2", "h3", "h4", "ul", "ol", "li", "strong", "em", "b", "i", "u",
  "blockquote", "a", "div", "span", "img", "iframe", "video", "source", "table", "thead",
  "tbody", "tfoot", "tr", "th", "td",
]);

const MODE_INSTRUCTIONS: Record<AiCatalogMode, string> = {
  write: "Write or complete useful storefront content and optimize the search listing. You may suggest a clearer title.",
  improve: "Improve the existing storefront content for clarity, usefulness, scannability, and natural SEO while preserving its factual meaning.",
  seo: "Optimize only seoTitle and seoDescription. Return title and descriptionHtml unchanged.",
};

export function isAiCatalogMode(value: string): value is AiCatalogMode {
  return value === "write" || value === "improve" || value === "seo";
}

export async function generateAiCatalogDraft(input: AiCatalogInput): Promise<AiCatalogDraft> {
  if (!isNineRouterConfigured()) throw new Error("9Router is not configured");
  if (!input.title.trim()) throw new Error("Add a title before using AI.");

  const baseUrl = process.env.NINE_ROUTER_BASE_URL!.trim().replace(/\/+$/, "");
  const apiKey = process.env.NINE_ROUTER_API_KEY!.trim();
  const model = process.env.NINE_ROUTER_MODEL!.trim();
  const timeoutValue = Number(process.env.NINE_ROUTER_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutValue) && timeoutValue >= 1_000
    ? Math.min(timeoutValue, 60_000)
    : DEFAULT_TIMEOUT_MS;

  const system = [
    `You are an expert ecommerce ${input.type} editor.`,
    "Return one JSON object with title, descriptionHtml, seoTitle, seoDescription, imageAlt, and summary.",
    "Preserve the language used by the supplied resource.",
    "Use only facts present in RESOURCE. Never invent prices, discounts, materials, dimensions, ingredients, compatibility, availability, guarantees, testimonials, product benefits, collection contents, or other claims.",
    input.type === "collection"
      ? "Describe the collection purpose without claiming that it contains specific products unless they are explicitly supplied."
      : "Vendor, product type, and tags are context only; do not turn them into unsupported claims.",
    "descriptionHtml must be a clean HTML fragment. Use p, h2, h3, h4, ul, ol, li, strong, em, and blockquote for new content.",
    "Preserve every existing href and every existing table, image, iframe, and video fragment exactly. Do not add new links or media.",
    "Do not return scripts, styles, event handlers, inline CSS, Markdown, an h1, or a full HTML document.",
    "title must be at most 255 characters, seoTitle at most 70 characters, seoDescription at most 165 characters, and imageAlt at most 255 characters.",
    "When an image exists, improve imageAlt from the supplied resource context. If the current alt text is empty, keep the suggestion conservative and do not invent visual details such as colors, materials, people, or composition.",
    "When no image exists, return imageAlt unchanged.",
    "summary must briefly explain the proposed changes without marketing language.",
    MODE_INSTRUCTIONS[input.mode],
  ].join(" ");
  const user = JSON.stringify({
    RESOURCE: {
      type: input.type,
      title: input.title.slice(0, 255),
      descriptionHtml: input.descriptionHtml.slice(0, MAX_INPUT_DESCRIPTION_CHARS),
      seoTitle: input.seoTitle.slice(0, 70),
      seoDescription: input.seoDescription.slice(0, 165),
      focusKeyword: input.focusKeyword.slice(0, 500),
      imageAlt: input.imageAlt.slice(0, 255),
      hasImage: input.hasImage,
      vendor: input.type === "product" ? cleanLine(input.vendor).slice(0, 255) : "",
      productType: input.type === "product" ? cleanLine(input.productType).slice(0, 255) : "",
      tags: input.type === "product" ? (input.tags || []).slice(0, 30).map((tag) => cleanLine(tag).slice(0, 100)) : [],
    },
    merchantInstruction: input.instruction.slice(0, MAX_INSTRUCTION_CHARS),
  });
  const exactFormat = "Return JSON only, beginning with { and ending with }. Use exactly these root keys: title, descriptionHtml, seoTitle, seoDescription, imageAlt, summary.";
  const attempts: Array<{ responseFormat?: Record<string, unknown>; system: string; label: string }> = [
    {
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "catalog_content_draft",
          strict: true,
          schema: catalogDraftSchema(),
        },
      },
      system,
      label: "catalog content",
    },
    {
      responseFormat: { type: "json_object" },
      system: `${system} ${exactFormat}`,
      label: "catalog content JSON retry",
    },
    {
      system: `${system} The API may not support response_format. ${exactFormat}`,
      label: "catalog content plain JSON fallback",
    },
  ];

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const response = await fetchNineRouter(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          stream: false,
          ...getNineRouterGenerationOptions(model, input.mode === "write" ? 0.4 : 0.2),
          ...(attempt.responseFormat ? { response_format: attempt.responseFormat } : {}),
          messages: [
            { role: "system", content: attempt.system },
            { role: "user", content: user },
          ],
        }),
      }, timeoutMs);
      if (!response.ok) throw await createNineRouterResponseError(response, attempt.label);
      const payload: any = await readNineRouterJson(response);
      const content = messageText(payload?.choices?.[0]?.message?.content);
      if (!content) throw new Error("9Router returned no message content");
      return parseCatalogDraft(content, input);
    } catch (error) {
      lastError = error;
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`9Router returned no safe catalog draft after JSON fallback: ${detail}`);
}

function parseCatalogDraft(content: string, input: AiCatalogInput): AiCatalogDraft {
  const parsed = parseObject(content);
  const proposedTitle = truncateAtWord(cleanLine(parsed.title), 255) || input.title;
  const proposedDescription = stringValue(parsed.descriptionHtml).trim();
  const title = input.mode === "seo" ? input.title : proposedTitle;
  const descriptionHtml = input.mode === "seo" ? input.descriptionHtml : proposedDescription;
  if (!descriptionHtml) throw new Error("9Router returned an empty catalog description");
  if (descriptionHtml.length > MAX_DESCRIPTION_CHARS) throw new Error("9Router returned a catalog description that is too large");
  validateCatalogHtml(input.descriptionHtml, descriptionHtml);

  const seoTitle = truncateAtWord(cleanLine(parsed.seoTitle), 70);
  const seoDescription = truncateAtWord(cleanLine(parsed.seoDescription), 165);
  if (!seoTitle || !seoDescription) throw new Error("9Router returned incomplete search metadata");
  const currentImageAlt = cleanLine(input.imageAlt).slice(0, 255);
  const imageAlt = input.hasImage
    ? truncateAtWord(cleanLine(parsed.imageAlt), 255) || currentImageAlt
    : currentImageAlt;

  return {
    title,
    descriptionHtml,
    seoTitle,
    seoDescription,
    imageAlt,
    summary: truncateAtWord(cleanLine(parsed.summary), 500) || "AI content is ready for review.",
  };
}

function validateCatalogHtml(original: string, proposed: string) {
  if (/<\s*\/?\s*(script|style|object|embed|form|input|button|meta|link)\b/i.test(proposed)
    || /\son[a-z]+\s*=/i.test(proposed)
    || /\sstyle\s*=/i.test(proposed)
    || /\s(?:href|src)\s*=\s*(?:"|'|)\s*(?:javascript|data|vbscript)\s*:/i.test(proposed)) {
    throw new Error("9Router returned unsafe catalog markup");
  }

  for (const match of proposed.matchAll(/<\s*\/?\s*([a-zA-Z0-9-]+)/g)) {
    if (!ALLOWED_TAGS.has(match[1].toLowerCase())) {
      throw new Error(`9Router returned an unsupported <${match[1].toLowerCase()}> element`);
    }
  }

  if (!sameStringMultiset(extractLinks(original), extractLinks(proposed))) {
    throw new Error("9Router did not preserve the catalog description links");
  }
  if (!sameStringMultiset(extractProtectedFragments(original), extractProtectedFragments(proposed))) {
    throw new Error("9Router did not preserve the catalog description media or tables");
  }
}

function extractLinks(html: string) {
  return [...html.matchAll(LINK_PATTERN)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}

function extractProtectedFragments(html: string) {
  return [...html.matchAll(PROTECTED_FRAGMENT_PATTERN)].map((match) => match[0].replace(/\s+/g, " ").trim());
}

function sameStringMultiset(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const sortedRight = [...right].sort();
  return [...left].sort().every((value, index) => value === sortedRight[index]);
}

function catalogDraftSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "descriptionHtml", "seoTitle", "seoDescription", "imageAlt", "summary"],
    properties: {
      title: { type: "string" },
      descriptionHtml: { type: "string" },
      seoTitle: { type: "string" },
      seoDescription: { type: "string" },
      imageAlt: { type: "string" },
      summary: { type: "string" },
    },
  };
}

function parseObject(value: string): Record<string, unknown> {
  const normalized = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(normalized);
    if (parsed && !Array.isArray(parsed) && typeof parsed === "object") return parsed;
  } catch {
    const start = normalized.indexOf("{");
    const end = normalized.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(normalized.slice(start, end + 1));
      if (parsed && !Array.isArray(parsed) && typeof parsed === "object") return parsed;
    }
  }
  throw new Error("9Router returned invalid catalog JSON");
}

function messageText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) return String((part as any).text || "");
      return "";
    }).join("");
  }
  return "";
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
