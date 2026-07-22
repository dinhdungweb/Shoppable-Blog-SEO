type SeoSuggestionInput = {
  id: string;
  title: string;
  summary: string;
  body: string;
  hasImage: boolean;
};

export type AiSeoSuggestion = {
  id: string;
  metaTitle: string;
  metaDescription: string;
  imageAlt: string;
};

const MAX_ARTICLE_CHARS = 6_000;
const DEFAULT_TIMEOUT_MS = 20_000;

export function isNineRouterConfigured() {
  return Boolean(
    process.env.NINE_ROUTER_BASE_URL?.trim()
    && process.env.NINE_ROUTER_API_KEY?.trim()
    && process.env.NINE_ROUTER_MODEL?.trim(),
  );
}

export async function generateAiSeoSuggestion(input: SeoSuggestionInput): Promise<AiSeoSuggestion> {
  const baseUrl = process.env.NINE_ROUTER_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.NINE_ROUTER_API_KEY?.trim();
  const model = process.env.NINE_ROUTER_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) throw new Error("9Router is not configured");

  const timeoutValue = Number(process.env.NINE_ROUTER_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutValue) && timeoutValue >= 1_000
    ? Math.min(timeoutValue, 60_000)
    : DEFAULT_TIMEOUT_MS;
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are an ecommerce SEO editor. Return only a JSON object with metaTitle, metaDescription, and imageAlt. Preserve the article language. Use natural, accurate wording without inventing products, claims, prices, or facts. metaTitle must be at most 70 characters, metaDescription at most 160 characters, and imageAlt at most 255 characters. If hasImage is false, imageAlt must be empty.",
        },
        {
          role: "user",
          content: JSON.stringify({
            title: input.title,
            summary: input.summary,
            articleText: stripHtml(input.body).slice(0, MAX_ARTICLE_CHARS),
            hasImage: input.hasImage,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`9Router request failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  const payload: any = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("9Router returned no message content");
  const parsed = parseJsonObject(content);
  const metaTitle = clean(parsed.metaTitle);
  const metaDescription = clean(parsed.metaDescription);
  const imageAlt = input.hasImage ? clean(parsed.imageAlt) : "";
  if (!metaTitle || !metaDescription) throw new Error("9Router returned an incomplete SEO suggestion");
  if (metaTitle.length > 70 || metaDescription.length > 160 || imageAlt.length > 255) {
    throw new Error("9Router returned an SEO suggestion over the allowed length");
  }
  return { id: input.id, metaTitle, metaDescription, imageAlt };
}

function parseJsonObject(value: string): Record<string, unknown> {
  const normalized = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(normalized);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("9Router returned invalid JSON");
  return parsed;
}

function stripHtml(value: string) {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function clean(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
