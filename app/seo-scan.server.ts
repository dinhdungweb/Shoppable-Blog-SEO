/**
 * SEO scan engine for blog posts, products, collections and store pages.
 * Shared by the SEO Analyzer route (manual scans) and /api/seo-worker
 * (background and scheduled scans). Server only.
 */
import crypto from "node:crypto";
import { type PlanLimits } from "./pricing-plans";
import prisma from "./db.server";
import { auditSeo as runSeoAudit, toStoredSeoIssues } from "./seo-audit";
import { LIVE_ISSUE_PREFIX, auditStorePageSnapshot, livePenalty, type LivePageIssue } from "./live-page-audit";
import { LIVE_PAGE_LIMIT, LIVE_PRODUCT_LIMIT, fetchPrimaryOrigin, runLiveChecks, type LiveCheckTarget } from "./live-page-audit.server";
import { getCatalogContentHash } from "./catalog-seo";
import { fetchShopDomains } from "./shopify-domains.server";
import { normalizeContentNavConfig } from "./content-navigation";
import { auditSeoPortfolio } from "./seo-portfolio-audit";
import { applyCatalogDuplicateIssues, auditCatalogResource, type CatalogSeoAudit } from "./catalog-seo";
import { fetchShopifyCatalogResources } from "./catalog-seo.server";


export type SeoCategory = "on_page" | "product_linking" | "image" | "schema" | "content";
export type SeoSeverity = "critical" | "warning" | "info" | "good";
export type Impact = "High" | "Medium" | "Low";
export type Effort = "High" | "Medium" | "Low";

export type ArticleInput = {
  id: string;
  title: string;
  handle: string;
  body: string;
  summary: string;
  imageUrl: string;
  imageAlt: string;
  imageWidth: number;
  imageHeight: number;
  updatedAt: string;
  publishedAt: string | null;
  seoTitle: string;
  seoDescription: string;
  blogId: string;
  blogTitle: string;
  blogHandle: string;
  authorName: string;
  seoHidden: boolean;
};

export type StoredSeoInput = {
  articleId: string;
  seoScore?: number | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  focusKeyword?: string | null;
  lastAnalyzedAt?: Date | null;
};

export type SeoIssue = {
  type: string;
  category: SeoCategory;
  label: string;
  message: string;
  severity: SeoSeverity;
  impact: Impact;
  effort: Effort;
  fix: string;
  points?: number;
};

export type AuditedPost = ArticleInput & {
  productCount: number;
  score: number;
  baseScore: number;
  issues: SeoIssue[];
  lastAnalyzedAt: string | null;
  effectiveSeoTitle: string;
  effectiveSeoDescription: string;
  focusKeyword: string;
};

export type SeoAuditConfig = {
  addBlogSchema?: boolean;
  addProductSchema?: boolean;
  canContentNavigation?: boolean;
  tocEnabled?: boolean;
  tocAutoInsertEnabled?: boolean;
};

export const SEO_AUDIT_VERSION = 8;

export function safeTokenEqual(supplied: string, expected: string) {
  const suppliedHash = crypto.createHash("sha256").update(supplied).digest();
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(suppliedHash, expectedHash);
}

export function parseStoredIssues(value: string | null): SeoIssue[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    // Scans from older versions stored issues without impact, effort or fix: fill them so no badge or column is empty.
    return parsed
      .filter((issue): issue is SeoIssue => Boolean(issue && typeof issue.type === "string" && typeof issue.label === "string"))
      .map((issue) => ({
        ...issue,
        impact: issue.impact || (issue.severity === "critical" ? "High" : issue.severity === "warning" ? "Medium" : "Low"),
        effort: issue.effort || "Low",
        fix: issue.fix || issue.message || "",
      }));
  } catch {
    return [];
  }
}

export async function runSeoScan({
  admin,
  shop,
  limits,
  onProgress,
}: {
  admin: any;
  shop: string;
  limits: PlanLimits;
  onProgress?: (update: { phase: string; progress: number; totalPosts?: number; processedPosts?: number; analyzedPosts?: number }) => Promise<void>;
}) {
  const report = async (update: { phase: string; progress: number; totalPosts?: number; processedPosts?: number; analyzedPosts?: number }) => {
    if (onProgress) await onProgress(update);
  };

  const scanStartedAt = Date.now();
  await report({ phase: "Loading Shopify articles", progress: 5 });
  const [articles, catalogResources, linkedProducts, config, seoRows, resourceSeoRows, shopDomains] = await Promise.all([
    fetchShopifyArticles(admin, limits.seoBlogPosts, async (loadedPosts) => {
      const progress = Math.min(25, 5 + Math.ceil(loadedPosts / 100) * 3);
      await report({ phase: `Loading Shopify articles (${loadedPosts})`, progress, totalPosts: loadedPosts });
    }),
    limits.canCatalogSeo
      ? fetchShopifyCatalogResources(admin, async (type, loaded) => {
          await report({ phase: `Loading Shopify ${type}s (${loaded})`, progress: Math.min(25, 8 + Math.ceil(loaded / 100) * 2) });
        }, limits.seoCatalogResources)
      : Promise.resolve([]),
    prisma.articleProduct.findMany({
      where: { shop, isActive: true },
      select: { articleId: true },
    }),
    prisma.shopConfig.upsert({
      where: { shop },
      update: {},
      create: { shop },
    }),
    prisma.articleSEO.findMany({
      where: { shop },
      select: {
        articleId: true,
        articleTitle: true,
        seoScore: true,
        baseSeoScore: true,
        metaTitle: true,
        metaDescription: true,
        focusKeyword: true,
        issues: true,
        lastAnalyzedAt: true,
        sourceUpdatedAt: true,
        contentHash: true,
        auditVersion: true,
        liveCheckedAt: true,
      },
    }),
    prisma.resourceSEO.findMany({ where: { shop }, select: { resourceId: true, resourceType: true, contentHash: true, sourceUpdatedAt: true, focusKeyword: true, liveCheckedAt: true } }),
    fetchShopDomains(admin, shop),
  ]);
  await report({ phase: "Analyzing SEO", progress: 30, totalPosts: articles.length });
  const fetchDurationMs = Date.now() - scanStartedAt;

  const productCountMap = new Map<string, number>();
  linkedProducts.forEach((product) => {
    productCountMap.set(product.articleId, (productCountMap.get(product.articleId) || 0) + 1);
  });

  const storedSeoMap = new Map(seoRows.map((row) => [row.articleId, row]));
  const contentNavConfig = normalizeContentNavConfig(config);
  const seoAuditConfig: SeoAuditConfig = {
    ...config,
    canContentNavigation: limits.canContentNavigation,
    tocEnabled: contentNavConfig.tocEnabled,
    tocAutoInsertEnabled: contentNavConfig.tocAutoInsertEnabled,
  };
  let analyzedCount = 0;
  const baseScoreMap = new Map<string, number>();
  const contentHashMap = new Map<string, string>();
  const audits: AuditedPost[] = [];
  for (let index = 0; index < articles.length; index += 1) {
    const article = articles[index];
    const stored = storedSeoMap.get(article.id);
    const contentHash = getSeoContentHash(article, productCountMap.get(article.id) || 0, seoAuditConfig);
    contentHashMap.set(article.id, contentHash);
    const sourceUpdatedAt = article.updatedAt ? new Date(article.updatedAt) : null;
    const unchanged = Boolean(stored && stored.auditVersion === SEO_AUDIT_VERSION && stored.contentHash === contentHash && datesEqual(stored.sourceUpdatedAt, sourceUpdatedAt));
    // The engine is cheap and deterministic, so every post is re-scored; the
    // content hash only decides whether a post counts as newly analyzed.
    const audit = auditArticle(article, productCountMap.get(article.id) || 0, seoAuditConfig, stored, shop, shopDomains);
    if (!unchanged) analyzedCount += 1;
    baseScoreMap.set(article.id, audit.score);
    audits.push({
      ...article,
      productCount: productCountMap.get(article.id) || 0,
      score: audit.score,
      baseScore: audit.score,
      issues: audit.issues,
      lastAnalyzedAt: stored?.lastAnalyzedAt?.toISOString() || null,
      effectiveSeoTitle: getEffectiveSeoTitle(article),
      effectiveSeoDescription: getEffectiveSeoDescription(article),
      focusKeyword: textValue(stored?.focusKeyword),
    });
    const processedPosts = index + 1;
    if (processedPosts % 20 === 0 || processedPosts === articles.length) {
      const auditProgress = articles.length ? Math.round(30 + (processedPosts / articles.length) * 25) : 55;
      await report({ phase: "Analyzing article SEO", progress: auditProgress, totalPosts: articles.length, processedPosts, analyzedPosts: analyzedCount });
    }
  }
  await report({ phase: "Analyzing portfolio relationships", progress: 56, totalPosts: articles.length, processedPosts: articles.length, analyzedPosts: analyzedCount });
  // Orphan detection is only reliable when every post was scanned.
  const scanCoversAllPosts = !Number.isFinite(limits.seoBlogPosts) || articles.length < limits.seoBlogPosts;
  applyPortfolioIssues(audits, scanCoversAllPosts);

  // ── Live storefront checks ──────────────────────────────────────────────
  // What Google sees depends on the theme too, so a rotating sample of pages is
  // fetched from the storefront each scan (least recently checked first).
  const origin = await fetchPrimaryOrigin(admin);
  const blogs = new Map(articles.filter((article) => article.blogId && article.blogHandle).map((article) => [article.blogId, { handle: article.blogHandle, title: article.blogTitle }]));
  const storePageTargets: Array<LiveCheckTarget & { title: string; path: string }> = origin && limits.canCatalogSeo
    ? [
        { key: "homepage", url: `${origin}/`, expectArticleSchema: false, title: "Homepage", path: "/" },
        ...[...blogs].slice(0, 5).map(([blogId, blog]) => ({ key: blogId, url: `${origin}/blogs/${blog.handle}`, expectArticleSchema: false, title: `${blog.title} (blog listing)`, path: `/blogs/${blog.handle}` })),
      ]
    : [];
  const articleTargets: LiveCheckTarget[] = origin
    ? audits
        .filter((audit) => audit.publishedAt && !audit.seoHidden && audit.blogHandle && audit.handle)
        .sort((a, b) => (storedSeoMap.get(a.id)?.liveCheckedAt?.getTime() || 0) - (storedSeoMap.get(b.id)?.liveCheckedAt?.getTime() || 0))
        .slice(0, LIVE_PAGE_LIMIT)
        .map((audit) => ({ key: audit.id, url: `${origin}/blogs/${audit.blogHandle}/${audit.handle}`, expectArticleSchema: true }))
    : [];
  // Product pages show what Google uses for product rich results (Product schema with offers).
  const productLiveChecked = new Map(resourceSeoRows.filter((row) => row.resourceType === "product").map((row) => [row.resourceId, row.liveCheckedAt?.getTime() || 0]));
  const productTargets: LiveCheckTarget[] = origin && limits.canCatalogSeo
    ? catalogResources
        .filter((resource) => resource.type === "product" && !resource.seoHidden && resource.handle)
        .sort((a, b) => (productLiveChecked.get(a.id) || 0) - (productLiveChecked.get(b.id) || 0))
        .slice(0, LIVE_PRODUCT_LIMIT)
        .map((resource) => ({ key: resource.id, url: `${origin}/products/${resource.handle}`, expectArticleSchema: false, expectProductSchema: true }))
    : [];
  const liveTargetCount = storePageTargets.length + articleTargets.length + productTargets.length;
  await report({ phase: `Checking live storefront pages (0/${liveTargetCount})`, progress: 57, totalPosts: articles.length, analyzedPosts: analyzedCount });
  const live = await runLiveChecks([...storePageTargets, ...articleTargets, ...productTargets], origin, async (done) => {
    if (done % 5 === 0 || done === liveTargetCount) await report({ phase: `Checking live storefront pages (${done}/${liveTargetCount})`, progress: 57 + Math.round((done / Math.max(1, liveTargetCount)) * 2), totalPosts: articles.length, analyzedPosts: analyzedCount });
  });
  for (const audit of audits) {
    const result = live.results.get(audit.id);
    // Posts not checked this scan keep their previous live findings.
    const liveIssues: SeoIssue[] = result
      ? result.issues.map(toLiveSeoIssue)
      : parseStoredIssues(storedSeoMap.get(audit.id)?.issues ?? null).filter((issue) => issue.type.startsWith(LIVE_ISSUE_PREFIX));
    audit.issues.push(...liveIssues);
    audit.score = Math.max(0, audit.score - livePenalty(liveIssues));
  }
  await report({ phase: "Saving results", progress: 60, totalPosts: articles.length, analyzedPosts: analyzedCount });
  const auditDurationMs = Date.now() - scanStartedAt - fetchDurationMs;

  const articleIds = articles.map((a) => a.id);

  // Only a full, unlimited scan can safely identify obsolete records. Limited
  // plans intentionally leave out-of-scope records untouched.
  if (!Number.isFinite(limits.seoBlogPosts)) {
    await prisma.articleSEO.deleteMany({
      where: { shop, articleId: { notIn: articleIds } },
    });
    const scannedArticleIds = [...articleIds, ...articleIds.map((id) => id.replace(/^gid:\/\/shopify\/Article\//, ""))];
    await prisma.articleProduct.deleteMany({
      where: { shop, articleId: { notIn: scannedArticleIds } },
    });
  }

  const saveAudit = (audit: AuditedPost) => {
      const article = audit;
      // Shopify is the source of truth; merchants may edit SEO fields outside the app.
      const metaTitle = textValue(audit.seoTitle) || null;
      const metaDescription = textValue(audit.seoDescription) || null;

      const liveCheckedAt = live.results.has(article.id) ? { liveCheckedAt: new Date() } : {};
      return prisma.articleSEO.upsert({
        where: { shop_articleId: { shop, articleId: article.id } },
        update: {
          ...liveCheckedAt,
          shop,
          articleTitle: article.title,
          seoScore: audit.score,
          baseSeoScore: baseScoreMap.get(article.id) ?? audit.score,
          metaTitle,
          metaDescription,
          issues: JSON.stringify(audit.issues),
          lastAnalyzedAt: new Date(),
          articleHandle: article.handle,
          blogTitle: article.blogTitle,
          blogHandle: article.blogHandle,
          imageUrl: article.imageUrl,
          imageAlt: article.imageAlt,
          sourceUpdatedAt: article.updatedAt ? new Date(article.updatedAt) : null,
          publishedAt: article.publishedAt ? new Date(article.publishedAt) : null,
          contentHash: contentHashMap.get(article.id),
          auditVersion: SEO_AUDIT_VERSION,
        },
        create: {
          ...liveCheckedAt,
          shop,
          articleId: article.id,
          articleTitle: article.title,
          seoScore: audit.score,
          baseSeoScore: baseScoreMap.get(article.id) ?? audit.score,
          metaTitle,
          metaDescription,
          issues: JSON.stringify(audit.issues),
          lastAnalyzedAt: new Date(),
          articleHandle: article.handle,
          blogTitle: article.blogTitle,
          blogHandle: article.blogHandle,
          imageUrl: article.imageUrl,
          imageAlt: article.imageAlt,
          sourceUpdatedAt: article.updatedAt ? new Date(article.updatedAt) : null,
          publishedAt: article.publishedAt ? new Date(article.publishedAt) : null,
          contentHash: contentHashMap.get(article.id),
          auditVersion: SEO_AUDIT_VERSION,
        },
      });
  };
  const batchSize = 25;
  for (let index = 0; index < audits.length; index += batchSize) {
    const batch = audits.slice(index, index + batchSize);
    await Promise.all(batch.map(saveAudit));
    const processedPosts = Math.min(index + batch.length, audits.length);
    const saveProgress = audits.length ? Math.round(60 + (processedPosts / audits.length) * 35) : 95;
    await report({ phase: "Saving results", progress: saveProgress, totalPosts: audits.length, processedPosts, analyzedPosts: analyzedCount });
  }

  await report({ phase: "Analyzing product and collection SEO", progress: 96, totalPosts: articles.length + catalogResources.length, processedPosts: articles.length, analyzedPosts: analyzedCount });
  const storedResourceMap = new Map(resourceSeoRows.map((row) => [`${row.resourceType}:${row.resourceId}`, row]));
  const catalogAudits = catalogResources.map((resource) => auditCatalogResource({
    ...resource,
    focusKeyword: storedResourceMap.get(`${resource.type}:${resource.id}`)?.focusKeyword || "",
  }));
  applyCatalogDuplicateIssues(catalogAudits.filter((audit) => audit.type === "product"));
  applyCatalogDuplicateIssues(catalogAudits.filter((audit) => audit.type === "collection"));
  // Live product findings: fresh for products checked this scan, carried over for the rest.
  const checkedProducts = new Set(productTargets.map((target) => target.key).filter((key) => live.results.has(key)));
  const previousLiveRows = limits.canCatalogSeo
    ? await prisma.resourceSEO.findMany({
        where: { shop, resourceType: "product", issues: { contains: `"type":"${LIVE_ISSUE_PREFIX}` }, resourceId: { notIn: [...checkedProducts] } },
        select: { resourceId: true, issues: true },
      })
    : [];
  const previousLive = new Map(previousLiveRows.map((row) => [row.resourceId, parseStoredIssues(row.issues).filter((issue) => issue.type.startsWith(LIVE_ISSUE_PREFIX))]));
  for (const audit of catalogAudits) {
    if (audit.type !== "product") continue;
    const result = live.results.get(audit.id);
    const liveIssues = result ? result.issues.map(toLiveSeoIssue) : previousLive.get(audit.id) || [];
    if (!liveIssues.length) continue;
    audit.issues.push(...liveIssues.map((issue) => ({ type: issue.type, label: issue.label, message: issue.message, impact: issue.impact || "Medium", effort: issue.effort === "Low" ? "Low" as const : "Medium" as const, fix: issue.fix || "", ...(issue.points ? { points: issue.points } : {}) })));
    audit.score = Math.max(0, audit.score - livePenalty(liveIssues, 15));
  }
  const storePageAudits: CatalogSeoAudit[] = storePageTargets.flatMap((target) => {
    const result = live.results.get(target.key);
    if (!result) return [];
    const audit = auditStorePageSnapshot(result.snapshot, result.issues);
    const resource = {
      id: target.key, type: "page" as const, title: target.title, handle: target.path, descriptionHtml: "", updatedAt: "", status: "ACTIVE",
      seoTitle: result.snapshot?.title || "", seoDescription: result.snapshot?.metaDescription || "",
      imageUrl: "", imageAlt: "", imageWidth: 0, imageHeight: 0, itemCount: 0,
    };
    return [{ ...resource, score: audit.score, issues: audit.issues, effectiveSeoTitle: resource.seoTitle, effectiveSeoDescription: resource.seoDescription, contentHash: getCatalogContentHash(resource) }];
  });
  catalogAudits.push(...storePageAudits);
  applyCatalogDuplicateIssues(catalogAudits.filter((audit) => audit.type === "page"));
  analyzedCount += catalogAudits.filter((audit) => {
    const stored = storedResourceMap.get(`${audit.type}:${audit.id}`);
    return !stored || stored.contentHash !== audit.contentHash || !datesEqual(stored.sourceUpdatedAt, audit.updatedAt ? new Date(audit.updatedAt) : null);
  }).length;
  for (let index = 0; index < catalogAudits.length; index += batchSize) {
    const batch = catalogAudits.slice(index, index + batchSize);
    await Promise.all(batch.map((audit) => saveCatalogAudit(shop, audit, checkedProducts.has(audit.id))));
  }
  if (limits.canCatalogSeo) {
    for (const resourceType of ["product", "collection", "page"] as const) {
      // A plan-capped scan only covers the most recently updated resources; older records stay as they were.
      if (Number.isFinite(limits.seoCatalogResources) && catalogResources.filter((resource) => resource.type === resourceType).length >= limits.seoCatalogResources) continue;
      // Store pages that could not be fetched this time keep their previous result.
      const keep = [...catalogAudits.filter((audit) => audit.type === resourceType).map((audit) => audit.id), ...(resourceType === "page" ? storePageTargets.map((target) => target.key) : [])];
      await prisma.resourceSEO.deleteMany({ where: { shop, resourceType, resourceId: { notIn: keep } } });
    }
  }
  await report({ phase: "Saving catalog SEO results", progress: 99, totalPosts: articles.length + catalogAudits.length, processedPosts: articles.length + catalogAudits.length, analyzedPosts: analyzedCount });

  const durationMs = Date.now() - scanStartedAt;
  console.info("SEO incremental scan timing", { shop, articles: articles.length, catalogResources: catalogAudits.length, analyzedCount, fetchDurationMs, auditDurationMs, durationMs });
  return {
    scannedCount: audits.length + catalogAudits.length,
    analyzedCount,
    averageScore: getAverageScore([...audits, ...catalogAudits]),
  };
}

export function toLiveSeoIssue(issue: LivePageIssue): SeoIssue {
  return { type: issue.type, category: issue.category, label: issue.label, message: issue.message, severity: issue.severity, impact: issue.impact, effort: issue.effort, fix: issue.fix, points: issue.points };
}

export function saveCatalogAudit(shop: string, audit: CatalogSeoAudit, liveChecked = false) {
  const data = {
    shop, resourceType: audit.type, title: audit.title, handle: audit.handle, status: audit.status, seoScore: audit.score,
    metaTitle: audit.effectiveSeoTitle, metaDescription: audit.effectiveSeoDescription,
    imageUrl: audit.imageUrl, imageAlt: audit.imageAlt, issues: JSON.stringify(audit.issues), contentHash: audit.contentHash,
    issueCount: audit.issues.length,
    sourceUpdatedAt: audit.updatedAt ? new Date(audit.updatedAt) : null, lastAnalyzedAt: new Date(),
    ...(liveChecked ? { liveCheckedAt: new Date() } : {}),
  };
  return prisma.resourceSEO.upsert({
    where: { shop_resourceType_resourceId: { shop, resourceType: audit.type, resourceId: audit.id } },
    update: data,
    create: { ...data, resourceId: audit.id },
  });
}

export async function fetchShopifyArticles(admin: any, limit: number, onPage?: (loadedPosts: number) => Promise<void>): Promise<ArticleInput[]> {
  const articles: ArticleInput[] = [];
  let cursor: string | null = null;
  let hasNextPage = limit > 0;
  while (hasNextPage) {
    const pageSize = Number.isFinite(limit) ? Math.min(100, Math.max(1, limit - articles.length)) : 100;
    const response = await admin.graphql(`#graphql
      query SeoArticles($after: String, $first: Int!) {
        articles(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
          nodes { id title handle updatedAt publishedAt author { name } body summary image { url altText width height }
            seoTitle: metafield(namespace: "global", key: "title_tag") { value }
            seoDescription: metafield(namespace: "global", key: "description_tag") { value }
            seoHidden: metafield(namespace: "seo", key: "hidden") { value }
            blog { id title handle }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`, { variables: { after: cursor, first: pageSize } });
    const result: any = await response.json();
    if (result.errors?.length) throw new Error(result.errors.map((error: any) => error.message).join("; ") || "Could not load Shopify blog posts.");
    const connection = result.data?.articles;
    for (const article of connection?.nodes || []) {
      articles.push({
      id: article.id,
      title: cleanText(article.title) || "Untitled post",
      handle: cleanText(article.handle),
      body: article.body || "",
      summary: article.summary || "",
      imageUrl: article.image?.url || "",
      imageAlt: article.image?.altText || "",
      imageWidth: article.image?.width || 0,
      imageHeight: article.image?.height || 0,
      updatedAt: article.updatedAt || "",
      publishedAt: article.publishedAt || null,
      seoTitle: article.seoTitle?.value || "",
      seoDescription: article.seoDescription?.value || "",
      blogId: article.blog?.id || "",
      blogTitle: article.blog?.title || "Blog",
      blogHandle: article.blog?.handle || "",
      authorName: article.author?.name || "",
      seoHidden: article.seoHidden?.value === "1",
      });
    }
    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage) && (!Number.isFinite(limit) || articles.length < limit);
    cursor = connection?.pageInfo?.endCursor || null;
    if (onPage) await onPage(articles.length);
    if (hasNextPage && !cursor) throw new Error("Shopify article pagination did not return a cursor.");
  }
  return articles;
}

export function auditArticle(
  article: ArticleInput,
  productCount: number,
  config: SeoAuditConfig,
  storedSeo?: StoredSeoInput | null,
  shopDomain?: string,
  shopDomains: string[] = [],
): { score: number; issues: SeoIssue[] } {
  const result = runSeoAudit({
    title: getEffectiveSeoTitle(article),
    handle: article.handle || "",
    summary: getEffectiveSeoDescription(article),
    body: article.body || "",
    hasImage: Boolean(article.imageUrl),
    imageAlt: article.imageAlt || "",
    imageWidth: article.imageWidth,
    imageHeight: article.imageHeight,
    productCount,
    focusKeyword: textValue(storedSeo?.focusKeyword),
    authorName: article.authorName,
    publishedAt: article.publishedAt,
    updatedAt: article.updatedAt,
    shopDomain,
    shopDomains,
    canUseTableOfContents: Boolean(config.canContentNavigation),
    tocEnabled: Boolean(config.tocEnabled),
    tocAutoInsertEnabled: Boolean(config.tocAutoInsertEnabled),
    hiddenFromSearch: article.seoHidden,
  });
  const issues: SeoIssue[] = toStoredSeoIssues(result.issues);
  if (productCount === 0) {
    // A shoppable-blog metric, not an SEO problem: listed for convenience, never scored.
    issues.push({
      type: "no_linked_products",
      category: "product_linking",
      label: "No linked products",
      message: "This post has no shoppable products. This does not affect the SEO score.",
      severity: "info",
      impact: "Low",
      effort: "Medium",
      fix: "Link products that readers of this post are likely to buy.",
    });
  }
  return { score: result.score, issues };
}

export function applyPortfolioIssues(posts: AuditedPost[], includeOrphans: boolean) {
  const portfolioIssues = auditSeoPortfolio(posts.map((post) => ({
    id: post.id,
    title: post.title,
    seoTitle: post.effectiveSeoTitle,
    seoDescription: post.effectiveSeoDescription,
    focusKeyword: post.focusKeyword,
    body: post.body,
    blogHandle: post.blogHandle,
    handle: post.handle,
    publishedAt: post.publishedAt,
  })), { includeOrphans });

  posts.forEach((post) => {
    const additions = portfolioIssues.get(post.id) || [];
    additions.forEach((issue) => {
      post.issues.push({
        type: issue.type,
        category: issue.type === "orphan_article" || issue.type === "near_duplicate_content" ? "content" : "on_page",
        label: issue.label,
        message: issue.message,
        severity: issue.severity,
        impact: issue.impact,
        effort: issue.effort,
        fix: issue.fix,
      });
    });
    post.score = Math.max(0, post.score - additions.reduce((sum, issue) => sum + issue.penalty, 0));
  });
}

export function getAverageScore(posts: Array<{ score: number }>) {
  if (!posts.length) return 0;
  return Math.round(posts.reduce((sum, post) => sum + post.score, 0) / posts.length);
}

export function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function isLikelyStaleAutoMetaTitle(metaTitle: string, articleTitle: string) {
  const meta = metaTitle.trim();
  const title = articleTitle.trim();

  return Boolean(
    meta &&
      title &&
      meta.length <= 2 &&
      meta.length < title.length &&
      title.toLowerCase().startsWith(meta.toLowerCase()),
  );
}

export function getEffectiveSeoTitle(article: ArticleInput) {
  const title = textValue(article.title);
  const shopifySeoTitle = textValue(article.seoTitle);
  if (shopifySeoTitle && !isLikelyStaleAutoMetaTitle(shopifySeoTitle, title)) return shopifySeoTitle;
  return title;
}

export function getEffectiveSeoDescription(article: ArticleInput) {
  // Shopify themes fall back to the excerpt when no SEO description is saved.
  return textValue(article.seoDescription) || textValue(article.summary).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function getSeoContentHash(article: ArticleInput, productCount: number, config: SeoAuditConfig) {
  return crypto.createHash("sha256").update(JSON.stringify({
    title: article.title, handle: article.handle, body: article.body, summary: article.summary, publishedAt: article.publishedAt,
    imageUrl: article.imageUrl, imageAlt: article.imageAlt, imageWidth: article.imageWidth, imageHeight: article.imageHeight, seoTitle: article.seoTitle,
    seoDescription: article.seoDescription, authorName: article.authorName, productCount,
    config: { addBlogSchema: config.addBlogSchema, addProductSchema: config.addProductSchema, canContentNavigation: config.canContentNavigation, tocEnabled: config.tocEnabled, tocAutoInsertEnabled: config.tocAutoInsertEnabled },
  })).digest("hex");
}

export function datesEqual(left: Date | null | undefined, right: Date | null) {
  return (left?.getTime() || 0) === (right?.getTime() || 0);
}

