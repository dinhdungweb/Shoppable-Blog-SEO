export type FaqItem = {
  id: string;
  question: string;
  answer: string;
  evidence?: string;
};

export type FaqSection = {
  sectionTitle: string;
  items: FaqItem[];
};

export const FAQ_SECTION_ID = "sbs-faq";
const FAQ_SECTION_PATTERN = /<section\b[^>]*\bid=(["'])sbs-faq\1[^>]*>[\s\S]*?<\/section>\s*/gi;

export function buildFaqSection(sectionTitle: string, items: FaqItem[]) {
  const normalized = normalizeFaqSection(sectionTitle, items);
  if (!normalized.items.length) throw new Error("Add at least one complete FAQ item.");

  const itemHtml = normalized.items.map((item) => [
    '<details class="sbs-faq__item">',
    `<summary class="sbs-faq__question">${escapeHtml(item.question)}</summary>`,
    `<p class="sbs-faq__answer">${escapeHtml(item.answer)}</p>`,
    "</details>",
  ].join("")).join("");

  return [
    `<section id="${FAQ_SECTION_ID}" class="sbs-faq">`,
    `<h2 class="sbs-faq__title">${escapeHtml(normalized.sectionTitle)}</h2>`,
    itemHtml,
    "</section>",
  ].join("");
}

export function upsertFaqSection(bodyHtml: string, sectionTitle: string, items: FaqItem[]) {
  const faqHtml = buildFaqSection(sectionTitle, items);
  const bodyWithoutFaq = removeFaqSection(bodyHtml).trim();
  return bodyWithoutFaq ? `${bodyWithoutFaq}\n${faqHtml}` : faqHtml;
}

export function removeFaqSection(bodyHtml: string) {
  return bodyHtml.replace(FAQ_SECTION_PATTERN, "").trim();
}

export function extractFaqSectionHtml(bodyHtml: string) {
  const match = bodyHtml.match(new RegExp(FAQ_SECTION_PATTERN.source, "i"));
  return match?.[0]?.trim() || "";
}

export function extractFaqSection(bodyHtml: string): FaqSection | null {
  const html = extractFaqSectionHtml(bodyHtml);
  if (!html) return null;
  const sectionTitle = html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || "Frequently asked questions";
  const items = [...html.matchAll(/<details\b[^>]*>([\s\S]*?)<\/details>/gi)].flatMap((match, index) => {
    const question = match[1].match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i)?.[1] || "";
    const answer = match[1].match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "";
    const cleanQuestion = normalizeText(question, 300);
    const cleanAnswer = normalizeText(answer, 1_500);
    if (!cleanQuestion || !cleanAnswer) return [];
    return [{
      id: `faq-${index + 1}`,
      question: cleanQuestion,
      answer: cleanAnswer,
    }];
  });
  return {
    sectionTitle: normalizeText(sectionTitle, 120) || "Frequently asked questions",
    items,
  };
}

export function normalizeFaqSection(sectionTitle: string, items: FaqItem[]): FaqSection {
  const normalizedItems = items.slice(0, 8).flatMap((item, index) => {
    const question = normalizeText(item.question, 300);
    const answer = normalizeText(item.answer, 1_500);
    if (!question || !answer) return [];
    return [{
      id: normalizeId(item.id) || `faq-${index + 1}`,
      question,
      answer,
      ...(item.evidence ? { evidence: normalizeText(item.evidence, 700) } : {}),
    }];
  });
  return {
    sectionTitle: normalizeText(sectionTitle, 120) || "Frequently asked questions",
    items: uniqueByQuestion(normalizedItems),
  };
}

function uniqueByQuestion(items: FaqItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.question.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeId(value: string) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

function normalizeText(value: string, max: number) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
