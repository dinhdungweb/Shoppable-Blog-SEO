export type PortfolioSeoPost = {
  id: string;
  title: string;
  seoTitle: string;
  seoDescription: string;
  focusKeyword: string;
  body: string;
  blogHandle: string;
  handle: string;
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

export function auditSeoPortfolio(posts: PortfolioSeoPost[]) {
  const issues = new Map<string, PortfolioSeoIssue[]>();
  posts.forEach((post) => issues.set(post.id, []));

  addDuplicateIssues(posts, issues, "seoTitle", "duplicate_seo_title", "Duplicate SEO title", 8);
  addDuplicateIssues(posts, issues, "seoDescription", "duplicate_meta_description", "Duplicate meta description", 6);
  addKeywordCannibalization(posts, issues);
  addOrphanIssues(posts, issues);
  addNearDuplicateIssues(posts, issues);
  return issues;
}

function addDuplicateIssues(
  posts: PortfolioSeoPost[],
  result: Map<string, PortfolioSeoIssue[]>,
  field: "seoTitle" | "seoDescription",
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
      message: `${group.length} posts share the same ${field === "seoTitle" ? "SEO title" : "meta description"}: ${names}.`,
      severity: "warning",
      impact: field === "seoTitle" ? "High" : "Medium",
      effort: "Low",
      fix: `Write a unique ${field === "seoTitle" ? "title that matches this post's intent" : "description with a post-specific benefit"}.`,
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
      const target = [...postByPath.entries()].find(([path]) => href.includes(path))?.[1];
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
  if (posts.length > 300) return;
  const tokenSets = new Map(posts.map((post) => [post.id, words(post.body)]));
  for (let leftIndex = 0; leftIndex < posts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < posts.length; rightIndex += 1) {
      const left = posts[leftIndex];
      const right = posts[rightIndex];
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

function findRelatedPost(target: PortfolioSeoPost, posts: PortfolioSeoPost[]) {
  const targetWords = words(`${target.title} ${target.focusKeyword}`);
  return posts
    .filter((post) => post.id !== target.id)
    .map((post) => ({ post, score: jaccard(targetWords, words(`${post.title} ${post.focusKeyword} ${post.body.slice(0, 800)}`)) }))
    .sort((left, right) => right.score - left.score)[0]?.post;
}

function groupBy(posts: PortfolioSeoPost[], key: (post: PortfolioSeoPost) => string) {
  const groups = new Map<string, PortfolioSeoPost[]>();
  posts.forEach((post) => groups.set(key(post), [...(groups.get(key(post)) || []), post]));
  return groups;
}

function getHrefs(body: string) {
  return Array.from(body.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi), (match) => match[1].toLowerCase());
}

function words(value: string) {
  return new Set(normalizeText(value.replace(/<[^>]*>/g, " ")).split(" ").filter((word) => word.length > 3));
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((word) => right.has(word)).length;
  return intersection / new Set([...left, ...right]).size;
}

function normalizeText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function push(result: Map<string, PortfolioSeoIssue[]>, postId: string, issue: PortfolioSeoIssue) {
  result.get(postId)?.push(issue);
}
