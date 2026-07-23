import { isNineRouterConfigured } from "./ai-seo.server";
import { removeFaqSection } from "./faq-content";
import {
  createNineRouterResponseError,
  fetchNineRouter,
  getNineRouterGenerationOptions,
  readNineRouterJson,
} from "./nine-router.server";

export type AiFaqQuery = {
  query: string;
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
};

export type AiFaqItem = {
  id: string;
  question: string;
  answer: string;
  evidence: string;
  query: string;
};

export type AiFaqSuggestion = {
  sectionTitle: string;
  summary: string;
  items: AiFaqItem[];
};

export type AiFaqInput = {
  title: string;
  body: string;
  queries?: AiFaqQuery[];
  maxItems?: number;
  maxDurationMs?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ARTICLE_CHARS = 45_000;
const MAX_FAQ_ITEMS = 8;

export async function generateAiFaq(input: AiFaqInput): Promise<AiFaqSuggestion> {
  if (!isNineRouterConfigured()) throw new Error("9Router is not configured");
  const articleText = normalizeText(removeFaqSection(input.body), MAX_ARTICLE_CHARS);
  if (articleText.length < 120) throw new Error("Add more article content before generating FAQs.");
  const maxItems = clamp(Math.round(Number(input.maxItems) || 5), 2, MAX_FAQ_ITEMS);
  const queries = (input.queries || []).slice(0, 15).map((query) => ({
    query: normalizeText(query.query, 300),
    clicks: finiteNumber(query.clicks),
    impressions: finiteNumber(query.impressions),
    ctr: finiteNumber(query.ctr),
    position: finiteNumber(query.position),
  })).filter((query) => query.query);

  const baseUrl = process.env.NINE_ROUTER_BASE_URL!.trim().replace(/\/+$/, "");
  const apiKey = process.env.NINE_ROUTER_API_KEY!.trim();
  const model = process.env.NINE_ROUTER_MODEL!.trim();
  const configuredTimeout = Number(process.env.NINE_ROUTER_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout >= 1_000
    ? Math.min(configuredTimeout, 60_000)
    : DEFAULT_TIMEOUT_MS;
  const requestedBudget = Number(input.maxDurationMs);
  const totalBudgetMs = Number.isFinite(requestedBudget) && requestedBudget >= 1_000
    ? Math.min(requestedBudget, timeoutMs * 3, 90_000)
    : Math.min(timeoutMs * 3, 90_000);
  const deadlineAt = Date.now() + totalBudgetMs;

  const systemMessage = [
    "You create people-first FAQ sections for ecommerce blog articles.",
    "Use the same language as the article.",
    `Return at most ${maxItems} useful questions that the supplied ARTICLE_TEXT already answers.`,
    "SEARCH_QUERIES may help identify reader wording, but they are not factual evidence.",
    "Every answer must be supported entirely by ARTICLE_TEXT. Never add facts, product claims, prices, guarantees, dates, statistics, medical/legal advice, or instructions that are absent from the article.",
    "For every item, evidence must be one exact consecutive excerpt copied from ARTICLE_TEXT that directly supports the answer.",
    "Answers must be concise plain text with no HTML, Markdown, links, citations, or sales language.",
    "Do not repeat questions, article headings, or near-identical answers.",
    "Do not mention Search Console or SEO in reader-facing text.",
  ].join(" ");
  const userMessage = JSON.stringify({
    title: normalizeText(input.title, 255),
    maxItems,
    ARTICLE_TEXT: articleText,
    SEARCH_QUERIES: queries,
  });
  const exactFormat = [
    'Return exactly one JSON object with root keys "sectionTitle", "summary", and "items".',
    'Each item must be {"id":"faq-1","question":"reader question","answer":"answer supported by the article","evidence":"exact excerpt copied from ARTICLE_TEXT","query":"matching supplied query or empty string"}.',
    "Return JSON only. Begin with { and end with }.",
  ].join(" ");

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
    if (remainingMs < 1_000) throw new Error("9Router FAQ generation exhausted its JSON retry time budget");
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
    const content = messageText(rawContent);
    if (!content) throw new Error("9Router returned no message content");
    return content;
  };

  const attempts: Array<{ responseFormat?: Record<string, unknown>; system: string; label: string }> = [
    {
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "article_faq",
          strict: true,
          schema: faqSchema(maxItems),
        },
      },
      system: systemMessage,
      label: "FAQ generation",
    },
    {
      responseFormat: { type: "json_object" },
      system: `${systemMessage} This is a JSON object retry. ${exactFormat}`,
      label: "FAQ generation JSON retry",
    },
    {
      system: `${systemMessage} Your API may not support response_format, so follow the JSON format in the prompt itself. ${exactFormat}`,
      label: "FAQ generation plain JSON fallback",
    },
  ];

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const content = await requestContent(attempt);
      return parseFaqSuggestion(content, articleText, queries, maxItems);
    } catch (error) {
      lastError = error;
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`9Router returned no safe FAQ after JSON fallback: ${detail}`);
}

function parseFaqSuggestion(
  content: string,
  articleText: string,
  queries: AiFaqQuery[],
  maxItems: number,
): AiFaqSuggestion {
  const parsed = parseObject(content);
  const nested = objectValue(parsed.data);
  const rawItems = parsed.items ?? parsed.faqs ?? parsed.questions ?? nested?.items ?? nested?.faqs;
  if (!Array.isArray(rawItems)) throw new Error("9Router returned no FAQ item array");
  const queryMap = new Map(queries.map((query) => [query.query.toLocaleLowerCase(), query.query]));
  const seen = new Set<string>();
  const items = rawItems.slice(0, maxItems).flatMap((value, index) => {
    const raw = objectValue(value);
    if (!raw) return [];
    let question = normalizeText(raw.question ?? raw.q ?? raw.title, 300);
    const answer = normalizeText(raw.answer ?? raw.a ?? raw.response, 1_500);
    const evidence = normalizeText(raw.evidence ?? raw.sourceEvidence ?? raw.source_excerpt ?? raw.excerpt, 700);
    const queryValue = normalizeText(raw.query ?? raw.sourceQuery ?? raw.source_query, 300);
    if (!question || !answer || evidence.length < 12) return [];
    if (!question.endsWith("?")) question = `${question}?`;
    const questionKey = question.toLocaleLowerCase();
    if (seen.has(questionKey)) return [];
    if (!containsNormalizedExcerpt(articleText, evidence)) return [];
    if (!answerSupportedByEvidence(answer, evidence, articleText)) return [];
    seen.add(questionKey);
    return [{
      id: normalizeId(raw.id) || `faq-${index + 1}`,
      question,
      answer,
      evidence,
      query: queryMap.get(queryValue.toLocaleLowerCase()) || "",
    }];
  });
  if (!items.length) throw new Error("9Router returned no FAQ backed by an exact article excerpt");
  return {
    sectionTitle: normalizeText(parsed.sectionTitle ?? parsed.section_title ?? parsed.title, 120) || "Frequently asked questions",
    summary: normalizeText(parsed.summary ?? parsed.explanation, 500) || `${items.length} article-backed FAQ items are ready for review.`,
    items,
  };
}

function answerSupportedByEvidence(answer: string, evidence: string, articleText: string) {
  const articleNumbers = new Set(extractNumbers(articleText));
  if (extractNumbers(answer).some((number) => !articleNumbers.has(number))) return false;
  const evidenceTokens = new Set(meaningfulTokens(evidence));
  const answerTokens = meaningfulTokens(answer);
  if (!answerTokens.length || !answerTokens.some((token) => evidenceTokens.has(token))) return false;
  return true;
}

function meaningfulTokens(value: string) {
  const stopWords = new Set([
    "the", "and", "for", "with", "that", "this", "from", "your", "you", "are", "can", "how", "what",
    "các", "cho", "với", "trong", "này", "được", "không", "những", "một", "của", "khi", "là", "thế", "nào",
  ]);
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((token) => token.length >= 3 && !stopWords.has(token)) || [];
}

function containsNormalizedExcerpt(articleText: string, evidence: string) {
  return articleText.toLocaleLowerCase().includes(evidence.toLocaleLowerCase());
}

function extractNumbers(value: string) {
  return value.match(/\b\d+(?:[.,]\d+)*(?:%|[a-zA-Z]+)?\b/g) || [];
}

function faqSchema(maxItems: number) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["sectionTitle", "summary", "items"],
    properties: {
      sectionTitle: { type: "string" },
      summary: { type: "string" },
      items: {
        type: "array",
        maxItems,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "question", "answer", "evidence", "query"],
          properties: {
            id: { type: "string" },
            question: { type: "string" },
            answer: { type: "string" },
            evidence: { type: "string" },
            query: { type: "string" },
          },
        },
      },
    },
  };
}

function parseObject(value: string): Record<string, unknown> {
  const normalized = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch (directError) {
    const extracted = extractFirstJsonObject(normalized);
    if (!extracted) throw directError;
    parsed = JSON.parse(extracted);
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("9Router returned invalid FAQ JSON");
  return parsed as Record<string, unknown>;
}

function extractFirstJsonObject(value: string) {
  const start = value.indexOf("{");
  if (start < 0) return "";
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
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }
  return "";
}

function messageText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((part) => typeof part === "string"
      ? part
      : typeof objectValue(part)?.text === "string"
        ? String(objectValue(part)?.text)
        : "").join("");
  }
  return value && typeof value === "object" ? JSON.stringify(value) : "";
}

function normalizeText(value: unknown, max: number) {
  return typeof value === "string"
    ? value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function normalizeId(value: unknown) {
  return typeof value === "string" ? value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) : "";
}

function objectValue(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
