export type LinkArticle = {
  id: string;
  title: string;
  handle: string;
  blogHandle: string;
  body: string;
};

export type LinkSuggestion = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  targetId: string;
  targetTitle: string;
  targetUrl: string;
  anchorText: string;
  score: number;
};

export type BrokenLink = { sourceId: string; sourceTitle: string; href: string; kind: "article" | "product" };
export type RepeatedAnchor = { anchor: string; uses: number; destinations: number };
export type TopicCluster = { pillar: Pick<LinkArticle, "id" | "title">; supporting: Array<Pick<LinkArticle, "id" | "title">> };
export type InternalLinkReport = {
  auditVersion: number;
  articles: number;
  internalLinks: number;
  orphanArticles: Array<Pick<LinkArticle, "id" | "title">>;
  brokenLinks: BrokenLink[];
  repeatedAnchors: RepeatedAnchor[];
  suggestions: LinkSuggestion[];
  clusters: TopicCluster[];
};

const STOP_WORDS = new Set("a an and are as at be by for from how in is it of on or that the this to with your you our what why guide tips best những các một và cho của là về cách với trong từ tại được khi sản phẩm bài viết".split(" "));

export function analyzeInternalLinks(articles: LinkArticle[], productHandles: string[], shopDomains: string[] = []): InternalLinkReport {
  const articleByPath = new Map(articles.map((article) => [articlePath(article), article]));
  const products = new Set(productHandles.map((handle) => handle.toLowerCase()));
  const inbound = new Map(articles.map((article) => [article.id, 0]));
  const outgoing = new Map<string, Set<string>>();
  const anchors = new Map<string, Set<string>>();
  const anchorUses = new Map<string, number>();
  const brokenLinks: BrokenLink[] = [];
  let internalLinks = 0;

  for (const article of articles) {
    const targets = new Set<string>();
    for (const link of extractLinks(article.body)) {
      const path = normalizeInternalPath(link.href, shopDomains);
      if (!path) continue;
      internalLinks += 1;
      const anchor = cleanText(link.anchor).toLowerCase();
      if (anchor) {
        anchorUses.set(anchor, (anchorUses.get(anchor) || 0) + 1);
        anchors.set(anchor, new Set([...(anchors.get(anchor) || []), path]));
      }
      if (/^\/blogs\/[^/]+\/(?!tagged(?:\/|$))[^/]+$/.test(path)) {
        const target = articleByPath.get(path);
        if (target) {
          if (target.id !== article.id) inbound.set(target.id, (inbound.get(target.id) || 0) + 1);
          targets.add(target.id);
        } else {
          brokenLinks.push({ sourceId: article.id, sourceTitle: article.title, href: link.href, kind: "article" });
        }
      } else if (/^\/products\/[^/]+$/.test(path)) {
        const handle = path.split("/")[2] || "";
        if (!products.has(handle)) brokenLinks.push({ sourceId: article.id, sourceTitle: article.title, href: link.href, kind: "product" });
      }
    }
    outgoing.set(article.id, targets);
  }

  const suggestions = buildSuggestions(articles, outgoing);
  const orphanArticles = articles.filter((article) => (inbound.get(article.id) || 0) === 0).map(({ id, title }) => ({ id, title }));
  const repeatedAnchors = [...anchorUses.entries()]
    .map(([anchor, uses]) => ({ anchor, uses, destinations: anchors.get(anchor)?.size || 0 }))
    .filter((item) => item.uses >= 4 && item.destinations > 1)
    .sort((a, b) => b.uses - a.uses)
    .slice(0, 20);

  return {
    auditVersion: 2,
    articles: articles.length,
    internalLinks,
    orphanArticles,
    brokenLinks: uniqueBrokenLinks(brokenLinks),
    repeatedAnchors,
    suggestions,
    clusters: buildClusters(articles),
  };
}

export function insertApprovedLink(body: string, anchorText: string, targetUrl: string) {
  const escapedUrl = escapeAttribute(targetUrl);
  const escapedAnchor = escapeHtml(anchorText);
  const parts = body.split(/(<a\b[\s\S]*?<\/a>|<[^>]+>)/gi);
  const needle = anchorText.trim();
  let insideAnchor = false;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (/^<a\b/i.test(part)) insideAnchor = true;
    if (insideAnchor) {
      if (/<\/a>$/i.test(part)) insideAnchor = false;
      continue;
    }
    if (part.startsWith("<")) continue;
    const offset = part.toLowerCase().indexOf(needle.toLowerCase());
    if (offset >= 0) {
      parts[index] = `${part.slice(0, offset)}<a href="${escapedUrl}">${part.slice(offset, offset + needle.length)}</a>${part.slice(offset + needle.length)}`;
      return { body: parts.join(""), insertedInContext: true };
    }
  }
  return { body: `${body}<p>Related: <a href="${escapedUrl}">${escapedAnchor}</a></p>`, insertedInContext: false };
}

function buildSuggestions(articles: LinkArticle[], outgoing: Map<string, Set<string>>) {
  const tokens = new Map(articles.map((article) => [article.id, keywords(`${article.title} ${cleanText(article.body).slice(0, 2500)}`)]));
  const suggestions: LinkSuggestion[] = [];
  for (const source of articles) {
    const existing = outgoing.get(source.id) || new Set<string>();
    const candidates = articles
      .filter((target) => target.id !== source.id && !existing.has(target.id))
      .map((target) => ({ target, score: similarity(tokens.get(source.id)!, tokens.get(target.id)!) }))
      .filter((candidate) => candidate.score >= 0.08)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    for (const { target, score } of candidates) {
      suggestions.push({
        id: `${source.id}:${target.id}`,
        sourceId: source.id,
        sourceTitle: source.title,
        targetId: target.id,
        targetTitle: target.title,
        targetUrl: articlePath(target),
        anchorText: naturalAnchor(source.body, target.title),
        score: Math.round(score * 100),
      });
    }
  }
  return suggestions.sort((a, b) => b.score - a.score).slice(0, 200);
}

function buildClusters(articles: LinkArticle[]): TopicCluster[] {
  const tokenMap = new Map(articles.map((article) => [article.id, keywords(`${article.title} ${cleanText(article.body).slice(0, 1200)}`)]));
  const pillars = [...articles].sort((a, b) => cleanText(b.body).length - cleanText(a.body).length).slice(0, Math.min(8, Math.max(1, Math.ceil(articles.length / 20))));
  return pillars.map((pillar) => ({
    pillar: { id: pillar.id, title: pillar.title },
    supporting: articles.filter((article) => article.id !== pillar.id)
      .map((article) => ({ article, score: similarity(tokenMap.get(pillar.id)!, tokenMap.get(article.id)!) }))
      .filter((item) => item.score >= 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ article }) => ({ id: article.id, title: article.title })),
  })).filter((cluster) => cluster.supporting.length > 0);
}

function naturalAnchor(sourceBody: string, targetTitle: string) {
  const text = cleanText(sourceBody);
  const phrases = [targetTitle, ...targetTitle.split(/[:|–—-]/).map((part) => part.trim()).filter((part) => part.length >= 4)];
  const match = phrases.find((phrase) => text.toLowerCase().includes(phrase.toLowerCase()));
  return match || targetTitle.replace(/\s*[|–—-].*$/, "").trim();
}

function keywords(value: string) {
  return new Set(cleanText(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !STOP_WORDS.has(word)));
}
function similarity(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  left.forEach((word) => { if (right.has(word)) overlap += 1; });
  return overlap / Math.sqrt(left.size * right.size);
}
function articlePath(article: Pick<LinkArticle, "blogHandle" | "handle">) { return `/blogs/${article.blogHandle}/${article.handle}`.toLowerCase(); }
function normalizeInternalPath(href: string, shopDomains: string[]) {
  try {
    const url = new URL(href, "https://internal.invalid");
    const isRelative = !/^(?:https?:)?\/\//i.test(href);
    const allowedHosts = new Set(shopDomains.map(domainHost).filter(Boolean));
    if (!isRelative && !allowedHosts.has(url.hostname.toLowerCase())) return null;
    let path = url.pathname.replace(/\/$/, "").toLowerCase();
    const contentStart = path.search(/\/(?:blogs|products)\//);
    if (contentStart > 0) path = path.slice(contentStart);
    if (!path.startsWith("/blogs/") && !path.startsWith("/products/")) return null;
    return path;
  } catch { return null; }
}
function domainHost(value: string) {
  try { return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase(); }
  catch { return ""; }
}
function extractLinks(body: string) {
  const links: Array<{ href: string; anchor: string }> = [];
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body || ""))) links.push({ href: match[1], anchor: cleanText(match[2]) });
  return links;
}
function cleanText(value: string) { return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim(); }
function uniqueBrokenLinks(items: BrokenLink[]) { return [...new Map(items.map((item) => [`${item.sourceId}:${item.href}`, item])).values()]; }
function escapeHtml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function escapeAttribute(value: string) { return escapeHtml(value); }
