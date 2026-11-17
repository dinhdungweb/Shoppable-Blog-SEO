/**
 * Merchant-level writing rules from Settings → SEO & AI rules. They are injected
 * into every AI request (see nine-router.server.ts) and seed the default meta
 * tag suggestions in Bulk Optimize.
 */

export const BRAND_TONES = ["Professional", "Friendly", "Expert", "Playful", "Luxury", "Casual"] as const;
export type BrandTone = (typeof BRAND_TONES)[number];

export const DEFAULT_CONTENT_STRUCTURE = "Introduction, H2 sections, Conclusion";
export const DEFAULT_META_TITLE_TEMPLATE = "{{title}} - {{blog}} | {{store}}";
export const DEFAULT_META_DESCRIPTION_TEMPLATE = "{{excerpt}}";
export const META_TEMPLATE_TOKENS = ["{{title}}", "{{blog}}", "{{store}}", "{{excerpt}}"] as const;

const MAX_FORBIDDEN_WORDS = 50;
const MAX_FORBIDDEN_WORD_LENGTH = 60;

export const CONTENT_LANGUAGES = [
  "English", "Vietnamese", "Spanish", "French", "German", "Italian", "Portuguese", "Dutch",
  "Polish", "Swedish", "Japanese", "Korean", "Chinese (Simplified)", "Chinese (Traditional)", "Thai", "Indonesian",
] as const;

export type AiWritingRules = {
  /** Language for new content; existing text keeps its own language. */
  language: string;
  brandTone: string;
  forbiddenWords: string[];
  contentStructure: string;
};

export function parseForbiddenWords(value: string | null | undefined): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const raw of String(value || "").split(/[\n,;]+/)) {
    const word = raw.replace(/\s+/g, " ").trim().slice(0, MAX_FORBIDDEN_WORD_LENGTH);
    const key = word.toLowerCase();
    if (!word || seen.has(key)) continue;
    seen.add(key);
    words.push(word);
    if (words.length >= MAX_FORBIDDEN_WORDS) break;
  }
  return words;
}

export function normalizeAiWritingRules(config: {
  language?: string | null;
  brandTone?: string | null;
  forbiddenWords?: string | null;
  defaultContentStructure?: string | null;
}): AiWritingRules {
  const tone = BRAND_TONES.find((item) => item === config.brandTone) || "Professional";
  return {
    language: CONTENT_LANGUAGES.find((item) => item === config.language) || "English",
    brandTone: tone,
    forbiddenWords: parseForbiddenWords(config.forbiddenWords),
    contentStructure: String(config.defaultContentStructure || "").replace(/\s+/g, " ").trim().slice(0, 300) || DEFAULT_CONTENT_STRUCTURE,
  };
}

export function buildAiWritingRulesPrompt(rules: AiWritingRules): string {
  const lines = [
    "Merchant writing rules (apply to all customer-facing text you write):",
    `- Language: write new content in ${rules.language}. When improving or rewriting existing text, keep the language that text is already written in.`,
    `- Brand tone: ${rules.brandTone}.`,
  ];
  if (rules.forbiddenWords.length) {
    lines.push(`- Never use these words or phrases: ${rules.forbiddenWords.map((word) => `"${word}"`).join(", ")}.`);
  }
  lines.push(`- When writing a full article, follow this structure: ${rules.contentStructure}.`);
  lines.push("These rules never override the required output format or JSON schema.");
  return lines.join("\n");
}

/**
 * Appends the rules to the first system message of an OpenAI-compatible
 * chat/completions body, or prepends a system message when there is none.
 * Returns the body unchanged when it is not a chat JSON payload.
 */
export function injectAiWritingRules(body: unknown, rules: AiWritingRules | undefined): unknown {
  if (!rules || typeof body !== "string") return body;
  let parsed: { messages?: Array<{ role?: string; content?: unknown }> };
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (!parsed || !Array.isArray(parsed.messages)) return body;

  const prompt = buildAiWritingRulesPrompt(rules);
  const systemIndex = parsed.messages.findIndex((message) => message?.role === "system" && typeof message.content === "string");
  if (systemIndex >= 0) {
    const message = parsed.messages[systemIndex];
    parsed.messages[systemIndex] = { ...message, content: `${message.content}\n\n${prompt}` };
  } else {
    parsed.messages.unshift({ role: "system", content: prompt });
  }
  return JSON.stringify(parsed);
}

/**
 * Renders a meta template such as "{{title}} - {{blog}} | {{store}}".
 * Empty tokens are removed together with the separator that precedes them.
 */
export function renderMetaTemplate(
  template: string,
  values: { title?: string; blog?: string; store?: string; excerpt?: string },
): string {
  const tokens: Record<string, string> = {
    title: clean(values.title),
    blog: clean(values.blog),
    store: clean(values.store),
    excerpt: clean(values.excerpt),
  };
  return template
    .replace(/(\s*[-|–—:·]\s*)?\{\{\s*(title|blog|store|excerpt)\s*\}\}/g, (_match, separator: string | undefined, token: string) => {
      const value = tokens[token];
      return value ? `${separator || ""}${value}` : "";
    })
    .replace(/^\s*[-|–—:·]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clean(value: string | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

const COUNTRY_LANGUAGES: Record<string, (typeof CONTENT_LANGUAGES)[number]> = {
  VN: "Vietnamese",
  ES: "Spanish", MX: "Spanish", AR: "Spanish", CO: "Spanish", CL: "Spanish", PE: "Spanish",
  FR: "French",
  DE: "German", AT: "German",
  IT: "Italian",
  PT: "Portuguese", BR: "Portuguese",
  NL: "Dutch",
  PL: "Polish",
  SE: "Swedish",
  JP: "Japanese",
  KR: "Korean",
  CN: "Chinese (Simplified)",
  TW: "Chinese (Traditional)", HK: "Chinese (Traditional)",
  TH: "Thai",
  ID: "Indonesian",
};

/** A likely content language for a store's country; null when unclear (e.g. multilingual countries). */
export function suggestedLanguageForCountry(countryCode: string): (typeof CONTENT_LANGUAGES)[number] | null {
  return COUNTRY_LANGUAGES[String(countryCode || "").toUpperCase()] || null;
}
