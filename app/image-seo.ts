import { createHash } from "node:crypto";

export const IMAGE_SEO_ISSUES = ["missing_alt", "stuffed_alt", "decorative_alt"] as const;
export type ImageSeoIssue = typeof IMAGE_SEO_ISSUES[number];
export type ImageSeoKind = "featured" | "inline";

export type ImageSeoArticle = {
  id: string;
  title: string;
  summary: string;
  body: string;
  featuredImageUrl: string;
  featuredImageAlt: string;
};

export type ImageSeoCandidate = {
  id: string;
  articleId: string;
  articleTitle: string;
  kind: ImageSeoKind;
  index: number;
  src: string;
  currentAlt: string;
  decorative: boolean;
  issues: ImageSeoIssue[];
  context: string;
  bodyHash: string;
};

export type ImageAltChange = {
  id: string;
  index: number;
  src: string;
  beforeAlt: string;
  afterAlt: string;
  decorative: boolean;
};

export function scanArticleImages(article: ImageSeoArticle): ImageSeoCandidate[] {
  const candidates: ImageSeoCandidate[] = [];
  const bodyHash = hashArticleBody(article.body);
  const featuredIssues = imageIssues(article.featuredImageAlt, false, Boolean(article.featuredImageUrl), false);
  if (featuredIssues.length) {
    candidates.push({
      id: candidateId(article.id, "featured", 0),
      articleId: article.id,
      articleTitle: article.title,
      kind: "featured",
      index: 0,
      src: article.featuredImageUrl,
      currentAlt: article.featuredImageAlt,
      decorative: false,
      issues: featuredIssues,
      context: cleanText(`${article.title}. ${article.summary}. ${stripHtml(article.body).slice(0, 600)}`),
      bodyHash,
    });
  }

  let index = 0;
  for (const match of article.body.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src = decodeHtmlAttribute(readAttribute(tag, "src"));
    const alt = decodeHtmlAttribute(readAttribute(tag, "alt"));
    const hasAltAttribute = /\s+alt\s*=/i.test(tag);
    const decorative = /\brole\s*=\s*(?:"presentation"|'presentation'|presentation)(?:\s|\/?>)/i.test(tag)
      || /\baria-hidden\s*=\s*(?:"true"|'true'|true)(?:\s|\/?>)/i.test(tag);
    const issues = imageIssues(alt, decorative, true, hasAltAttribute);
    if (issues.length) {
      candidates.push({
        id: candidateId(article.id, "inline", index),
        articleId: article.id,
        articleTitle: article.title,
        kind: "inline",
        index,
        src,
        currentAlt: alt,
        decorative,
        issues,
        context: imageContext(article, match.index || 0, tag.length),
        bodyHash,
      });
    }
    index += 1;
  }
  return candidates;
}

export function scanImagePortfolio(articles: ImageSeoArticle[]) {
  return articles.flatMap(scanArticleImages);
}

export function applyInlineAltChanges(body: string, expectedHash: string, changes: ImageAltChange[]) {
  if (hashArticleBody(body) !== expectedHash) throw new Error("The article body changed after this image review was generated.");
  const changeMap = new Map(changes.map((change) => [change.index, change]));
  if (changeMap.size !== changes.length) throw new Error("Duplicate inline image changes are not allowed.");
  let index = 0;
  let applied = 0;
  const nextBody = body.replace(/<img\b[^>]*>/gi, (tag) => {
    const change = changeMap.get(index++);
    if (!change) return tag;
    const src = decodeHtmlAttribute(readAttribute(tag, "src"));
    const alt = decodeHtmlAttribute(readAttribute(tag, "alt"));
    const decorative = /\brole\s*=\s*(?:"presentation"|'presentation'|presentation)(?:\s|\/?>)/i.test(tag)
      || /\baria-hidden\s*=\s*(?:"true"|'true'|true)(?:\s|\/?>)/i.test(tag);
    if (src !== change.src || alt !== change.beforeAlt || decorative !== change.decorative) {
      throw new Error("An inline image changed after this review was generated.");
    }
    applied += 1;
    return setImageAlt(tag, change.afterAlt);
  });
  if (applied !== changes.length) throw new Error("One or more reviewed inline images no longer exist.");
  return nextBody;
}

export function validateProposedAlt(value: string, decorative: boolean) {
  const alt = cleanAlt(value);
  if (decorative) {
    if (alt) throw new Error("Decorative images must use empty alt text.");
    return "";
  }
  if (!alt) throw new Error("Descriptive images require alt text.");
  if (alt.length > 160) throw new Error("Image alt text must be 160 characters or fewer.");
  if (isStuffedAlt(alt)) throw new Error("Image alt text repeats words too often.");
  return alt;
}

export function hashArticleBody(body: string) {
  return createHash("sha256").update(body).digest("hex");
}

export function isStuffedAlt(alt: string) {
  if (!alt) return false;
  if (alt.length > 160) return true;
  const tokens = alt.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  if (tokens.length < 5) return false;
  const counts = new Map<string, number>();
  tokens.forEach((token) => counts.set(token, (counts.get(token) || 0) + 1));
  return Math.max(...counts.values()) >= 3;
}

function imageIssues(alt: string, decorative: boolean, exists: boolean, hasAltAttribute: boolean): ImageSeoIssue[] {
  if (!exists) return [];
  if (decorative) return alt.trim() ? ["decorative_alt"] : [];
  const issues: ImageSeoIssue[] = [];
  if (!alt.trim() && !hasAltAttribute) issues.push("missing_alt");
  if (isStuffedAlt(alt)) issues.push("stuffed_alt");
  return issues;
}

function candidateId(articleId: string, kind: ImageSeoKind, index: number) {
  return `${articleId}|${kind}|${index}`;
}

function imageContext(article: ImageSeoArticle, start: number, length: number) {
  const before = article.body.slice(Math.max(0, start - 700), start);
  const after = article.body.slice(start + length, start + length + 700);
  return cleanText(`${article.title}. ${stripHtml(before)} [IMAGE] ${stripHtml(after)}`).slice(0, 1_200);
}

function setImageAlt(tag: string, alt: string) {
  const encoded = escapeHtmlAttribute(alt);
  const altPattern = /\s+alt\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i;
  if (altPattern.test(tag)) return tag.replace(altPattern, ` alt="${encoded}"`);
  return tag.replace(/\s*\/?>$/, (ending) => ` alt="${encoded}"${ending}`);
}

function readAttribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function decodeHtmlAttribute(value: string) {
  return value.replace(/&quot;/gi, "\"").replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&");
}

function stripHtml(value: string) {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
}

function cleanText(value: string) {
  return decodeHtmlAttribute(value).replace(/\s+/g, " ").trim();
}

function cleanAlt(value: string) {
  return value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}
