export type PortfolioSeoPost = {
  id: string;
  title: string;
  seoTitle: string;
  seoDescription: string;
  focusKeyword: string;
  body: string;
  blogHandle: string;
  handle: string;
  publishedAt?: string | null;
};

export type PortfolioSeoIssue = {
  type: string;
  label: string;
  message: string;
  severity: "critical" | "warning" | "info";
  impact: "High" | "Medium" | "Low";
  effort: "High" | "Medium" | "Low";
  fix: string;
  penalty: number;
};

const relatedPostCache = new WeakMap<PortfolioSeoPost[], Map<string, PortfolioSeoPost | undefined>>();
const relatedTokenCache = new WeakMap<PortfolioSeoPost[], Map<string, Set<string>>>();

export function auditSeoPortfolio(posts: PortfolioSeoPost[]) {
  const issues = new Map<string, PortfolioSeoIssue[]>();
  posts.forEach((post) => issues.set(post.id, []));

  addDuplicateIssues(posts, issues, "title", "duplicate_article_title", "Duplicate article title", 8);
  addDuplicateIssues(posts, issues, "seoTitle", "duplicate_seo_title", "Duplicate SEO title", 8);
  addDuplicateIssues(posts, issues, "seoDescription", "duplicate_meta_description", "Duplicate meta description", 6);
  addKeywordCannibalization(posts, issues);
  addSearchIntentOverlap(posts, issues);
  addOrphanIssues(posts, issues);
  addNearDuplicateIssues(posts, issues);
  return issues;
}

function addDuplicateIssues(
  posts: PortfolioSeoPost[],
  result: Map<string, PortfolioSeoIssue[]>,
  field: "title" | "seoTitle" | "seoDescription",
  type: string,
  label: string,
  penalty: number,
) {
  const groups = groupBy(posts, (post) => normalizeText(post[field]));
  groups.forEach((group, value) => {
    if (!value || group.length < 2) return;
    const names = group.map((post) => post.title).slice(0, 3).join(", ");
    group.forEach((post) => push(result, post.id, {
      type,
      label,
      message: `${group.length} posts share the same ${field === "title" ? "article title" : field === "seoTitle" ? "SEO title" : "meta description"}: ${names}.`,
      severity: "warning",
      impact: field === "seoDescription" ? "Medium" : "High",
      effort: "Low",
      fix: field === "seoDescription"
        ? "Write a unique description with a post-specific benefit."
        : "Give each post a distinct title and search intent, or consolidate overlapping posts.",
      penalty,
    }));
  });
}

function addKeywordCannibalization(posts: PortfolioSeoPost[], result: Map<string, PortfolioSeoIssue[]>) {
  const groups = groupBy(posts, (post) => normalizeText(post.focusKeyword.split(",")[0] || ""));
  groups.forEach((group, keyword) => {
    if (!keyword || group.length < 2) return;
    group.forEach((post) => push(result, post.id, {
      type: "keyword_cannibalization",
      label: "Keyword cannibalization",
      message: `${group.length} posts target “${keyword}” as their primary keyword.`,
      severity: "warning",
      impact: "High",
      effort: "Medium",
      fix: "Give each post a distinct search intent, or consolidate and redirect overlapping posts.",
      penalty: 7,
    }));
  });
}

function addSearchIntentOverlap(posts: PortfolioSeoPost[], result: Map<string, PortfolioSeoIssue[]>) {
  const intentTokens = new Map(posts.map((post) => [post.id, words(`${post.title} ${post.seoTitle}`)]));
  for (let leftIndex = 0; leftIndex < posts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < posts.length; rightIndex += 1) {
      const left = posts[leftIndex];
      const right = posts[rightIndex];
      const leftTokens = intentTokens.get(left.id) || new Set<string>();
      const rightTokens = intentTokens.get(right.id) || new Set<string>();
      if (Math.min(leftTokens.size, rightTokens.size) < 2) continue;
      const similarity = jaccard(leftTokens, rightTokens);
      if (similarity < 0.6) continue;
      if (normalizeText(left.title) === normalizeText(right.title)) continue;
      if (primaryKeyword(left) && primaryKeyword(left) === primaryKeyword(right)) continue;

      const older = olderPost(left, right);
      [left, right].forEach((post) => {
        const other = post.id === left.id ? right : left;
        push(result, post.id, {
          type: "search_intent_overlap",
          label: "Overlapping search intent",
          message: `This post appears to target a similar intent to “${other.title}” (${Math.round(similarity * 100)}% topic similarity).${older ? ` “${older.title}” is the older article.` : ""}`,
          severity: "warning",
          impact: "High",
          effort: "Medium",
          fix: "Choose one primary page, merge useful content where appropriate, assign the other post a distinct focus topic, update internal links, and create a Shopify URL redirect if a post is removed.",
          penalty: 6,
        });
      });
    }
  }
}

function addOrphanIssues(posts: PortfolioSeoPost[], result: Map<string, PortfolioSeoIssue[]>) {
  if (posts.length < 2) return;
  const inboundCounts = new Map(posts.map((post) => [post.id, 0]));
  const postByPath = new Map(
    posts
      .filter((post) => post.blogHandle && post.handle)
      .map((post) => [`/blogs/${post.blogHandle}/${post.handle}`.toLowerCase(), post]),
  );
  posts.forEach((source) => {
    const hrefs = getHrefs(source.body);
    hrefs.forEach((href) => {
      const target = postByPath.get(normalizeHrefPath(href));
      if (target && source.id !== target.id) inboundCounts.set(target.id, (inboundCounts.get(target.id) || 0) + 1);
    });
  });
  posts.forEach((post) => {
    if ((inboundCounts.get(post.id) || 0) > 0) return;
    push(result, post.id, {
      type: "orphan_article",
      label: "Orphan article",
      message: "No other scanned blog post links to this article.",
      severity: "warning",
      impact: "Medium",
      effort: "Low",
      fix: `Add a contextual link from a relevant article${findRelatedPost(post, posts) ? ` such as “${findRelatedPost(post, posts)?.title}”` : " or topic hub"}.`,
      penalty: 4,
    });
  });
}

function addNearDuplicateIssues(posts: PortfolioSeoPost[], result: Map<string, PortfolioSeoIssue[]>) {
  const tokenSets = new Map(posts.map((post) => [post.id, words(post.body)]));
  const candidatePairs = posts.length > 300 ? buildNearDuplicateCandidates(posts, tokenSets) : null;
  for (let leftIndex = 0; leftIndex < posts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < posts.length; rightIndex += 1) {
      const left = posts[leftIndex];
      const right = posts[rightIndex];
      if (candidatePairs && !candidatePairs.has(pairKey(left.id, right.id))) continue;
      const leftWords = tokenSets.get(left.id) || new Set<string>();
      const rightWords = tokenSets.get(right.id) || new Set<string>();
      const similarity = jaccard(leftWords, rightWords);
      if (similarity < 0.72 || Math.min(leftWords.size, rightWords.size) < 40) continue;
      [left, right].forEach((post) => push(result, post.id, {
        type: "near_duplicate_content",
        label: "Near-duplicate content",
        message: `Content substantially overlaps with “${post.id === left.id ? right.title : left.title}” (${Math.round(similarity * 100)}% term similarity).`,
        severity: "warning",
        impact: "High",
        effort: "High",
        fix: "Differentiate the search intent and original value, or merge the posts and redirect the weaker URL.",
        penalty: 8,
      }));
    }
  }
}

function buildNearDuplicateCandidates(posts: PortfolioSeoPost[], tokenSets: Map<string, Set<string>>) {
  const postings = new Map<string, string[]>();
  tokenSets.forEach((tokens, postId) => {
    tokens.forEach((token) => postings.set(token, [...(postings.get(token) || []), postId]));
  });
  const sharedCounts = new Map<string, number>();
  const maxFrequency = Math.max(20, Math.ceil(posts.length * 0.08));
  postings.forEach((postIds) => {
    if (postIds.length < 2 || postIds.length > maxFrequency) return;
    for (let left = 0; left < postIds.length; left += 1) {
      for (let right = left + 1; right < postIds.length; right += 1) {
        const key = pairKey(postIds[left], postIds[right]);
        sharedCounts.set(key, (sharedCounts.get(key) || 0) + 1);
      }
    }
  });
  return new Set([...sharedCounts].filter(([, count]) => count >= 20).map(([key]) => key));
}

function pairKey(left: string, right: string) {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

function primaryKeyword(post: PortfolioSeoPost) {
  return normalizeText(post.focusKeyword.split(",")[0] || "");
}

function olderPost(left: PortfolioSeoPost, right: PortfolioSeoPost) {
  const leftDate = left.publishedAt ? new Date(left.publishedAt).getTime() : Number.NaN;
  const rightDate = right.publishedAt ? new Date(right.publishedAt).getTime() : Number.NaN;
  if (!Number.isFinite(leftDate) || !Number.isFinite(rightDate) || leftDate === rightDate) return null;
  return leftDate < rightDate ? left : right;
}

function findRelatedPost(target: PortfolioSeoPost, posts: PortfolioSeoPost[]) {
  let results = relatedPostCache.get(posts);
  if (!results) {
    results = new Map();
    relatedPostCache.set(posts, results);
  }
  if (results.has(target.id)) return results.get(target.id);
  let tokens = relatedTokenCache.get(posts);
  if (!tokens) {
    tokens = new Map(posts.map((post) => [post.id, words(`${post.title} ${post.focusKeyword} ${post.body.slice(0, 800)}`)]));
    relatedTokenCache.set(posts, tokens);
  }
  const targetWords = words(`${target.title} ${target.focusKeyword}`);
  let best: PortfolioSeoPost | undefined;
  let bestScore = 0;
  posts.forEach((post) => {
    if (post.id === target.id) return;
    const score = jaccard(targetWords, tokens!.get(post.id) || new Set());
    if (score > bestScore) { best = post; bestScore = score; }
  });
  results.set(target.id, best);
  return best;
}

function groupBy(posts: PortfolioSeoPost[], key: (post: PortfolioSeoPost) => string) {
  const groups = new Map<string, PortfolioSeoPost[]>();
  posts.forEach((post) => groups.set(key(post), [...(groups.get(key(post)) || []), post]));
  return groups;
}

function getHrefs(body: string) {
  return Array.from(body.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi), (match) => match[1].toLowerCase());
}

function normalizeHrefPath(href: string) {
  try {
    return new URL(href, "https://store.invalid").pathname.replace(/\/$/, "").toLowerCase();
  } catch {
    return href.split(/[?#]/)[0].replace(/\/$/, "").toLowerCase();
  }
}

function words(value: string) {
  return new Set(normalizeText(value.replace(/<[^>]*>/g, " ")).split(" ").filter((word) => word.length > 3));
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  const smaller = left.size <= right.size ? left : right;
  const larger = smaller === left ? right : left;
  let intersection = 0;
  smaller.forEach((word) => { if (larger.has(word)) intersection += 1; });
  return intersection / (left.size + right.size - intersection);
}

function normalizeText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function push(result: Map<string, PortfolioSeoIssue[]>, postId: string, issue: PortfolioSeoIssue) {
  result.get(postId)?.push(issue);
}
