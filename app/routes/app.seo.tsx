import { useEffect, useMemo, useRef, useState } from "react";
import crypto from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate, useRevalidator, useSearchParams } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Banner,
  EmptyState,
  InlineGrid,
  InlineStack,
  Modal,
  ProgressBar,
  Text,
} from "@shopify/polaris";
import {
  AlertTriangleIcon,
  SearchIcon,
  XCircleIcon,
} from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate, getActivePlanAndLimits, getUnauthenticatedActivePlanName, unauthenticated } from "../shopify.server";
import { getLimitsForPlan, type PlanLimits } from "../pricing-plans";
import prisma from "../db.server";
import { auditSeo as runSeoAudit, toStoredSeoIssues } from "../seo-audit";
import { articleSearchPath, buildImpressionsByPath, formatImpressions, issuePriority } from "../seo-priority";
import { LIVE_ISSUE_PREFIX, auditStorePageSnapshot, livePenalty, type LivePageIssue } from "../live-page-audit";
import { LIVE_PAGE_LIMIT, LIVE_PRODUCT_LIMIT, fetchPrimaryOrigin, runLiveChecks, type LiveCheckTarget } from "../live-page-audit.server";
import { getCatalogContentHash } from "../catalog-seo";
import { fetchShopDomains } from "../shopify-domains.server";
import { normalizeContentNavConfig } from "../content-navigation";
import { auditSeoPortfolio } from "../seo-portfolio-audit";
import { getPublicSeoScanError } from "../seo-scan-error";
import { applyCatalogDuplicateIssues, auditCatalogResource, type CatalogSeoAudit } from "../catalog-seo";
import { fetchShopifyCatalogResources } from "../catalog-seo.server";
import catalogSeoStyles from "../styles/catalog-seo.css?url";
import { SEO_WORKSPACE_TABS } from "../components/WorkspaceTabs";
import { IssueScopeSwitcher } from "../components/IssueScopeSwitcher";
import { AppPage } from "../components/AppPage";
import { ActionRow, ActionRows, AiButton, Chips, DotScore, GroupLabel, IconTile, Pill, ScoreRing, StatTile, StatTiles, impactTone } from "../components/rm";

type SeoCategory = "on_page" | "product_linking" | "image" | "schema" | "content";
type SeoSeverity = "critical" | "warning" | "info" | "good";
type Impact = "High" | "Medium" | "Low";
type Effort = "High" | "Medium" | "Low";

type ArticleInput = {
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

type StoredSeoInput = {
  articleId: string;
  seoScore?: number | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  focusKeyword?: string | null;
  lastAnalyzedAt?: Date | null;
};

type SeoIssue = {
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

type AuditedPost = ArticleInput & {
  productCount: number;
  score: number;
  baseScore: number;
  issues: SeoIssue[];
  lastAnalyzedAt: string | null;
  effectiveSeoTitle: string;
  effectiveSeoDescription: string;
  focusKeyword: string;
};

type IssueGroup = {
  id: string;
  category: SeoCategory;
  issue: string;
  affected: number;
  impact: Impact;
  effort: Effort;
  /** Google Search Console impressions (28 days) on affected posts. */
  impressions: number;
  fix: string;
  actionLabel: string;
  examples: string[];
  targetPostId: string;
  affectedPosts: Array<{
    id: string;
    title: string;
    blogTitle: string;
  }>;
};

type SeoAuditConfig = {
  addBlogSchema?: boolean;
  addProductSchema?: boolean;
  canContentNavigation?: boolean;
  tocEnabled?: boolean;
  tocAutoInsertEnabled?: boolean;
};

const PLACEHOLDER_IMAGE = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";
// v8: single engine (seo-audit.ts), Shopify-sourced metadata, area-based scoring.
const SEO_AUDIT_VERSION = 8;

function safeTokenEqual(supplied: string, expected: string) {
  const suppliedHash = crypto.createHash("sha256").update(supplied).digest();
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(suppliedHash, expectedHash);
}

const CATEGORY_TABS: Array<{ id: SeoCategory | "all"; content: string }> = [
  { id: "all", content: "All issues" },
  { id: "on_page", content: "On-page SEO" },
  { id: "product_linking", content: "Product linking" },
  { id: "image", content: "Images" },
  { id: "schema", content: "Schema" },
  { id: "content", content: "Content quality" },
];


function parseStoredIssues(value: string | null): SeoIssue[] {
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

function serializeScanJob(job: {
  id: string;
  status: string;
  phase: string;
  progress: number;
  totalPosts: number;
  processedPosts: number;
  analyzedPosts: number;
  averageScore: number | null;
  error: string | null;
  requestedAt: Date;
  completedAt: Date | null;
} | null) {
  return job ? {
    id: job.id,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    totalPosts: job.totalPosts,
    processedPosts: job.processedPosts,
    analyzedPosts: job.analyzedPosts,
    averageScore: job.averageScore || 0,
    error: getPublicSeoScanError(job.error),
    requestedAt: job.requestedAt.toISOString(),
    completedAt: job.completedAt?.toISOString() || null,
  } : null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const startedAt = Date.now();
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const { planKey, limits } = await getActivePlanAndLimits(billing, shop);
  const [seoRows, searchConnection, scanJob, shopConfig] = await Promise.all([
    prisma.articleSEO.findMany({
      where: { shop },
      orderBy: { sourceUpdatedAt: "desc" },
      ...(Number.isFinite(limits.seoBlogPosts) ? { take: limits.seoBlogPosts } : {}),
      select: {
        articleId: true,
        articleTitle: true,
        seoScore: true,
        baseSeoScore: true,
        auditVersion: true,
        metaTitle: true,
        metaDescription: true,
        focusKeyword: true,
        issues: true,
        lastAnalyzedAt: true,
        articleHandle: true,
        blogTitle: true,
        blogHandle: true,
        imageUrl: true,
        imageAlt: true,
      },
    }),
    limits.canSearchConsole ? prisma.searchConsoleConnection.findUnique({ where: { shop }, select: { selectedSiteUrl: true, lastSyncedAt: true } }).catch((error) => {
      console.error("Search Console connection table unavailable:", error);
      return null;
    }) : Promise.resolve(null),
    prisma.seoScanJob.findFirst({ where: { shop }, orderBy: { requestedAt: "desc" } }),
    limits.canAutoSeoScan
      ? prisma.shopConfig.findUnique({ where: { shop }, select: { seoAutoScanEnabled: true } })
      : Promise.resolve(null),
  ]);
  const auditedPosts: AuditedPost[] = seoRows.map((row) => ({
    id: row.articleId, title: row.articleTitle || "Untitled post", handle: row.articleHandle, body: "", summary: "", publishedAt: null,
    imageUrl: row.imageUrl, imageAlt: row.imageAlt, imageWidth: 0, imageHeight: 0, updatedAt: "", seoTitle: row.metaTitle || "", seoDescription: row.metaDescription || "",
    blogId: "", blogTitle: row.blogTitle || "Blog", blogHandle: row.blogHandle, authorName: "", seoHidden: false, productCount: 0,
    score: row.seoScore, baseScore: row.auditVersion >= SEO_AUDIT_VERSION ? row.baseSeoScore : row.seoScore, issues: parseStoredIssues(row.issues), effectiveSeoTitle: row.metaTitle || row.articleTitle,
    effectiveSeoDescription: row.metaDescription || "", focusKeyword: row.focusKeyword || "",
    lastAnalyzedAt: row.lastAnalyzedAt?.toISOString() || null,
  }));
  auditedPosts.sort((a, b) => a.score - b.score || b.issues.length - a.issues.length || a.title.localeCompare(b.title));

  const searchRows = searchConnection?.selectedSiteUrl
    ? await prisma.searchConsoleMetric.groupBy({
        by: ["pageUrl"],
        where: { shop, siteUrl: searchConnection.selectedSiteUrl, windowDays: 28, period: "current" },
        _sum: { impressions: true },
      }).catch((error) => {
        console.error("Search Console impressions unavailable for SEO priority:", error);
        return [];
      })
    : [];
  const impressionsByPath = buildImpressionsByPath(searchRows.map((row) => ({ pageUrl: row.pageUrl, impressions: row._sum.impressions || 0 })));
  const issueGroups = buildIssueGroups(auditedPosts, impressionsByPath);
  const issueStats = getIssueStats(issueGroups);
  const averageScore = getAverageScore(auditedPosts);
  const averageOnPageScore = getAverageScore(auditedPosts.map((post) => ({ score: post.baseScore })));
  const lastScanAt = seoRows.reduce<Date | null>((latest, row) => {
    if (!row.lastAnalyzedAt) return latest;
    if (!latest || row.lastAnalyzedAt > latest) return row.lastAnalyzedAt;
    return latest;
  }, null);
  console.info("SEO loader snapshot timing", { shop, rows: seoRows.length, durationMs: Date.now() - startedAt });

  return json({
    shopifyError: "",
    planKey,
    seoBlogPostLimit: limits.seoBlogPosts,
    canSearchConsole: limits.canSearchConsole,
    canAutoSeoScan: limits.canAutoSeoScan,
    averageScore,
    averageOnPageScore,
    issueGroups,
    issueStats,
    affectedPosts: auditedPosts.filter((post) => post.issues.length > 0).length,
    quickWins: issueGroups.filter((issue) => issue.effort === "Low").reduce((sum, issue) => sum + issue.affected, 0),
    scannedPosts: seoRows.filter((row) => row.lastAnalyzedAt).length,
    totalPosts: auditedPosts.length,
    lastScanAt: lastScanAt ? lastScanAt.toISOString() : null,
    autoScanEnabled: shopConfig?.seoAutoScanEnabled || false,
    scanJob: serializeScanJob(scanJob),
    postsNeedingAttention: auditedPosts.filter((post) => post.issues.length > 0).slice(0, 6).map((post) => ({ id: post.id, title: post.title, imageUrl: post.imageUrl, imageAlt: post.imageAlt, score: post.score, baseScore: post.baseScore })),
    searchConsole: {
      connected: Boolean(searchConnection?.selectedSiteUrl),
      lastSyncedAt: searchConnection?.lastSyncedAt?.toISOString() || null,
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.headers.get("content-type")?.includes("application/json")) {
    const suppliedToken = request.headers.get("x-seo-worker-token") || "";
    const expectedToken = process.env.SEO_WORKER_SECRET || process.env.SHOPIFY_API_SECRET || "";
    if (!expectedToken || !safeTokenEqual(suppliedToken, expectedToken)) return json({ error: "Unauthorized worker request" }, { status: 401 });
    const payload = await request.json() as { jobId?: string; shop?: string };
    const job = payload.jobId && payload.shop
      ? await prisma.seoScanJob.findFirst({ where: { id: payload.jobId, shop: payload.shop, status: "running" } })
      : null;
    if (!job) return json({ error: "Active SEO scan job not found" }, { status: 404 });
    const [{ admin }, planName] = await Promise.all([
      unauthenticated.admin(job.shop),
      getUnauthenticatedActivePlanName(job.shop),
    ]);
    const limits = getLimitsForPlan(planName);
    if (job.trigger === "schedule" && !limits.canAutoSeoScan) {
      // The merchant's choice is kept; scheduled scans resume if they upgrade again.
      return json({ scannedCount: 0, analyzedCount: 0, averageScore: 0, skipped: true });
    }
    const result = await runSeoScan({
      admin, shop: job.shop, limits,
      onProgress: async (update) => {
        const updated = await prisma.seoScanJob.updateMany({ where: { id: job.id, status: "running" }, data: { ...update, heartbeatAt: new Date() } });
        if (!updated.count) throw new Error("SEO_SCAN_CANCELLED");
      },
    });
    return json(result);
  }
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");
  const getPlanAccess = () => getActivePlanAndLimits(billing, shop);

  if (intent === "scan_status") {
    const latestJob = await prisma.seoScanJob.findFirst({ where: { shop }, orderBy: { requestedAt: "desc" } });
    return json({ job: serializeScanJob(latestJob) });
  }

  if (intent === "set_auto_scan") {
    const { limits } = await getPlanAccess();
    if (!limits.canAutoSeoScan) return json({ error: "Scheduled SEO scans are available on Pro and Growth plans." }, { status: 403 });
    const enabled = formData.get("enabled") === "true";
    await prisma.shopConfig.upsert({ where: { shop }, update: { seoAutoScanEnabled: enabled }, create: { shop, seoAutoScanEnabled: enabled } });
    return json({ success: true, autoScanEnabled: enabled });
  }
  if (intent === "cancel_scan") {
    const cancelled = await prisma.seoScanJob.updateMany({
      where: { shop, status: { in: ["queued", "running"] } },
      data: { status: "cancelled", phase: "Scan cancelled", completedAt: new Date(), heartbeatAt: new Date() },
    });
    return json({ success: true, cancelled: cancelled.count > 0 });
  }

  if (intent !== "scan_all") {
    return json({ error: "Unsupported action" }, { status: 400 });
  }

  const job = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${shop}))`;
    const active = await tx.seoScanJob.findFirst({
      where: { shop, status: { in: ["queued", "running"] } },
      orderBy: { requestedAt: "desc" },
    });
    if (active) return active;
    return tx.seoScanJob.create({ data: { shop, status: "queued", trigger: "manual", phase: "Waiting for worker" } });
  });

  return json({ success: true, queued: true, jobId: job.id, status: job.status }, { status: 202 });
};

async function runSeoScan({
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

function toLiveSeoIssue(issue: LivePageIssue): SeoIssue {
  return { type: issue.type, category: issue.category, label: issue.label, message: issue.message, severity: issue.severity, impact: issue.impact, effort: issue.effort, fix: issue.fix, points: issue.points };
}

function saveCatalogAudit(shop: string, audit: CatalogSeoAudit, liveChecked = false) {
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

export default function SEOOptimizer() {
  const {
    shopifyError,
    planKey,
    seoBlogPostLimit,
    canSearchConsole,
    canAutoSeoScan,
    averageScore,
    averageOnPageScore,
    issueGroups,
    affectedPosts,
    quickWins,
    scannedPosts,
    totalPosts,
    lastScanAt,
    autoScanEnabled,
    scanJob,
    postsNeedingAttention,
    searchConsole,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const scanFetcher = useFetcher<typeof action>();
  const statusFetcher = useFetcher();
  const handledActionData = useRef<unknown>(null);
  const handledCompletedJobId = useRef<string | null>(null);
  const handledFailedJobId = useRef<string | null>(null);
  const handledNotice = useRef("");
  const [selectedTab, setSelectedTab] = useState(0);
  const [activeIssue, setActiveIssue] = useState<IssueGroup | null>(null);
  const selectedCategory = CATEGORY_TABS[selectedTab]?.id || "all";
  const visibleIssues = useMemo(
    () => issueGroups.filter((issue) => selectedCategory === "all" || issue.category === selectedCategory),
    [issueGroups, selectedCategory],
  );
  const statusData = statusFetcher.data as { job?: typeof scanJob } | undefined;
  const scanActionData = scanFetcher.data as { queued?: boolean; jobId?: string } | undefined;
  const currentJob = statusData?.job === undefined ? scanJob : statusData.job;
  const scanIntentSubmitting = scanFetcher.state !== "idle" && scanFetcher.formData?.get("intent") === "scan_all";
  const queuedJobStillActive = Boolean(
    scanActionData?.queued
      && (!statusData?.job || statusData.job.id !== scanActionData.jobId || ["queued", "running"].includes(statusData.job.status)),
  );
  const isScanning = scanIntentSubmitting || queuedJobStillActive || currentJob?.status === "queued" || currentJob?.status === "running";

  useEffect(() => {
    const data = scanFetcher.data as { success?: boolean; queued?: boolean; cancelled?: boolean; error?: string; googleAction?: string; authorizationUrl?: string; syncedCount?: number; autoScanEnabled?: boolean } | undefined;
    if (!data || handledActionData.current === data) return;
    handledActionData.current = data;
    if (data.success) {
      if (data.cancelled) {
        shopify.toast.show("SEO scan cancelled");
      } else if (typeof data.autoScanEnabled === "boolean") {
        shopify.toast.show(data.autoScanEnabled ? "Weekly SEO scans enabled" : "Weekly SEO scans disabled");
        revalidator.revalidate();
      } else {
        shopify.toast.show("SEO scan queued. You can leave this page while it runs.");
      }
    } else if (data.error) {
      shopify.toast.show(data.error, { isError: true });
    }
  }, [scanFetcher.data, revalidator, shopify]);

  useEffect(() => {
    if (!isScanning) return;
    const loadStatus = () => statusFetcher.submit({ intent: "scan_status" }, { method: "post", action: "/app/seo" });
    loadStatus();
    const timer = window.setInterval(loadStatus, 2000);
    return () => window.clearInterval(timer);
  }, [isScanning, statusFetcher]);

  const completedJobId = statusData?.job?.status === "completed" ? statusData.job.id : null;
  const failedJobId = statusData?.job?.status === "failed" ? statusData.job.id : null;
  useEffect(() => {
    if (!completedJobId || handledCompletedJobId.current === completedJobId) return;
    handledCompletedJobId.current = completedJobId;
    shopify.toast.show(`SEO scan complete: ${currentJob?.totalPosts || 0} resources, average ${currentJob?.averageScore || 0}/100`);
    revalidator.revalidate();
  }, [completedJobId, currentJob?.averageScore, currentJob?.totalPosts, revalidator, shopify]);
  useEffect(() => {
    if (!failedJobId || handledFailedJobId.current === failedJobId) return;
    handledFailedJobId.current = failedJobId;
    shopify.toast.show(currentJob?.error || "SEO scan failed", { isError: true });
  }, [failedJobId, currentJob?.error, shopify]);
  useEffect(() => {
    const notice = searchParams.get("notice") || "";
    if (!notice || handledNotice.current === notice) return;
    handledNotice.current = notice;
    if (notice === "article-not-found") {
      shopify.toast.show("This article no longer exists in Shopify. Run an SEO scan to refresh the report.", { isError: true });
    }
  }, [searchParams, shopify]);

  const goToPost = (postId: string) => navigate(getPostTarget(postId));
  const handleIssueAction = (issue: IssueGroup) => {
    const bulkRoute = getBulkFixRoute(issue);
    if (bulkRoute) {
      navigate(bulkRoute);
      return;
    }

    if (issue.category === "schema") {
      // Structured data comes from the theme and the SEO Schema app block.
      navigate("/app/theme-setup");
      return;
    }

    if (issue.affectedPosts.length > 1) {
      setActiveIssue(issue);
      return;
    }

    if (issue.targetPostId) {
      goToPost(issue.targetPostId);
      return;
    }

    navigate("/app/blogs");
  };

  return (
    <AppPage
      title="SEO Analyzer"
      subtitle="One scan checks blog posts, products, collections and store pages. Fix the highest-impact issues first."
      titleMetadata={<Badge tone="info">{lastScanAt ? `Last scan ${formatDate(lastScanAt)}` : "Not scanned yet"}</Badge>}
      fullWidth
      tabs={{ items: SEO_WORKSPACE_TABS, activeId: "issues" }}
      primaryAction={isScanning
        ? { content: "Cancel scan", destructive: true, onAction: () => scanFetcher.submit({ intent: "cancel_scan" }, { method: "post" }) }
        : { content: "Run SEO scan", onAction: () => scanFetcher.submit({ intent: "scan_all" }, { method: "post" }) }}
      secondaryActions={canAutoSeoScan
        ? [{ content: autoScanEnabled ? "Turn off weekly scan" : "Turn on weekly scan", onAction: () => scanFetcher.submit({ intent: "set_auto_scan", enabled: String(!autoScanEnabled) }, { method: "post" }) }]
        : [{ content: "Unlock weekly scans", url: "/app/pricing?reason=auto_seo_scan" }]}
    >
      <BlockStack gap="500">

        <IssueScopeSwitcher active="articles" />

        {Number.isFinite(seoBlogPostLimit) && (
          <Banner tone="info" title={`${planKey === "free" ? "Free" : planKey === "plus" ? "Plus" : "Pro"} plan scans the ${seoBlogPostLimit} most recently updated blog posts`}>
            <p>Upgrade to increase the scan scope. Existing SEO records outside this limit are preserved.</p>
          </Banner>
        )}

        {shopifyError && (
          <Card padding="400">
            <Text as="p" variant="bodyMd" tone="caution">
              {shopifyError} Existing saved SEO rows are still shown when available.
            </Text>
          </Card>
        )}

        {currentJob && (currentJob.status === "queued" || currentJob.status === "running" || currentJob.status === "failed") && (
          <Banner tone={currentJob.status === "failed" ? "critical" : "info"} title={currentJob.status === "failed" ? "SEO scan failed" : currentJob.phase}>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                {currentJob.status === "failed"
                  ? currentJob.error || "The worker could not complete this scan. You can run it again."
                  : currentJob.totalPosts > 0
                    ? currentJob.phase.startsWith("Saving")
                      ? `${currentJob.processedPosts} of ${currentJob.totalPosts} resources saved. ${currentJob.analyzedPosts} changed resources analyzed.`
                      : currentJob.phase.startsWith("Loading")
                        ? `${currentJob.totalPosts} resources loaded from Shopify so far.`
                        : `${currentJob.processedPosts} of ${currentJob.totalPosts} resources analyzed.`
                    : "The scan is waiting for the background worker."}
              </Text>
              {currentJob.status !== "failed" && <ProgressBar progress={currentJob.progress} size="small" />}
            </BlockStack>
          </Banner>
        )}

        <AnalyzerSummary
          score={averageScore}
          onPageScore={averageOnPageScore}
          failed={issueGroups.filter((issue) => issue.impact === "High").length}
          warnings={issueGroups.filter((issue) => issue.impact !== "High").length}
          passedPosts={Math.max(0, scannedPosts - affectedPosts)}
          scannedPosts={scannedPosts}
          totalPosts={totalPosts}
          quickWins={quickWins}
        />

        <InlineGrid columns={{ xs: 1, lg: "2fr 1fr" }} gap="400">
          <Card padding="0">
            <Box padding="400">
              <Chips
                label="Check category"
                active={selectedCategory}
                items={CATEGORY_TABS.map((tab, index) => ({
                  id: tab.id,
                  label: tab.content,
                  count: tab.id === "all" ? issueGroups.length : issueGroups.filter((issue) => issue.category === tab.id).length || undefined,
                  onClick: () => setSelectedTab(index),
                }))}
              />
            </Box>
            {visibleIssues.length ? (
              <>
                {(selectedCategory === "all" ? CATEGORY_TABS.filter((tab) => tab.id !== "all") : CATEGORY_TABS.filter((tab) => tab.id === selectedCategory)).map((tab) => {
                  const group = visibleIssues.filter((issue) => issue.category === tab.id);
                  if (!group.length) return null;
                  const failed = group.filter((issue) => issue.impact === "High").length;
                  return (
                    <div key={tab.id}>
                      <GroupLabel>{`${tab.content} · ${failed ? `${failed} failed, ` : ""}${group.length - failed} warning${group.length - failed === 1 ? "" : "s"}`}</GroupLabel>
                      <ActionRows>
                        {group.map((issue) => (
                          <ActionRow
                            key={issue.id}
                            icon={issue.impact === "High" ? XCircleIcon : AlertTriangleIcon}
                            iconTone={issue.impact === "High" ? "bad" : "warn"}
                            title={issue.issue}
                            text={issue.fix}
                            meta={`${issue.affected} post${issue.affected === 1 ? "" : "s"} · ${issue.examples.slice(0, 2).join(", ")}${issue.impressions ? ` · ${formatImpressions(issue.impressions)} impressions` : ""}`}
                            aside={
                              <>
                                <Pill tone={impactTone(issue.impact)}>{issue.impact}</Pill>
                                {getBulkFixRoute(issue)
                                  ? <AiButton onClick={() => handleIssueAction(issue)}>Fix in bulk</AiButton>
                                  : <Button size="slim" onClick={() => handleIssueAction(issue)}>{issue.actionLabel}</Button>}
                              </>
                            }
                          />
                        ))}
                      </ActionRows>
                    </div>
                  );
                })}
              </>
            ) : (
              <Box padding="600">
                <EmptyState heading={scannedPosts ? "No issues in this category" : "Run your first scan"} image={PLACEHOLDER_IMAGE}>
                  <p>{scannedPosts ? "Choose another category, or run a fresh scan after editing posts." : "One scan checks every post and lists what to fix first."}</p>
                </EmptyState>
              </Box>
            )}
            {affectedPosts < scannedPosts && (
              <GroupLabel tone="good">{`Passing · ${scannedPosts - affectedPosts} post${scannedPosts - affectedPosts === 1 ? "" : "s"} with no issues`}</GroupLabel>
            )}
          </Card>

          <BlockStack gap="400">
            {quickWins > 0 && (
              <div className="rm-callout rm-callout--brand">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingSm"><span style={{ color: "var(--rm-brand-strong)" }}>{`Fix ${quickWins} quick win${quickWins === 1 ? "" : "s"}`}</span></Text>
                  <Text as="p" variant="bodySm">AI drafts meta tags, alt text and links for the affected posts. You review every change before it is saved, and can undo it.</Text>
                  <InlineStack><AiButton onClick={() => navigate("/app/optimize")}>Review AI fixes</AiButton></InlineStack>
                </BlockStack>
              </div>
            )}

            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center"><IconTile icon={SearchIcon} tone="brand" size="sm" /><Text as="h2" variant="headingMd">Keywords</Text></InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {!canSearchConsole
                    ? "Search queries, clicks and keyword opportunities are available on Pro and Growth."
                    : searchConsole.connected
                      ? `Google Search Console is connected${searchConsole.lastSyncedAt ? ` · synced ${formatDate(searchConsole.lastSyncedAt)}` : ""}.`
                      : "Connect Google Search Console to see which searches each post ranks for."}
                </Text>
                <InlineStack>
                  {!canSearchConsole
                    ? <Button url="/app/pricing?reason=search_console">Upgrade to Pro</Button>
                    : searchConsole.connected
                      ? <Button onClick={() => navigate("/app/content-decay")}>View keyword opportunities</Button>
                      : <Button onClick={() => navigate("/app/settings?tab=integrations")}>Connect Google</Button>}
                </InlineStack>
              </BlockStack>
            </Card>

            <Card padding="0">
              <Box padding="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Posts needing attention</Text>
                  <Button variant="plain" onClick={() => navigate("/app/blogs?status=needs_seo")}>View all</Button>
                </InlineStack>
              </Box>
              {postsNeedingAttention.length ? (
                <ActionRows>
                  {postsNeedingAttention.map((post) => (
                    <div className="rm-row" key={post.id}>
                      <DotScore score={post.score} />
                      <div className="rm-row__body">
                        <div className="rm-row__title">{post.title}</div>
                        <div className="rm-row__text">{`On-page ${post.baseScore} · overall ${post.score}`}</div>
                      </div>
                      <Button size="slim" onClick={() => goToPost(post.id)}>Open</Button>
                    </div>
                  ))}
                </ActionRows>
              ) : (
                <Box padding="400" paddingBlockStart="0"><Text as="p" tone="subdued">All scanned posts are in good shape.</Text></Box>
              )}
            </Card>
          </BlockStack>
        </InlineGrid>
      </BlockStack>
      <Modal
        open={Boolean(activeIssue)}
        onClose={() => setActiveIssue(null)}
        title={activeIssue ? `${activeIssue.issue} (${activeIssue.affected} posts)` : "Affected posts"}
        secondaryActions={[
          {
            content: "Close",
            onAction: () => setActiveIssue(null),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            {(activeIssue?.affectedPosts || []).map((post) => (
              <div key={post.id} className="bp-seo-affected-post-row">
                <BlockStack gap="050">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {post.title}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {post.blogTitle}
                  </Text>
                </BlockStack>
                <Button
                  size="micro"
                  onClick={() => {
                    setActiveIssue(null);
                    goToPost(post.id);
                  }}
                >
                  {activeIssue?.actionLabel || "Review"}
                </Button>
              </div>
            ))}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </AppPage>
  );
}

/** Rank Math style summary: score ring, a one-line verdict and four tinted counts. */
function AnalyzerSummary({ score, onPageScore, failed, warnings, passedPosts, scannedPosts, totalPosts, quickWins }: {
  score: number; onPageScore: number; failed: number; warnings: number; passedPosts: number; scannedPosts: number; totalPosts: number; quickWins: number;
}) {
  const verdict = !scannedPosts
    ? "Run a scan to see how your posts score"
    : failed + warnings === 0
      ? "Your posts pass every check"
      : `Your SEO is ${score >= 80 ? "great" : score >= 50 ? "good" : "weak"}, with ${failed + warnings} thing${failed + warnings === 1 ? "" : "s"} to improve`;
  return (
    <Card>
      <InlineStack gap="600" blockAlign="center" wrap>
        <ScoreRing score={scannedPosts ? score : null} size={150} caption="/ 100" label={scannedPosts ? `Overall SEO score ${score} out of 100` : "Not scanned yet"} />
        <div style={{ flex: "1 1 360px", minWidth: 0 }}>
          <BlockStack gap="300">
            <BlockStack gap="100">
              <Text as="h2" variant="headingLg">{verdict}</Text>
              <Text as="p" tone="subdued">
                {scannedPosts
                  ? `On-page average ${onPageScore}/100 across ${scannedPosts} of ${totalPosts} posts. Fix the failed checks first, then the quick wins.`
                  : "One scan checks every post and lists the fixes that matter most."}
              </Text>
            </BlockStack>
            <StatTiles>
              <StatTile tone="bad" label="Failed" value={failed} hint="High-impact checks" />
              <StatTile tone="warn" label="Warnings" value={warnings} hint="Worth improving" />
              <StatTile tone="good" label="Posts passing" value={passedPosts} hint={`of ${scannedPosts} scanned`} />
              <StatTile tone="brand" label="Quick wins" value={quickWins} hint="Low-effort fixes" />
            </StatTiles>
          </BlockStack>
        </div>
      </InlineStack>
    </Card>
  );
}

async function fetchShopifyArticles(admin: any, limit: number, onPage?: (loadedPosts: number) => Promise<void>): Promise<ArticleInput[]> {
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

function auditArticle(
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

function buildIssueGroups(posts: AuditedPost[], impressionsByPath: Map<string, number> = new Map()): IssueGroup[] {
  const map = new Map<string, IssueGroup>();

  posts.forEach((post) => {
    post.issues.forEach((issue) => {
      const group = map.get(issue.type) || {
        id: issue.type,
        category: issue.category,
        issue: issue.label,
        affected: 0,
        impact: issue.impact,
        effort: issue.effort,
        impressions: 0,
        fix: issue.fix,
        actionLabel: getActionLabel(issue.category),
        examples: [],
        targetPostId: post.id,
        affectedPosts: [],
      };

      group.affected += 1;
      group.impressions += impressionsByPath.get(articleSearchPath(post.blogHandle, post.handle)) || 0;
      if (group.examples.length < 3) group.examples.push(post.title);
      group.affectedPosts.push({ id: post.id, title: post.title, blogTitle: post.blogTitle });
      map.set(issue.type, group);
    });
  });

  // Severity first, scaled by how much search traffic the affected posts already get.
  return Array.from(map.values()).sort(
    (a, b) => issuePriority(b.impact, b.impressions) - issuePriority(a.impact, a.impressions) || b.affected - a.affected || a.issue.localeCompare(b.issue),
  );
}

function applyPortfolioIssues(posts: AuditedPost[], includeOrphans: boolean) {
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

function getIssueStats(issueGroups: IssueGroup[]) {
  return issueGroups.reduce(
    (stats, issue) => {
      stats[issue.impact] += issue.affected;
      stats.total += issue.affected;
      return stats;
    },
    { High: 0, Medium: 0, Low: 0, total: 0 },
  );
}

function getAverageScore(posts: Array<{ score: number }>) {
  if (!posts.length) return 0;
  return Math.round(posts.reduce((sum, post) => sum + post.score, 0) / posts.length);
}

/** Issue types that a Bulk Optimize tool can fix across many posts at once. */
const BULK_FIX_ROUTES: Record<string, string> = {
  featured_image_alt: "/app/image-seo",
  inline_images_missing_alt: "/app/image-seo",
  image_alt_stuffing: "/app/image-seo",
  decorative_image_alt: "/app/image-seo",
  internal_links: "/app/internal-links",
  orphan_article: "/app/internal-links",
};

function getBulkFixRoute(issue: Pick<IssueGroup, "id" | "affectedPosts">) {
  return issue.affectedPosts.length > 1 ? BULK_FIX_ROUTES[issue.id] || "" : "";
}

function getActionLabel(category: SeoCategory) {
  if (category === "product_linking") return "Add products";
  if (category === "image") return "Add alt text";
  if (category === "schema") return "Theme setup";
  if (category === "content") return "Edit content";
  return "Review";
}

function getPostTarget(postId: string) {
  return `/app/blogs/${encodeURIComponent(postId)}`;
}






function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isLikelyStaleAutoMetaTitle(metaTitle: string, articleTitle: string) {
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

function getEffectiveSeoTitle(article: ArticleInput) {
  const title = textValue(article.title);
  const shopifySeoTitle = textValue(article.seoTitle);
  if (shopifySeoTitle && !isLikelyStaleAutoMetaTitle(shopifySeoTitle, title)) return shopifySeoTitle;
  return title;
}

function getEffectiveSeoDescription(article: ArticleInput) {
  // Shopify themes fall back to the excerpt when no SEO description is saved.
  return textValue(article.seoDescription) || textValue(article.summary).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getSeoContentHash(article: ArticleInput, productCount: number, config: SeoAuditConfig) {
  return crypto.createHash("sha256").update(JSON.stringify({
    title: article.title, handle: article.handle, body: article.body, summary: article.summary, publishedAt: article.publishedAt,
    imageUrl: article.imageUrl, imageAlt: article.imageAlt, imageWidth: article.imageWidth, imageHeight: article.imageHeight, seoTitle: article.seoTitle,
    seoDescription: article.seoDescription, authorName: article.authorName, productCount,
    config: { addBlogSchema: config.addBlogSchema, addProductSchema: config.addProductSchema, canContentNavigation: config.canContentNavigation, tocEnabled: config.tocEnabled, tocAutoInsertEnabled: config.tocAutoInsertEnabled },
  })).digest("hex");
}

function datesEqual(left: Date | null | undefined, right: Date | null) {
  return (left?.getTime() || 0) === (right?.getTime() || 0);
}

export function links() {
  return [
    { rel: "stylesheet", href: catalogSeoStyles },
    {
      rel: "stylesheet",
      href:
        "data:text/css," +
        encodeURIComponent(`
          .bp-seo-issue-table {
            max-width: 100%;
            overflow-x: auto;
            overflow-y: hidden;
          }
          .bp-seo-issue-table table {
            min-width: 940px;
          }
          .bp-seo-issue-cell {
            display: grid;
            gap: 2px;
            width: 300px;
            max-width: 300px;
            min-width: 0;
          }
          .bp-seo-fix-cell {
            width: 220px;
            max-width: 220px;
            min-width: 0;
          }
          .bp-seo-affected-post-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            padding: 12px 0;
            border-bottom: 1px solid var(--p-color-border-secondary);
          }
          .bp-seo-affected-post-row:last-child {
            border-bottom: 0;
          }
          .bp-seo-attention-row {
            display: grid;
            grid-template-columns: auto minmax(0, 1fr) auto;
            align-items: center;
            gap: 12px;
            min-width: 0;
          }
          .bp-seo-attention-thumbnail,
          .bp-seo-attention-copy {
            min-width: 0;
          }
          .bp-seo-attention-title {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
        `),
    },
  ];
}
