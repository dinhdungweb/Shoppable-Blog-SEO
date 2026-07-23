import { isNineRouterConfigured } from "./ai-seo.server";
import { createNineRouterResponseError, getNineRouterGenerationOptions, readNineRouterJson } from "./nine-router.server";

export const CONTENT_REFRESH_FIELDS = ["title", "body", "excerpt", "metaTitle", "metaDescription"] as const;
export type ContentRefreshField = typeof CONTENT_REFRESH_FIELDS[number];

export type ContentRefreshSignal = {
  id: string;
  type: string;
  message: string;
  previousValue: string;
  currentValue: string;
  recommendation: string;
  detail?: string;
  severity?: "high" | "medium" | "low";
};

export type ContentRefreshQuery = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  previousClicks: number;
  previousImpressions: number;
  previousCtr: number;
  previousPosition: number;
};

export type ContentRefreshChange = {
  field: ContentRefreshField;
  after: string;
  explanation: string;
  signalIds: string[];
  queries: string[];
};

export type ContentRefreshManualAction = {
  sourceId: string;
  title: string;
  explanation: string;
  action: string;
};

export type ContentRefreshSuggestion = {
  strategy: string;
  changes: ContentRefreshChange[];
  manualActions: ContentRefreshManualAction[];
};

export type ContentRefreshInput = {
  title: string;
  body: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
  signals: ContentRefreshSignal[];
  queries: ContentRefreshQuery[];
};

const MAX_BODY_CHARS = 50_000;
const MAX_OUTPUT_CHARS = 70_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MARKER_PATTERN = /\[\[SBS_(?:PRODUCTS|TOC)(?::[a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+)?)?\]\]/g;
const MANUAL_SIGNAL_TYPES = new Set(["unavailable_product", "broken_outbound", "outdated_year"]);

export function isManualContentRefreshSignal(type: string) {
  return MANUAL_SIGNAL_TYPES.has(type);
}

export async function generateContentRefresh(input: ContentRefreshInput): Promise<ContentRefreshSuggestion> {
  if (!isNineRouterConfigured()) throw new Error("9Router is not configured");
  if (!input.signals.length && !input.queries.length) throw new Error("Choose at least one refresh signal");
  if (input.body.length > MAX_BODY_CHARS) throw new Error("This article is too large for Content Refresh Copilot");

  const baseUrl = process.env.NINE_ROUTER_BASE_URL!.trim().replace(/\/+$/, "");
  const apiKey = process.env.NINE_ROUTER_API_KEY!.trim();
  const model = process.env.NINE_ROUTER_MODEL!.trim();
  const timeoutValue = Number(process.env.NINE_ROUTER_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutValue) && timeoutValue >= 1_000
    ? Math.min(timeoutValue, 60_000)
    : DEFAULT_TIMEOUT_MS;
  const signals = input.signals.slice(0, 20);
  const queries = input.queries.slice(0, 20);
  const signalIds = new Set(signals.map((signal) => signal.id));
  const queryNames = new Set(queries.map((query) => query.query));

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      ...getNineRouterGenerationOptions(model, 0.2),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You are an ecommerce Content Refresh Copilot. Return only one JSON object with strategy, changes, and manualActions.",
            "changes is an array with field, after, explanation, signalIds, and queries. Allowed fields are title, body, excerpt, metaTitle, and metaDescription.",
            "manualActions is an array with sourceId, title, explanation, and action.",
            "Use only the supplied article, decay signals, and Search Console metrics. Preserve the article language, voice, accurate claims, and commercial intent.",
            "Search Console queries describe observed demand; do not claim they prove causation or guarantee improved rankings, clicks, or CTR.",
            "Improve alignment with useful queries naturally. Do not keyword-stuff, create doorway copy, or add sections that do not help the reader.",
            "Never invent facts, dates, sources, products, prices, statistics, tests, testimonials, credentials, or first-hand experience.",
            "Signals marked manualOnly require a manual action and must not cause an automatic field change.",
            "For stale content, improve structure and clarity only from existing facts and add a manual fact-verification checklist.",
            "When changing body, return the complete HTML fragment without h1, scripts, styles, iframes, forms, SVG, event attributes, inline CSS, or markdown fences.",
            "Preserve every existing href and img src exactly. Preserve every [[SBS_PRODUCTS...]] and [[SBS_TOC...]] marker exactly. Do not remove links, images, tables, or product blocks.",
            "title and metaTitle must each be at most 70 characters, metaDescription at most 160, and excerpt at most 400.",
            "Return only fields that actually change, and reference only supplied signal IDs and query strings.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            article: {
              title: input.title.slice(0, 300),
              bodyHtml: input.body,
              excerpt: input.excerpt.slice(0, 400),
              metaTitle: input.metaTitle.slice(0, 70),
              metaDescription: input.metaDescription.slice(0, 160),
              focusKeyword: input.focusKeyword.slice(0, 300),
            },
            decaySignals: signals.map((signal) => ({ ...signal, manualOnly: isManualContentRefreshSignal(signal.type) })),
            searchConsoleQueries: queries,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw await createNineRouterResponseError(response, "content refresh");
  }
  const payload: any = await readNineRouterJson(response);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("9Router returned no message content");
  if (content.length > MAX_OUTPUT_CHARS) throw new Error("9Router returned a content refresh that is too large");

  const parsed = parseJsonObject(content);
  const changes = parseChanges(parsed.changes, input, signalIds, queryNames, signals);
  const manualActions = ensureManualActions(parseManualActions(parsed.manualActions, signalIds, queryNames), signals);
  if (!changes.length && !manualActions.length) throw new Error("9Router returned no usable content refresh");
  return {
    strategy: cleanLine(parsed.strategy).slice(0, 700) || "Review the proposed content refresh below.",
    changes,
    manualActions,
  };
}

function parseChanges(
  value: unknown,
  input: ContentRefreshInput,
  allowedSignalIds: Set<string>,
  allowedQueries: Set<string>,
  signals: ContentRefreshSignal[],
) {
  if (!Array.isArray(value)) return [];
  const changes: ContentRefreshChange[] = [];
  const seen = new Set<string>();
  const manualIds = new Set(signals.filter((signal) => isManualContentRefreshSignal(signal.type)).map((signal) => signal.id));
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const field = cleanLine(item.field) as ContentRefreshField;
    if (!CONTENT_REFRESH_FIELDS.includes(field) || seen.has(field)) continue;
    const signalIds = stringArray(item.signalIds).filter((id) => allowedSignalIds.has(id));
    const queries = stringArray(item.queries).filter((query) => allowedQueries.has(query));
    if (!signalIds.length && !queries.length) continue;
    if (signalIds.length && signalIds.every((id) => manualIds.has(id)) && !queries.length) continue;
    let after = stringValue(item.after).trim();
    if (!after) continue;
    if (field === "body") validateBody(input.body, after);
    else after = cleanLine(after);
    const limit = field === "body" ? MAX_BODY_CHARS : field === "excerpt" ? 400 : field === "metaDescription" ? 160 : 70;
    if (after.length > limit) throw new Error(`9Router returned ${field} over the allowed length`);
    if (signals.some((signal) => signal.type === "outdated_year")
      && !sameStringMultiset(yearValues(currentValue(input, field)), yearValues(after))) {
      throw new Error("9Router changed a year before the article was manually verified");
    }
    if (after === currentValue(input, field)) continue;
    changes.push({
      field,
      after,
      explanation: cleanLine(item.explanation).slice(0, 500) || "Improves alignment with the selected refresh signals.",
      signalIds: [...new Set(signalIds)],
      queries: [...new Set(queries)],
    });
    seen.add(field);
  }
  return changes;
}

function parseManualActions(value: unknown, signalIds: Set<string>, queryNames: Set<string>) {
  if (!Array.isArray(value)) return [];
  const actions: ContentRefreshManualAction[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const sourceId = cleanLine(item.sourceId);
    if ((!signalIds.has(sourceId) && !queryNames.has(sourceId)) || seen.has(sourceId)) continue;
    const action = cleanLine(item.action).slice(0, 600);
    if (!action) continue;
    actions.push({ sourceId, title: cleanLine(item.title).slice(0, 200) || "Manual review", explanation: cleanLine(item.explanation).slice(0, 500), action });
    seen.add(sourceId);
  }
  return actions;
}

function ensureManualActions(actions: ContentRefreshManualAction[], signals: ContentRefreshSignal[]) {
  const complete = [...actions];
  const covered = new Set(actions.map((action) => action.sourceId));
  for (const signal of signals) {
    if (covered.has(signal.id)) continue;
    if (isManualContentRefreshSignal(signal.type)) {
      complete.push({ sourceId: signal.id, title: signal.message, explanation: manualExplanation(signal.type), action: signal.recommendation });
      covered.add(signal.id);
    } else if (signal.type === "stale_content") {
      complete.push({ sourceId: signal.id, title: "Verify stale facts", explanation: "AI reorganized only the information already present and cannot confirm whether facts are still current.", action: "Verify dates, claims, screenshots, links, and product details against current primary sources before publishing." });
      covered.add(signal.id);
    }
  }
  return complete;
}

function manualExplanation(type: string) {
  if (type === "broken_outbound") return "AI cannot choose a trustworthy replacement destination without merchant verification.";
  if (type === "unavailable_product") return "Product availability and replacement choice must come from the live Shopify catalog.";
  return "Changing an older year implies the article has been re-verified, which AI cannot confirm.";
}

function validateBody(original: string, proposed: string) {
  if (proposed.length > MAX_BODY_CHARS) throw new Error("9Router returned body over the allowed length");
  if (/<\s*\/?\s*(script|style|iframe|object|embed|svg|form|input|button|meta|link)\b/i.test(proposed)
    || /\son[a-z]+\s*=/i.test(proposed)
    || /\sstyle\s*=/i.test(proposed)
    || /(?:javascript|data|vbscript)\s*:/i.test(proposed)) throw new Error("9Router returned unsafe article markup");
  if (/<\s*h1\b/i.test(proposed)) throw new Error("9Router returned an H1 inside the article body");
  if (!sameStringMultiset(tagAttributes(original, "a", "href"), tagAttributes(proposed, "a", "href"))) throw new Error("9Router did not preserve the article links");
  if (!sameStringMultiset(tagAttributes(original, "img", "src"), tagAttributes(proposed, "img", "src"))) throw new Error("9Router did not preserve the article images");
  if (!sameStringMultiset(tagAttributes(original, "img", "alt"), tagAttributes(proposed, "img", "alt"))) throw new Error("9Router did not preserve the article image alt text");
  if (!sameStringMultiset(original.match(MARKER_PATTERN) || [], proposed.match(MARKER_PATTERN) || [])) throw new Error("9Router did not preserve the article blocks");
}

function currentValue(input: ContentRefreshInput, field: ContentRefreshField) {
  if (field === "title") return input.title;
  if (field === "body") return input.body;
  if (field === "excerpt") return input.excerpt;
  if (field === "metaTitle") return input.metaTitle;
  return input.metaDescription;
}

function yearValues(value: string) {
  return [...value.matchAll(/\b20\d{2}\b/g)].map((match) => match[0]);
}

function tagAttributes(html: string, tag: string, name: string) {
  const tagPattern = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const attributePattern = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  return [...html.matchAll(tagPattern)].flatMap((tagMatch) => {
    const match = tagMatch[0].match(attributePattern);
    return match ? [match[1] ?? match[2] ?? match[3] ?? ""] : [];
  });
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("9Router returned invalid JSON");
  return parsed;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.map(cleanLine).filter(Boolean))] : [];
}
function cleanLine(value: unknown) { return stringValue(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }
function stringValue(value: unknown) { return typeof value === "string" ? value : ""; }
function sameStringMultiset(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const sorted = [...right].sort();
  return [...left].sort().every((item, index) => item === sorted[index]);
}
