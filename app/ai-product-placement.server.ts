import { isNineRouterConfigured } from "./ai-seo.server";
import { createNineRouterResponseError, getNineRouterGenerationOptions, readNineRouterJson } from "./nine-router.server";

export type AiCatalogProduct = {
  id: string;
  title: string;
  handle: string;
  description: string;
  productType: string;
  vendor: string;
  tags: string[];
  imageUrl: string;
  imageAlt: string;
  price: string;
};

export type AiProductRecommendation = {
  productId: string;
  reason: string;
  placementHint: string;
};

type AiProductPlacementInput = {
  articleTitle: string;
  articleBody: string;
  focusKeyword: string;
  products: AiCatalogProduct[];
  maxRecommendations?: number;
};

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_ARTICLE_CHARS = 8_000;
const MAX_CATALOG_PRODUCTS = 30;
const DEFAULT_RECOMMENDATION_COUNT = 5;

export async function generateAiProductRecommendations(
  input: AiProductPlacementInput,
): Promise<AiProductRecommendation[]> {
  if (!isNineRouterConfigured()) throw new Error("9Router is not configured");
  if (!input.products.length) throw new Error("No catalog products are available for recommendation");

  const baseUrl = process.env.NINE_ROUTER_BASE_URL!.trim().replace(/\/+$/, "");
  const apiKey = process.env.NINE_ROUTER_API_KEY!.trim();
  const model = process.env.NINE_ROUTER_MODEL!.trim();
  const timeoutValue = Number(process.env.NINE_ROUTER_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutValue) && timeoutValue >= 1_000
    ? Math.min(timeoutValue, 60_000)
    : DEFAULT_TIMEOUT_MS;
  const maxRecommendations = Math.max(
    1,
    Math.min(input.maxRecommendations || DEFAULT_RECOMMENDATION_COUNT, DEFAULT_RECOMMENDATION_COUNT),
  );
  const products = input.products.slice(0, MAX_CATALOG_PRODUCTS);

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
      ...getNineRouterGenerationOptions(model, 0.15),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You recommend products for an ecommerce blog article using only the supplied catalog.",
            `Return only a JSON object with a recommendations array containing at most ${maxRecommendations} items.`,
            "Each item must have productId, reason, and placementHint strings.",
            "Use productId exactly as supplied. Recommend only products that are genuinely relevant to the article.",
            "If very few products are relevant, return fewer recommendations rather than weak matches.",
            "Do not invent product details, prices, benefits, claims, or availability.",
            "reason must explain the contextual match in one short sentence.",
            "placementHint must name a suitable article section or say end of article; do not return HTML.",
            "Preserve the language of the article.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            articleTitle: input.articleTitle.slice(0, 300),
            focusKeyword: input.focusKeyword.slice(0, 300),
            articleText: stripHtml(input.articleBody).slice(0, MAX_ARTICLE_CHARS),
            catalog: products.map((product) => ({
              productId: product.id,
              title: product.title,
              description: product.description.slice(0, 400),
              productType: product.productType,
              vendor: product.vendor,
              tags: product.tags.slice(0, 15),
              price: product.price,
            })),
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw await createNineRouterResponseError(response, "product recommendations");
  }

  const payload: any = await readNineRouterJson(response);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("9Router returned no message content");
  const parsed = parseJsonObject(content);
  if (!Array.isArray(parsed.recommendations)) throw new Error("9Router returned invalid product recommendations");

  const validProductIds = new Set(products.map((product) => product.id));
  const seen = new Set<string>();
  const recommendations: AiProductRecommendation[] = [];
  for (const value of parsed.recommendations) {
    if (!value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    const productId = cleanLine(item.productId);
    if (!validProductIds.has(productId) || seen.has(productId)) continue;
    const reason = truncateAtWord(cleanLine(item.reason), 240);
    const placementHint = truncateAtWord(cleanLine(item.placementHint), 160);
    if (!reason || !placementHint) continue;
    seen.add(productId);
    recommendations.push({ productId, reason, placementHint });
    if (recommendations.length >= maxRecommendations) break;
  }

  if (!recommendations.length) {
    throw new Error("9Router found no relevant catalog products for this article");
  }
  return recommendations;
}

export function rankCatalogProductsForArticle(
  products: AiCatalogProduct[],
  article: { title: string; body: string; focusKeyword: string },
  limit = MAX_CATALOG_PRODUCTS,
) {
  const titleTokens = tokenize(`${article.title} ${article.focusKeyword}`);
  const bodyTokens = tokenize(stripHtml(article.body));
  const articleTokens = new Set([...titleTokens, ...bodyTokens]);

  return products
    .map((product, index) => {
      const productTitleTokens = tokenize(product.title);
      const metadataTokens = tokenize(`${product.productType} ${product.vendor} ${product.tags.join(" ")}`);
      const descriptionTokens = tokenize(product.description);
      let score = 0;
      for (const token of productTitleTokens) {
        if (titleTokens.includes(token)) score += 10;
        else if (articleTokens.has(token)) score += 5;
      }
      for (const token of metadataTokens) {
        if (titleTokens.includes(token)) score += 5;
        else if (articleTokens.has(token)) score += 2;
      }
      for (const token of descriptionTokens) {
        if (articleTokens.has(token)) score += 1;
      }
      return { product, score, index };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(1, limit))
    .map(({ product }) => product);
}

function parseJsonObject(value: string): Record<string, unknown> {
  const normalized = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(normalized);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("9Router returned invalid JSON");
  }
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

function tokenize(value: string): string[] {
  return value.toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[\p{L}\p{N}]{3,}/gu) ?? [];
}

function cleanLine(value: unknown) {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "";
}

function truncateAtWord(value: string, limit: number) {
  if (value.length <= limit) return value;
  const candidate = value.slice(0, limit + 1);
  const boundary = candidate.lastIndexOf(" ");
  return candidate.slice(0, boundary >= Math.floor(limit * 0.7) ? boundary : limit).replace(/[\s,;:.-]+$/g, "");
}
