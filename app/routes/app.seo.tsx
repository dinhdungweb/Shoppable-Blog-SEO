import { useEffect, useMemo, useRef, useState } from "react";
import crypto from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate, useRevalidator } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Banner,
  Divider,
  EmptyState,
  Icon,
  IndexTable,
  InlineGrid,
  InlineStack,
  Layout,
  Modal,
  Page,
  ProgressBar,
  Select,
  Tabs,
  Text,
  Thumbnail,
  useIndexResourceState,
} from "@shopify/polaris";
import {
  AlertTriangleIcon,
  ChartVerticalFilledIcon,
  ImageIcon,
  MagicIcon,
  NoteIcon,
  ShieldCheckMarkIcon,
} from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate, getUnauthenticatedActivePlanName, unauthenticated } from "../shopify.server";
import { getLimitsForPlan } from "../pricing-plans";
import prisma from "../db.server";
import { auditSeo as runSeoAudit, slugifySeoText } from "../seo-audit";
import { fetchShopDomains } from "../shopify-domains.server";
import { normalizeContentNavConfig } from "../content-navigation";
import { auditSeoPortfolio } from "../seo-portfolio-audit";
import { buildSearchOpportunities } from "../search-console-opportunities";
import { getPublicSeoScanError } from "../seo-scan-error";
import { createAuthorizationUrl, disconnectSearchConsole, isSearchConsoleConfigured, selectSearchConsoleSite, syncSearchConsole } from "../search-console.server";

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
  updatedAt: string;
  publishedAt: string | null;
  seoTitle: string;
  seoDescription: string;
  blogId: string;
  blogTitle: string;
  blogHandle: string;
  authorName: string;
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
};

type AuditedPost = ArticleInput & {
  productCount: number;
  score: number;
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
  status: string;
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
const DONUT_COLORS = {
  High: "#D82C0D",
  Medium: "#FFC453",
  Low: "#29845A",
};
const SEO_AUDIT_VERSION = 2;
const PORTFOLIO_ISSUE_TYPES = new Set(["duplicate_seo_title", "duplicate_meta_description", "keyword_cannibalization", "orphan_article", "near_duplicate_content"]);

function safeTokenEqual(supplied: string, expected: string) {
  const suppliedHash = crypto.createHash("sha256").update(supplied).digest();
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(suppliedHash, expectedHash);
}

const CATEGORY_TABS: Array<{ id: SeoCategory | "all"; content: string }> = [
  { id: "all", content: "All issues" },
  { id: "on_page", content: "On-page SEO" },
  { id: "product_linking", content: "Product linking" },
  { id: "image", content: "Image SEO" },
  { id: "schema", content: "Schema" },
  { id: "content", content: "Content quality" },
];

async function loadSearchConsoleMetrics(shop: string, connected: boolean) {
  const empty = { metrics: [], summary: { clicks: 0, impressions: 0, ctr: 0, position: 0 } };
  if (!connected) return empty;
  try {
    const where = { shop, windowDays: 28, period: "current" };
    const [current, previous, aggregate] = await Promise.all([
      prisma.searchConsoleMetric.findMany({ where, orderBy: { impressions: "desc" }, take: 500,
        select: { pageUrl: true, query: true, clicks: true, impressions: true, ctr: true, position: true, period: true } }),
      prisma.searchConsoleMetric.findMany({ where: { shop, windowDays: 28, period: "previous" }, orderBy: { clicks: "desc" }, take: 500,
        select: { pageUrl: true, query: true, clicks: true, impressions: true, ctr: true, position: true, period: true } }),
      prisma.searchConsoleMetric.aggregate({ where, _sum: { clicks: true, impressions: true }, _avg: { position: true } }),
    ]);
    const clicks = aggregate._sum.clicks || 0;
    const impressions = aggregate._sum.impressions || 0;
    return { metrics: [...current, ...previous], summary: { clicks: Math.round(clicks), impressions: Math.round(impressions), ctr: impressions ? clicks / impressions : 0, position: aggregate._avg.position || 0 } };
  } catch (error) {
    console.error("Search Console snapshot query failed:", error);
    return empty;
  }
}

function parseStoredIssues(value: string | null): SeoIssue[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((issue): issue is SeoIssue => Boolean(issue && typeof issue.type === "string" && typeof issue.label === "string")) : [];
  } catch {
    return [];
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const startedAt = Date.now();
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [seoRows, searchConnection, scanJob, shopConfig] = await Promise.all([
    prisma.articleSEO.findMany({
      where: { shop },
      select: {
        articleId: true,
        articleTitle: true,
        seoScore: true,
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
    prisma.searchConsoleConnection.findUnique({ where: { shop } }).catch((error) => {
      console.error("Search Console connection table unavailable:", error);
      return null;
    }),
    prisma.seoScanJob.findFirst({ where: { shop }, orderBy: { requestedAt: "desc" } }),
    prisma.shopConfig.findUnique({ where: { shop }, select: { seoAutoScanEnabled: true } }),
  ]);
  const searchData = await loadSearchConsoleMetrics(shop, Boolean(searchConnection));
  const searchMetrics = searchData.metrics;
  const auditedPosts: AuditedPost[] = seoRows.map((row) => ({
    id: row.articleId, title: row.articleTitle || "Untitled post", handle: row.articleHandle, body: "", summary: "", publishedAt: null,
    imageUrl: row.imageUrl, imageAlt: row.imageAlt, updatedAt: "", seoTitle: row.metaTitle || "", seoDescription: row.metaDescription || "",
    blogId: "", blogTitle: row.blogTitle || "Blog", blogHandle: row.blogHandle, authorName: "", productCount: 0,
    score: row.seoScore, issues: parseStoredIssues(row.issues), effectiveSeoTitle: row.metaTitle || row.articleTitle,
    effectiveSeoDescription: row.metaDescription || "", focusKeyword: row.focusKeyword || "",
    lastAnalyzedAt: row.lastAnalyzedAt?.toISOString() || null,
  }));
  auditedPosts.sort((a, b) => a.score - b.score || b.issues.length - a.issues.length || a.title.localeCompare(b.title));

  const issueGroups = buildIssueGroups(auditedPosts);
  const issueStats = getIssueStats(issueGroups);
  const averageScore = getAverageScore(auditedPosts);
  const lastScanAt = seoRows.reduce<Date | null>((latest, row) => {
    if (!row.lastAnalyzedAt) return latest;
    if (!latest || row.lastAnalyzedAt > latest) return row.lastAnalyzedAt;
    return latest;
  }, null);
  const availableSites = (searchConnection?.availableSites as Array<{ siteUrl: string; permissionLevel: string }> | null) || [];
  const searchSummary = searchData.summary;
  const searchOpportunities = buildSearchOpportunities(searchMetrics);
  console.info("SEO loader snapshot timing", { shop, rows: seoRows.length, metrics: searchMetrics.length, durationMs: Date.now() - startedAt });

  return json({
    shopifyError: "",
    averageScore,
    issueGroups,
    issueStats,
    affectedPosts: auditedPosts.filter((post) => post.issues.length > 0).length,
    quickWins: issueGroups.filter((issue) => issue.effort === "Low").reduce((sum, issue) => sum + issue.affected, 0),
    scannedPosts: seoRows.filter((row) => row.lastAnalyzedAt).length,
    totalPosts: auditedPosts.length,
    lastScanAt: lastScanAt ? lastScanAt.toISOString() : null,
    autoScanEnabled: shopConfig?.seoAutoScanEnabled || false,
    scanJob: scanJob ? {
      id: scanJob.id, status: scanJob.status, phase: scanJob.phase, progress: scanJob.progress,
      totalPosts: scanJob.totalPosts, processedPosts: scanJob.processedPosts, analyzedPosts: scanJob.analyzedPosts,
      averageScore: scanJob.averageScore, error: getPublicSeoScanError(scanJob.error),
      requestedAt: scanJob.requestedAt.toISOString(), completedAt: scanJob.completedAt?.toISOString() || null,
    } : null,
    postsNeedingAttention: auditedPosts.filter((post) => post.issues.length > 0).slice(0, 6).map((post) => ({ id: post.id, title: post.title, imageUrl: post.imageUrl, imageAlt: post.imageAlt, score: post.score })),
    searchConsole: {
      configured: isSearchConsoleConfigured(), connected: Boolean(searchConnection), selectedSiteUrl: searchConnection?.selectedSiteUrl || "",
      availableSites, lastSyncedAt: searchConnection?.lastSyncedAt?.toISOString() || null, error: searchConnection?.lastSyncError || "",
      summary: searchSummary, opportunities: searchOpportunities,
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
    const result = await runSeoScan({
      admin, shop: job.shop, limits: getLimitsForPlan(planName),
      onProgress: async (update) => {
        const updated = await prisma.seoScanJob.updateMany({ where: { id: job.id, status: "running" }, data: { ...update, heartbeatAt: new Date() } });
        if (!updated.count) throw new Error("SEO_SCAN_CANCELLED");
      },
    });
    return json(result);
  }
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "google_connect") {
    try {
      return json({ success: true, googleAction: "connect", authorizationUrl: await createAuthorizationUrl(shop) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Could not start Google connection." }, { status: 400 });
    }
  }
  if (intent === "google_select") {
    try { await selectSearchConsoleSite(shop, String(formData.get("siteUrl") || "")); return json({ success: true, googleAction: "selected" }); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "Could not select property." }, { status: 400 }); }
  }
  if (intent === "google_sync") {
    try { const syncedCount = await syncSearchConsole(shop); return json({ success: true, googleAction: "synced", syncedCount }); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "Search Console sync failed." }, { status: 400 }); }
  }
  if (intent === "google_disconnect") {
    await disconnectSearchConsole(shop);
    return json({ success: true, googleAction: "disconnected" });
  }
  if (intent === "set_auto_scan") {
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
  limits: { canContentNavigation: boolean };
  onProgress?: (update: { phase: string; progress: number; totalPosts?: number; processedPosts?: number; analyzedPosts?: number }) => Promise<void>;
}) {
  const report = async (update: { phase: string; progress: number; totalPosts?: number; processedPosts?: number; analyzedPosts?: number }) => {
    if (onProgress) await onProgress(update);
  };

  const scanStartedAt = Date.now();
  await report({ phase: "Loading Shopify articles", progress: 5 });
  const [articles, linkedProducts, config, seoRows, shopDomains] = await Promise.all([
    fetchShopifyArticles(admin, async (loadedPosts) => {
      const progress = Math.min(25, 5 + Math.ceil(loadedPosts / 100) * 3);
      await report({ phase: `Loading Shopify articles (${loadedPosts})`, progress, totalPosts: loadedPosts });
    }),
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
      },
    }),
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
    const audit = unchanged
      ? { score: stored!.baseSeoScore, issues: parseStoredIssues(stored!.issues).filter((issue) => !PORTFOLIO_ISSUE_TYPES.has(issue.type)) }
      : auditArticle(article, productCountMap.get(article.id) || 0, seoAuditConfig, stored, shop, shopDomains);
    if (!unchanged) analyzedCount += 1;
    baseScoreMap.set(article.id, audit.score);
    audits.push({
      ...article,
      productCount: productCountMap.get(article.id) || 0,
      score: audit.score,
      issues: audit.issues,
      lastAnalyzedAt: stored?.lastAnalyzedAt?.toISOString() || null,
      effectiveSeoTitle: getEffectiveSeoTitle(stored?.metaTitle, article),
      effectiveSeoDescription: getEffectiveSeoDescription(stored?.metaDescription, article),
      focusKeyword: textValue(stored?.focusKeyword),
    });
    const processedPosts = index + 1;
    if (processedPosts % 20 === 0 || processedPosts === articles.length) {
      const auditProgress = articles.length ? Math.round(30 + (processedPosts / articles.length) * 25) : 55;
      await report({ phase: "Analyzing article SEO", progress: auditProgress, totalPosts: articles.length, processedPosts, analyzedPosts: analyzedCount });
    }
  }
  await report({ phase: "Analyzing portfolio relationships", progress: 56, totalPosts: articles.length, processedPosts: articles.length, analyzedPosts: analyzedCount });
  applyPortfolioIssues(audits);
  await report({ phase: "Saving results", progress: 60, totalPosts: articles.length, analyzedPosts: analyzedCount });
  const auditDurationMs = Date.now() - scanStartedAt - fetchDurationMs;

  const articleIds = articles.map((a) => a.id);

  // Clean up obsolete records for deleted articles
  await prisma.articleSEO.deleteMany({
    where: { shop, articleId: { notIn: articleIds } },
  });
  await prisma.articleProduct.deleteMany({
    where: { shop, articleId: { notIn: articleIds } },
  });

  const saveAudit = (audit: AuditedPost) => {
      const article = audit;
      const stored = storedSeoMap.get(audit.id);
      const metaTitle = textValue(stored?.metaTitle) || null;
      const metaDescription = textValue(stored?.metaDescription) || null;

      return prisma.articleSEO.upsert({
        where: { shop_articleId: { shop, articleId: article.id } },
        update: {
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

  const durationMs = Date.now() - scanStartedAt;
  console.info("SEO incremental scan timing", { shop, articles: articles.length, analyzedCount, fetchDurationMs, auditDurationMs, durationMs });
  return {
    scannedCount: audits.length,
    analyzedCount,
    averageScore: getAverageScore(audits),
  };
}

export default function SEOOptimizer() {
  const {
    shopifyError,
    averageScore,
    issueGroups,
    issueStats,
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
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const scanFetcher = useFetcher<typeof action>();
  const statusFetcher = useFetcher();
  const handledActionData = useRef<unknown>(null);
  const handledCompletedJobId = useRef<string | null>(null);
  const handledFailedJobId = useRef<string | null>(null);
  const [selectedTab, setSelectedTab] = useState(0);
  const [activeIssue, setActiveIssue] = useState<IssueGroup | null>(null);
  const selectedCategory = CATEGORY_TABS[selectedTab]?.id || "all";
  const visibleIssues = useMemo(
    () => issueGroups.filter((issue) => selectedCategory === "all" || issue.category === selectedCategory),
    [issueGroups, selectedCategory],
  );
  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } = useIndexResourceState(visibleIssues as any);
  const statusData = statusFetcher.data as { job?: typeof scanJob } | undefined;
  const scanActionData = scanFetcher.data as { queued?: boolean; jobId?: string } | undefined;
  const currentJob = statusData?.job === undefined ? scanJob : statusData.job;
  const scanIntentSubmitting = scanFetcher.state !== "idle" && scanFetcher.formData?.get("intent") === "scan_all";
  const queuedJobStillActive = Boolean(
    scanActionData?.queued
      && (!statusData?.job || statusData.job.id !== scanActionData.jobId || ["queued", "running"].includes(statusData.job.status)),
  );
  const isScanning = scanIntentSubmitting || queuedJobStillActive || currentJob?.status === "queued" || currentJob?.status === "running";
  const isGoogleBusy = scanFetcher.state !== "idle" && String(scanFetcher.formData?.get("intent") || "").startsWith("google_");

  useEffect(() => {
    const data = scanFetcher.data as { success?: boolean; queued?: boolean; cancelled?: boolean; error?: string; googleAction?: string; authorizationUrl?: string; syncedCount?: number; autoScanEnabled?: boolean } | undefined;
    if (!data || handledActionData.current === data) return;
    handledActionData.current = data;
    if (data.googleAction === "connect" && data.authorizationUrl) {
      window.open(data.authorizationUrl, "_top");
      return;
    }
    if (data.success) {
      if (data.cancelled) {
        shopify.toast.show("SEO scan cancelled");
      } else if (typeof data.autoScanEnabled === "boolean") {
        shopify.toast.show(data.autoScanEnabled ? "Weekly SEO scans enabled" : "Weekly SEO scans disabled");
        revalidator.revalidate();
      } else {
        shopify.toast.show(data.googleAction ? (data.googleAction === "synced" ? `Search Console synced: ${data.syncedCount || 0} rows` : `Search Console ${data.googleAction}`) : "SEO scan queued. You can leave this page while it runs.");
      }
    } else if (data.error) {
      shopify.toast.show(data.error, { isError: true });
    }
  }, [scanFetcher.data, revalidator, shopify]);

  useEffect(() => {
    if (!isScanning) return;
    statusFetcher.load("/app/seo-scan-status");
    const timer = window.setInterval(() => statusFetcher.load("/app/seo-scan-status"), 2000);
    return () => window.clearInterval(timer);
  }, [isScanning, statusFetcher]);

  const completedJobId = statusData?.job?.status === "completed" ? statusData.job.id : null;
  const failedJobId = statusData?.job?.status === "failed" ? statusData.job.id : null;
  useEffect(() => {
    if (!completedJobId || handledCompletedJobId.current === completedJobId) return;
    handledCompletedJobId.current = completedJobId;
    shopify.toast.show(`SEO scan complete: ${currentJob?.totalPosts || 0} posts, average ${currentJob?.averageScore || 0}/100`);
    revalidator.revalidate();
  }, [completedJobId, currentJob?.averageScore, currentJob?.totalPosts, revalidator, shopify]);
  useEffect(() => {
    if (!failedJobId || handledFailedJobId.current === failedJobId) return;
    handledFailedJobId.current = failedJobId;
    shopify.toast.show(currentJob?.error || "SEO scan failed", { isError: true });
  }, [failedJobId, currentJob?.error, shopify]);

  const selectedIssueCount = allResourcesSelected ? visibleIssues.length : selectedResources.length;
  const selectedIssues = visibleIssues.filter((issue) => allResourcesSelected || selectedResources.includes(issue.id));
  const selectedArticleIds = [...new Set(selectedIssues.flatMap((issue) => issue.affectedPosts.map((post) => post.id.replace(/^gid:\/\/shopify\/Article\//, ""))))];
  const selectedPotential = selectedIssues.reduce((sum, issue) => sum + issue.affected * getImpactWeight(issue.impact), 0);
  const selectedTime = selectedIssues.reduce((sum, issue) => sum + issue.affected * getEffortMinutes(issue.effort), 0);
  const donutData = [
    { name: "High impact", value: issueStats.High, color: DONUT_COLORS.High },
    { name: "Medium impact", value: issueStats.Medium, color: DONUT_COLORS.Medium },
    { name: "Low impact", value: issueStats.Low, color: DONUT_COLORS.Low },
  ];
  const donutTotal = Math.max(1, issueStats.total);
  const highEnd = (issueStats.High / donutTotal) * 100;
  const mediumEnd = highEnd + (issueStats.Medium / donutTotal) * 100;
  const donutBackground = issueStats.total
    ? `conic-gradient(${DONUT_COLORS.High} 0 ${highEnd}%, ${DONUT_COLORS.Medium} ${highEnd}% ${mediumEnd}%, ${DONUT_COLORS.Low} ${mediumEnd}% 100%)`
    : "var(--p-color-bg-surface-secondary)";
  const goToPost = (postId: string) => navigate(getPostTarget(postId));
  const handleIssueAction = (issue: IssueGroup) => {
    if (issue.category === "schema") {
      navigate("/app/settings");
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
    <Page fullWidth>
      <TitleBar title="SEO Optimizer">
        <button
          variant="primary"
          disabled={isScanning}
          onClick={() => scanFetcher.submit({ intent: "scan_all" }, { method: "post" })}
        >
          {isScanning ? "Scanning..." : "Run SEO scan"}
        </button>
      </TitleBar>

      <BlockStack gap="500">
        <InlineStack align="space-between" blockAlign="end">
          <BlockStack gap="100">
            <Text as="h1" variant="headingXl" fontWeight="bold">
              SEO Optimizer
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Identify and resolve SEO issues across Shopify blog posts. Scores are saved to ArticleSEO for Blog Manager and Overview.
            </Text>
          </BlockStack>
          <InlineStack gap="200" blockAlign="center">
            <Badge tone="info">{lastScanAt ? `Last scan ${formatDate(lastScanAt)}` : "Not scanned yet"}</Badge>
            <Button loading={isScanning} onClick={() => scanFetcher.submit({ intent: "scan_all" }, { method: "post" })}>
              Run SEO scan
            </Button>
            {isScanning && <Button tone="critical" onClick={() => scanFetcher.submit({ intent: "cancel_scan" }, { method: "post" })}>Cancel scan</Button>}
            <Button
              pressed={autoScanEnabled}
              onClick={() => scanFetcher.submit({ intent: "set_auto_scan", enabled: String(!autoScanEnabled) }, { method: "post" })}
            >
              {autoScanEnabled ? "Weekly scan on" : "Enable weekly scan"}
            </Button>
            <Button variant="primary" onClick={() => navigate("/app/blogs")}>
              Review posts
            </Button>
          </InlineStack>
        </InlineStack>

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
                      ? `${currentJob.processedPosts} of ${currentJob.totalPosts} posts saved. ${currentJob.analyzedPosts} changed posts analyzed.`
                      : currentJob.phase.startsWith("Loading")
                        ? `${currentJob.totalPosts} posts loaded from Shopify so far.`
                        : `${currentJob.processedPosts} of ${currentJob.totalPosts} posts analyzed.`
                    : "The scan is waiting for the background worker."}
              </Text>
              {currentJob.status !== "failed" && <ProgressBar progress={currentJob.progress} size="small" />}
            </BlockStack>
          </Banner>
        )}

        <InlineGrid columns={{ xs: 1, sm: 2, md: 5 }} gap="400">
          <MetricCard
            title="SEO health score"
            value={String(averageScore)}
            suffix="/100"
            tone={averageScore >= 80 ? "success" : averageScore >= 60 ? "warning" : "critical"}
            icon={ShieldCheckMarkIcon}
            progress={averageScore}
          />
          <MetricCard
            title="High impact issues"
            value={String(issueStats.High)}
            tone={issueStats.High ? "critical" : "success"}
            icon={AlertTriangleIcon}
            progress={Math.min(100, issueStats.High * 12)}
          />
          <MetricCard
            title="Quick wins"
            value={String(quickWins)}
            tone={quickWins ? "warning" : "success"}
            icon={MagicIcon}
            progress={Math.min(100, quickWins * 8)}
          />
          <MetricCard
            title="Affected posts"
            value={String(affectedPosts)}
            suffix={`/${totalPosts}`}
            tone={affectedPosts ? "info" : "success"}
            icon={NoteIcon}
            progress={totalPosts ? (affectedPosts / totalPosts) * 100 : 0}
          />
          <MetricCard
            title="Saved scans"
            value={String(scannedPosts)}
            suffix={`/${totalPosts}`}
            tone={scannedPosts === totalPosts && totalPosts > 0 ? "success" : "info"}
            icon={ChartVerticalFilledIcon}
            progress={totalPosts ? (scannedPosts / totalPosts) * 100 : 0}
          />
        </InlineGrid>

        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              <Card padding="0">
                <Tabs tabs={CATEGORY_TABS} selected={selectedTab} onSelect={setSelectedTab} />
                {visibleIssues.length ? (
                  <div className="bp-seo-issue-table">
                    <IndexTable
                      resourceName={{ singular: "issue", plural: "issues" }}
                      itemCount={visibleIssues.length}
                      selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
                      onSelectionChange={handleSelectionChange}
                      headings={[
                        { title: "Issue" },
                        { title: "Affected" },
                        { title: "Impact" },
                        { title: "Effort" },
                        { title: "Status" },
                        { title: "Suggested fix" },
                        { title: "Action" },
                      ]}
                      selectable
                    >
                      {visibleIssues.map((issue, index) => (
                        <IndexTable.Row id={issue.id} key={issue.id} position={index} selected={selectedResources.includes(issue.id)}>
                          <IndexTable.Cell>
                            <div className="bp-seo-issue-cell">
                              <Text as="span" variant="bodyMd" fontWeight="semibold" truncate>
                                {issue.issue}
                              </Text>
                              <Text as="span" variant="bodySm" tone="subdued" truncate>
                                {issue.examples.slice(0, 2).join(", ")}
                              </Text>
                            </div>
                          </IndexTable.Cell>
                          <IndexTable.Cell>{issue.affected}</IndexTable.Cell>
                          <IndexTable.Cell>
                            <Badge tone={getImpactTone(issue.impact)}>{issue.impact}</Badge>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Badge tone={getEffortTone(issue.effort)}>{issue.effort}</Badge>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Badge tone={issue.status === "Done" ? "success" : issue.status === "Saved scan" ? "info" : undefined}>{issue.status}</Badge>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <div className="bp-seo-fix-cell">
                              <Text as="span" variant="bodyMd" truncate>
                                {issue.fix}
                              </Text>
                            </div>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Button size="micro" onClick={() => handleIssueAction(issue)}>
                              {issue.actionLabel}
                            </Button>
                          </IndexTable.Cell>
                        </IndexTable.Row>
                      ))}
                    </IndexTable>
                  </div>
                ) : (
                  <Box padding="600">
                    <EmptyState heading="No issues in this category" image={PLACEHOLDER_IMAGE}>
                      <p>Choose another category or run a fresh SEO scan.</p>
                    </EmptyState>
                  </Box>
                )}
              </Card>

              <Card padding="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="400" blockAlign="center">
                    <BlockStack gap="0">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="headingSm">
                          {selectedIssueCount} issues selected
                        </Text>
                        <Button variant="plain" onClick={clearSelection}>
                          Clear
                        </Button>
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        High ({issueStats.High}) - Medium ({issueStats.Medium}) - Low ({issueStats.Low})
                      </Text>
                    </BlockStack>
                    <Divider borderColor="border" />
                    <BlockStack gap="0">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        Potential impact
                      </Text>
                      <Text as="span" variant="bodySm" tone="success" fontWeight="bold">
                        {selectedPotential ? `+${selectedPotential} priority points` : "Select issues"}
                      </Text>
                    </BlockStack>
                    <Divider borderColor="border" />
                    <BlockStack gap="0">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        Estimated time
                      </Text>
                      <Text as="span" variant="bodySm" fontWeight="bold">
                        {selectedTime ? formatMinutes(selectedTime) : "-"}
                      </Text>
                    </BlockStack>
                  </InlineStack>

                  <InlineStack gap="200">
                    <Button onClick={() => navigate("/app/blogs")}>Review posts</Button>
                    <Button disabled={!selectedArticleIds.length} onClick={() => navigate(`/app/blogs/bulk_edit?ids=${encodeURIComponent(selectedArticleIds.join(","))}`)}>
                      Bulk fix SEO
                    </Button>
                    <Button variant="primary" loading={isScanning} onClick={() => scanFetcher.submit({ intent: "scan_all" }, { method: "post" })}>
                      Apply scan
                    </Button>
                  </InlineStack>
                </InlineStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <SearchConsoleCard data={searchConsole} busy={isGoogleBusy} submit={(values) => scanFetcher.submit(values, { method: "post" })} />

              <Card padding="400">
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd" fontWeight="bold">
                    Issue breakdown
                  </Text>
                  <InlineStack gap="500" blockAlign="center" wrap={false}>
                    <div style={{ width: "120px", height: "120px", position: "relative" }}>
                      <div aria-hidden="true" style={{ position: "absolute", inset: 0, borderRadius: "50%", background: donutBackground }} />
                      <div aria-hidden="true" style={{ position: "absolute", inset: "15px", borderRadius: "50%", background: "var(--p-color-bg-surface)" }} />
                      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
                        <Text as="p" variant="headingLg" fontWeight="bold">
                          {issueStats.total}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued" alignment="center">
                          Issues
                        </Text>
                      </div>
                    </div>
                    <BlockStack gap="200">
                      {donutData.map((item) => (
                        <InlineStack key={item.name} align="space-between" blockAlign="center" gap="300">
                          <InlineStack gap="100" blockAlign="center">
                            <div style={{ width: "8px", height: "8px", borderRadius: "4px", backgroundColor: item.color }} />
                            <Text as="span" variant="bodySm">
                              {item.name}
                            </Text>
                          </InlineStack>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {item.value}
                          </Text>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  </InlineStack>
                </BlockStack>
              </Card>

              <Card padding="400">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd" fontWeight="bold">
                      Posts needing attention
                    </Text>
                    <Button variant="plain" onClick={() => navigate("/app/blogs")}>
                      View all
                    </Button>
                  </InlineStack>
                  <BlockStack gap="300">
                    {postsNeedingAttention.length ? (
                      postsNeedingAttention.map((post) => (
                        <InlineStack key={post.id} align="space-between" blockAlign="center" wrap={false}>
                          <InlineStack gap="300" blockAlign="center" wrap={false}>
                            <Thumbnail source={post.imageUrl || ImageIcon} alt={post.imageAlt || post.title} size="small" />
                            <BlockStack gap="050">
                              <Text as="span" variant="bodyMd" fontWeight="semibold" truncate>
                                {post.title}
                              </Text>
                              <Text as="span" variant="bodySm" tone="subdued">
                                Score {post.score}/100
                              </Text>
                            </BlockStack>
                          </InlineStack>
                          <Button size="micro" onClick={() => goToPost(post.id)}>
                            Review
                          </Button>
                        </InlineStack>
                      ))
                    ) : (
                      <Text as="p" tone="subdued">
                        All posts are optimized.
                      </Text>
                    )}
                  </BlockStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
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
    </Page>
  );
}

type SearchConsoleData = {
  configured: boolean;
  connected: boolean;
  selectedSiteUrl: string;
  availableSites: Array<{ siteUrl: string; permissionLevel: string }>;
  lastSyncedAt: string | null;
  error: string;
  summary: { clicks: number; impressions: number; ctr: number; position: number };
  opportunities: Array<{ id: string; title: string; detail: string; pageUrl: string; query: string; type: string }>;
};

function SearchConsoleCard({ data, busy, submit }: { data: SearchConsoleData; busy: boolean; submit: (values: Record<string, string>) => void }) {
  const [showAllOpportunities, setShowAllOpportunities] = useState(false);

  if (!data.configured) return (
    <Banner title="Google Search Console is ready to configure" tone="info">
      <p>Add GOOGLE_SEARCH_CONSOLE_CLIENT_ID, GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET and SHOPIFY_APP_URL to enable real search performance data.</p>
    </Banner>
  );
  if (!data.connected) return (
    <Card padding="400">
      <BlockStack gap="300">
        <BlockStack gap="100"><Text as="h2" variant="headingMd">Google Search Console</Text><Text as="p" tone="subdued">Connect search performance data and ranking opportunities.</Text></BlockStack>
        <Button variant="primary" loading={busy} onClick={() => submit({ intent: "google_connect" })}>Connect Google</Button>
      </BlockStack>
    </Card>
  );
  const options = [{ label: "Select a property", value: "" }, ...data.availableSites.map((site) => ({ label: `${site.siteUrl} (${site.permissionLevel})`, value: site.siteUrl }))];
  return (
    <Card padding="400">
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center" wrap={false} gap="200">
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <Icon source={ChartVerticalFilledIcon} tone="info" />
            <BlockStack gap="050"><Text as="h2" variant="headingMd">Google Search Console</Text><Text as="p" variant="bodySm" tone="subdued">{data.lastSyncedAt ? `Synced ${formatDate(data.lastSyncedAt)}` : "Ready to sync"}</Text></BlockStack>
          </InlineStack>
          <InlineStack gap="100" blockAlign="center" wrap={false}><Button size="micro" loading={busy} disabled={!data.selectedSiteUrl} onClick={() => submit({ intent: "google_sync" })}>Sync</Button><Button size="micro" tone="critical" onClick={() => submit({ intent: "google_disconnect" })}>Disconnect</Button></InlineStack>
        </InlineStack>
        {data.error && <Banner tone="critical"><p>{data.error}</p></Banner>}
        <Select label="Search Console property" options={options} value={data.selectedSiteUrl} onChange={(siteUrl) => siteUrl && submit({ intent: "google_select", siteUrl })} />
        <InlineGrid columns={2} gap="300">
          <CompactSearchMetric label="Clicks" value={String(data.summary.clicks)} />
          <CompactSearchMetric label="Impressions" value={String(data.summary.impressions)} />
          <CompactSearchMetric label="CTR" value={`${(data.summary.ctr * 100).toFixed(1)}%`} />
          <CompactSearchMetric label="Position" value={data.summary.position ? data.summary.position.toFixed(1) : "—"} />
        </InlineGrid>
        {data.opportunities.length > 0 && <BlockStack gap="300">
          <Divider />
          <Text as="h3" variant="headingSm">Top opportunities</Text>
          {data.opportunities.slice(0, showAllOpportunities ? data.opportunities.length : 3).map((item, index) => <BlockStack key={item.id} gap="200">
            {index > 0 && <Divider />}
            <InlineStack align="space-between" blockAlign="center" wrap={false} gap="200">
              <BlockStack gap="050"><Text as="span" fontWeight="semibold">{item.title}</Text><Text as="span" variant="bodySm" tone="subdued">{item.query || "Page total"} · {item.detail}</Text></BlockStack>
              <Button size="micro" url={item.pageUrl} target="_blank">Open</Button>
            </InlineStack>
          </BlockStack>)}
          {data.opportunities.length > 3 && (
            <Button variant="plain" onClick={() => setShowAllOpportunities((current) => !current)}>
              {showAllOpportunities ? "Show less" : `View all opportunities (${data.opportunities.length})`}
            </Button>
          )}
        </BlockStack>}
      </BlockStack>
    </Card>
  );
}

function CompactSearchMetric({ label, value }: { label: string; value: string }) {
  return (
    <Box background="bg-surface-secondary" padding="300" borderRadius="300">
      <BlockStack gap="050">
        <Text as="span" variant="bodySm" tone="subdued">{label}</Text>
        <Text as="span" variant="headingLg" fontWeight="bold">{value}</Text>
      </BlockStack>
    </Box>
  );
}

function MetricCard({
  title,
  value,
  suffix,
  tone,
  icon,
  progress,
}: {
  title: string;
  value: string;
  suffix?: string;
  tone: "success" | "warning" | "critical" | "info";
  icon: any;
  progress: number;
}) {
  return (
    <Card padding="400">
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <InlineStack gap="150" blockAlign="center" wrap={false}>
            <Icon source={icon} tone={tone as any} />
            <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
              {title}
            </Text>
          </InlineStack>
        </InlineStack>
        <InlineStack gap="100" blockAlign="end">
          <Text as="span" variant="heading2xl" fontWeight="bold">
            {value}
          </Text>
          {suffix && (
            <Text as="span" variant="bodyMd" tone="subdued">
              {suffix}
            </Text>
          )}
        </InlineStack>
        <ProgressBar progress={Math.max(0, Math.min(100, progress))} tone={tone === "critical" ? "critical" : tone === "warning" ? "primary" : "success"} size="small" />
      </BlockStack>
    </Card>
  );
}

async function fetchShopifyArticles(admin: any, onPage?: (loadedPosts: number) => Promise<void>): Promise<ArticleInput[]> {
  const articles: ArticleInput[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const response = await admin.graphql(`#graphql
      query SeoArticles($after: String) {
        articles(first: 100, after: $after, sortKey: UPDATED_AT) {
          nodes { id title handle updatedAt publishedAt author { name } body summary image { url altText }
            seoTitle: metafield(namespace: "global", key: "title_tag") { value }
            seoDescription: metafield(namespace: "global", key: "description_tag") { value }
            blog { id title handle }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`, { variables: { after: cursor } });
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
      updatedAt: article.updatedAt || "",
      publishedAt: article.publishedAt || null,
      seoTitle: article.seoTitle?.value || "",
      seoDescription: article.seoDescription?.value || "",
      blogId: article.blog?.id || "",
      blogTitle: article.blog?.title || "Blog",
      blogHandle: article.blog?.handle || "",
      authorName: article.author?.name || "",
      });
    }
    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
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
) {
  const issues: SeoIssue[] = [];
  const seoTitle = getEffectiveSeoTitle(storedSeo?.metaTitle, article);
  const seoDescription = getEffectiveSeoDescription(storedSeo?.metaDescription, article);
  const body = article.body || "";
  const bodyText = stripHtml(body);
  const wordCount = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;
  const linkStats = analyzeLinks(body, shopDomain, shopDomains);
  const headings = getHeadingTexts(body);
  const hasToc =
    Boolean(config.canContentNavigation) &&
    Boolean(config.tocEnabled) &&
    (hasTableOfContents(body) || (Boolean(config.tocAutoInsertEnabled) && headings.length >= 3));
  const bodyImageAltText = getBodyImageAltText(body);
  const allImageAltText = `${article.imageAlt || ""} ${bodyImageAltText}`.trim();
  const hasAnyImage = Boolean(article.imageUrl) || /<img\b/i.test(body);
  const hasMediaInBody = productCount > 0 || /<img|<iframe|<video/i.test(body);
  const imageStats = analyzeImages(body);
  const markupStats = analyzeTechnicalMarkup(body);
  const focusKeyword = textValue(storedSeo?.focusKeyword);
  const keywords = focusKeyword
    .split(",")
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);
  const primaryKeyword = keywords[0] || "";
  const titleLower = seoTitle.toLowerCase();
  const summaryLower = seoDescription.toLowerCase();
  const handleLower = (article.handle || "").toLowerCase();
  const bodyLower = bodyText.toLowerCase();
  const first10Words = bodyText
    .split(/\s+/)
    .slice(0, Math.max(20, Math.floor(wordCount * 0.1)))
    .join(" ")
    .toLowerCase();

  const addIssue = (issue: SeoIssue, _penalty: number) => {
    issues.push(issue);
  };

  if (!seoDescription) {
    addIssue(
      {
        type: "missing_meta_description",
        category: "on_page",
        label: "Missing meta descriptions",
        message: "Meta descriptions help search engines and shoppers understand each post.",
        severity: "critical",
        impact: "High",
        effort: "Low",
        fix: "Add a unique 120-160 character meta description.",
      },
      18,
    );
  } else if (seoDescription.length < 70) {
    addIssue(
      {
        type: "short_meta_description",
        category: "on_page",
        label: "Short meta descriptions",
        message: "Short descriptions may underperform in search results.",
        severity: "warning",
        impact: "Medium",
        effort: "Low",
        fix: "Expand the meta description with a clearer benefit.",
      },
      6,
    );
  } else if (seoDescription.length > 165) {
    addIssue(
      {
        type: "long_meta_description",
        category: "on_page",
        label: "Long meta descriptions",
        message: "Long descriptions can be truncated in search results.",
        severity: "warning",
        impact: "Low",
        effort: "Low",
        fix: "Trim the meta description under 165 characters.",
      },
      4,
    );
  }

  if (!seoTitle) {
    addIssue(
      {
        type: "missing_seo_title",
        category: "on_page",
        label: "Missing SEO titles",
        message: "SEO titles should be unique and descriptive.",
        severity: "warning",
        impact: "Medium",
        effort: "Low",
        fix: "Add a unique SEO title for each post.",
      },
      12,
    );
  } else if (seoTitle.length > 70) {
    addIssue(
      {
        type: "long_seo_title",
        category: "on_page",
        label: "Long SEO titles",
        message: "Long SEO titles can be cut off on search results pages.",
        severity: "warning",
        impact: "Low",
        effort: "Low",
        fix: "Keep SEO titles under 70 characters.",
      },
      4,
    );
  }

  if (article.imageUrl && !article.imageAlt.trim()) {
    addIssue(
      {
        type: "missing_image_alt",
        category: "image",
        label: "Missing image alt text",
        message: "Alt text improves accessibility and image search visibility.",
        severity: "warning",
        impact: "Medium",
        effort: "Low",
        fix: "Add descriptive alt text to blog images.",
      },
      8,
    );
  }

  if (imageStats.inlineMissingAlt > 0) {
    addIssue({
      type: "inline_images_missing_alt",
      category: "image",
      label: "Inline images missing alt text",
      message: `${imageStats.inlineMissingAlt} inline image(s) have no alt attribute.`,
      severity: "warning",
      impact: "Medium",
      effort: "Low",
      fix: "Add concise descriptive alt text, or alt=\"\" for decorative images.",
    }, 5);
  }

  if (imageStats.missingDimensions > 0) {
    addIssue({
      type: "images_missing_dimensions",
      category: "image",
      label: "Images missing dimensions",
      message: `${imageStats.missingDimensions} inline image(s) are missing width or height attributes.`,
      severity: "warning",
      impact: "Medium",
      effort: "Low",
      fix: "Set intrinsic width and height to reduce layout shift.",
    }, 3);
  }

  if (imageStats.genericFilenames > 0) {
    addIssue({
      type: "generic_image_filenames",
      category: "image",
      label: "Generic image filenames",
      message: `${imageStats.genericFilenames} image(s) use a generic filename that provides little context.`,
      severity: "info",
      impact: "Low",
      effort: "Medium",
      fix: "Use short descriptive filenames when uploading replacement images.",
    }, 1);
  }

  if (!article.authorName.trim()) {
    addIssue({
      type: "missing_author",
      category: "content",
      label: "Missing author attribution",
      message: "The article has no author information in Shopify data.",
      severity: "warning",
      impact: "Medium",
      effort: "Low",
      fix: "Assign an accurate author and expose a useful author profile in the theme.",
    }, 4);
  }

  if (markupStats.unsafeLinks > 0) {
    addIssue({
      type: "unsafe_or_uncrawlable_links",
      category: "on_page",
      label: "Uncrawlable links",
      message: `${markupStats.unsafeLinks} link(s) use an empty or JavaScript URL.`,
      severity: "critical",
      impact: "High",
      effort: "Low",
      fix: "Replace empty and JavaScript href values with real crawlable URLs or buttons.",
    }, 8);
  }

  if (markupStats.skippedHeadingLevels > 0) {
    addIssue({
      type: "heading_hierarchy",
      category: "content",
      label: "Heading hierarchy",
      message: `${markupStats.skippedHeadingLevels} heading transition(s) skip a level.`,
      severity: "warning",
      impact: "Low",
      effort: "Low",
      fix: "Keep the outline sequential, such as H2 followed by H3 rather than H4.",
    }, 2);
  }

  if (markupStats.duplicateHeadingIds > 0) {
    addIssue({
      type: "duplicate_heading_ids",
      category: "on_page",
      label: "Duplicate heading anchors",
      message: `${markupStats.duplicateHeadingIds} heading id(s) are duplicated and can break TOC links.`,
      severity: "warning",
      impact: "Medium",
      effort: "Low",
      fix: "Give every heading a unique id value.",
    }, 3);
  }

  if (productCount === 0) {
    addIssue(
      {
        type: "no_linked_products",
        category: "product_linking",
        label: "No linked products",
        message: "Posts without products cannot drive shoppable engagement.",
        severity: "critical",
        impact: "High",
        effort: "Medium",
        fix: "Link relevant products to the post.",
      },
      18,
    );
  }

  if (wordCount < 250) {
    addIssue(
      {
        type: "thin_content",
        category: "content",
        label: "Thin content",
        message: `Content is ${wordCount} words long. Confirm that it completely answers the intended reader need; there is no required SEO word count.`,
        severity: wordCount < 80 ? "critical" : "warning",
        impact: wordCount < 80 ? "High" : "Medium",
        effort: "Medium",
        fix: "Add original evidence, examples, comparisons, or missing answers—not filler text.",
      },
      8,
    );
  } else if (wordCount < 600) {
    addIssue(
      {
        type: "short_content",
        category: "content",
        label: "Short content",
        message: `Content is ${wordCount} words long. Expand it only if important questions or evidence are missing.`,
        severity: "info",
        impact: "Low",
        effort: "Medium",
        fix: "Review search intent and add only information that improves the reader's outcome.",
      },
      5,
    );
  }

  if (!hasMediaInBody && !article.imageUrl) {
    addIssue(
      {
        type: "missing_media",
        category: "content",
        label: "Missing media",
        message: "Add images, products, or videos to improve content readability.",
        severity: "warning",
        impact: "Medium",
        effort: "Medium",
        fix: "Add a featured image, inline media, or a linked product block.",
      },
      5,
    );
  }

  const longParagraphs = body.split(/<\/p>/i).filter((paragraph) => stripHtml(paragraph).split(/\s+/).length > 120);
  if (longParagraphs.length > 0) {
    addIssue(
      {
        type: "long_paragraphs",
        category: "content",
        label: "Long paragraphs",
        message: "Some paragraphs are too long. Keep paragraphs short and easy to scan.",
        severity: "warning",
        impact: "Low",
        effort: "Low",
        fix: "Split long paragraphs into shorter sections.",
      },
      3,
    );
  }

  if (!hasToc) {
    addIssue(
      {
        type: "missing_toc",
        category: "content",
        label: "Missing table of contents",
        message: config.canContentNavigation
          ? "You don't seem to be using a Table of Contents."
          : "Table of Contents is not available on your current plan.",
        severity: "warning",
        impact: "Low",
        effort: "Low",
        fix: config.canContentNavigation
          ? "Enable Table of Contents in Settings, or add a TOC shortcode/block."
          : "Upgrade your plan to use Table of Contents.",
      },
      2,
    );
  }

  if (headings.length === 0) {
    addIssue(
      {
        type: "missing_subheadings",
        category: "content",
        label: "Missing subheadings",
        message: "Subheadings make posts easier to scan and understand.",
        severity: "info",
        impact: "Low",
        effort: "Low",
        fix: "Add clear H2/H3 sections to structure the article.",
      },
      4,
    );
  }

  if (!article.handle || article.handle.length > 75) {
    addIssue(
      {
        type: "long_url",
        category: "on_page",
        label: "URL length",
        message: "URL is too long. Consider shortening it.",
        severity: "warning",
        impact: "Low",
        effort: "Low",
        fix: "Use a short descriptive URL handle.",
      },
      2,
    );
  }

  if (linkStats.external < 1) {
    addIssue(
      {
        type: "missing_external_links",
        category: "content",
        label: "Missing external links",
        message: "Link out to external resources.",
        severity: "warning",
        impact: "Medium",
        effort: "Low",
        fix: "Add a relevant external reference link.",
      },
      3,
    );
  }

  if (linkStats.dofollowExternal < 1) {
    addIssue(
      {
        type: "missing_dofollow_external_links",
        category: "content",
        label: "External link qualification",
        message: "No standard external reference link was found. This is optional when no citation would help readers.",
        severity: "info",
        impact: "Low",
        effort: "Low",
        fix: "When citing evidence, use a relevant source and qualify sponsored or user-generated links appropriately.",
      },
      2,
    );
  }

  if (linkStats.internal < 1) {
    addIssue(
      {
        type: "missing_internal_links",
        category: "content",
        label: "Missing internal links",
        message: "Add internal links in your content.",
        severity: "warning",
        impact: "Medium",
        effort: "Low",
        fix: "Link to another blog post, collection, product, or page on the store.",
      },
      3,
    );
  }

  if (!/\d/.test(seoTitle)) {
    addIssue(
      {
        type: "title_number",
        category: "on_page",
        label: "Title format opportunity",
        message: "A number may improve clarity for list or comparison posts, but it is not an SEO requirement.",
        severity: "info",
        impact: "Low",
        effort: "Low",
        fix: "Use a number only when the content genuinely follows a numbered format.",
      },
      2,
    );
  }

  if (primaryKeyword) {
    const occurrences = bodyLower.split(primaryKeyword).length - 1;
    const density = wordCount > 0 ? ((occurrences * primaryKeyword.split(" ").length) / wordCount) * 100 : 0;
    const inTitle = titleLower.includes(primaryKeyword);
    const inSummary = summaryLower.includes(primaryKeyword);
    const inHandle = handleLower.includes(slugifyKeyword(primaryKeyword));
    const inFirst10 = first10Words.includes(primaryKeyword);
    const inHeading = headings.some((heading) => heading.toLowerCase().includes(primaryKeyword));
    const inImageAlt = hasAnyImage && allImageAltText.toLowerCase().includes(primaryKeyword);

    if (!inTitle) {
      addIssue(
        {
          type: "focus_keyword_title",
          category: "on_page",
          label: "Focus keyword in title",
          message: "Add Focus Keyword to the SEO title.",
          severity: "critical",
          impact: "High",
          effort: "Low",
          fix: "Add the primary focus keyword to the SEO title.",
        },
        10,
      );
    } else if (titleLower.indexOf(primaryKeyword) >= 20) {
      addIssue(
        {
          type: "focus_keyword_title_position",
          category: "on_page",
          label: "Focus keyword position",
          message: "Use the Focus Keyword near the beginning of SEO title.",
          severity: "warning",
          impact: "Low",
          effort: "Low",
          fix: "Move the focus keyword closer to the start of the SEO title.",
        },
        1,
      );
    }

    if (!inSummary) {
      addIssue(
        {
          type: "focus_keyword_meta",
          category: "on_page",
          label: "Focus keyword in meta",
          message: "Add Focus Keyword to your SEO Meta Description.",
          severity: "warning",
          impact: "Medium",
          effort: "Low",
          fix: "Include the focus keyword naturally in the meta description.",
        },
        5,
      );
    }

    if (!inHandle) {
      addIssue(
        {
          type: "focus_keyword_url",
          category: "on_page",
          label: "Focus keyword in URL",
          message: "Use Focus Keyword in the URL.",
          severity: "warning",
          impact: "Medium",
          effort: "Low",
          fix: "Add the focus keyword to the article handle.",
        },
        5,
      );
    }

    if (!inFirst10) {
      addIssue(
        {
          type: "focus_keyword_beginning",
          category: "content",
          label: "Focus keyword at start",
          message: "Use Focus Keyword at the beginning of your content.",
          severity: "warning",
          impact: "Medium",
          effort: "Low",
          fix: "Mention the focus keyword in the opening paragraph.",
        },
        5,
      );
    }

    if (occurrences === 0) {
      addIssue(
        {
          type: "focus_keyword_content",
          category: "content",
          label: "Focus keyword in content",
          message: "Use Focus Keyword in the content.",
          severity: "critical",
          impact: "High",
          effort: "Medium",
          fix: "Mention the focus keyword naturally in the article body.",
        },
        15,
      );
    } else if (density > 4) {
      addIssue(
        {
          type: "keyword_density",
          category: "content",
          label: "Keyword density",
          message: `The exact phrase appears at ${density.toFixed(2)}% density and may read repetitively.`,
          severity: "warning",
          impact: "Low",
          effort: "Medium",
          fix: "Replace repetitive exact matches with natural language and useful topic variants.",
        },
        2,
      );
    }

    if (!inHeading) {
      addIssue(
        {
          type: "focus_keyword_heading",
          category: "content",
          label: "Focus keyword in subheadings",
          message: "Use Focus Keyword in subheading(s) like H2, H3, H4, etc.",
          severity: "warning",
          impact: "Low",
          effort: "Medium",
          fix: "Add the focus keyword to one useful H2 or H3.",
        },
        2,
      );
    }

    if (!inImageAlt) {
      addIssue(
        {
          type: "focus_keyword_image_alt",
          category: "image",
          label: "Focus keyword in image alt",
          message: "Add an image with your Focus Keyword as alt text.",
          severity: "warning",
          impact: "Low",
          effort: "Low",
          fix: "Add the focus keyword to a relevant image alt text.",
        },
        2,
      );
    }

    keywords.slice(1).forEach((keyword, index) => {
      if (bodyLower.split(keyword).length - 1 === 0) {
        addIssue(
          {
            type: `secondary_keyword_${index + 1}`,
            category: "content",
            label: "Secondary keyword in content",
            message: `Secondary keyword "${keyword}" does not appear in the content.`,
            severity: "warning",
            impact: "Low",
            effort: "Low",
            fix: "Mention the secondary keyword naturally if it fits the article.",
          },
          3,
        );
      }
    });
  } else {
    addIssue(
      {
        type: "missing_focus_keyword",
        category: "on_page",
        label: "Missing focus keyword",
        message: "Set a Focus Keyword for this content.",
        severity: "info",
        impact: "Low",
        effort: "Low",
        fix: "Optionally set a primary topic to organize reporting; do not force an exact-match phrase into the copy.",
      },
      30,
    );
  }

  if (!config.addBlogSchema || (productCount > 0 && !config.addProductSchema)) {
    addIssue(
      {
        type: "schema_disabled",
        category: "schema",
        label: "Schema settings disabled",
        message: "Structured data can help eligible rich results.",
        severity: "info",
        impact: "Low",
        effort: "Low",
        fix: "Enable blog and product schema in Settings.",
      },
      3,
    );
  }

  return {
    score: Math.max(
      0,
      calculateBlogDetailSeoScore(article, productCount, storedSeo, config, shopDomain, shopDomains) -
        Math.min(12, imageStats.inlineMissingAlt * 3 + imageStats.missingDimensions * 2 + imageStats.genericFilenames) -
        (article.authorName.trim() ? 0 : 4) -
        Math.min(10, markupStats.unsafeLinks * 5 + markupStats.skippedHeadingLevels + markupStats.duplicateHeadingIds * 2),
    ),
    issues,
  };
}

function calculateBlogDetailSeoScore(
  article: ArticleInput,
  productCount: number,
  storedSeo?: StoredSeoInput | null,
  config: SeoAuditConfig = {},
  shopDomain?: string,
  shopDomains: string[] = [],
) {
  const title = getEffectiveSeoTitle(storedSeo?.metaTitle, article);
  const summary = getEffectiveSeoDescription(storedSeo?.metaDescription, article);
  return runSeoAudit({
    title,
    handle: article.handle || "",
    summary,
    body: article.body || "",
    hasImage: Boolean(article.imageUrl),
    imageAlt: article.imageAlt || "",
    productCount,
    focusKeyword: textValue(storedSeo?.focusKeyword),
    shopDomain,
    shopDomains,
    canUseTableOfContents: Boolean(config.canContentNavigation),
    tocEnabled: Boolean(config.tocEnabled),
    tocAutoInsertEnabled: Boolean(config.tocAutoInsertEnabled),
  }).score;
}

function analyzeLinks(body: string, shopDomain?: string, shopDomains: string[] = []) {
  const stats = { internal: 0, external: 0, dofollowExternal: 0 };
  const shopHosts = buildShopHosts(shopDomain, shopDomains);
  const anchorRegex = /<a\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(body || "")) !== null) {
    const attrs = match[1] || "";
    const href = getHtmlAttribute(attrs, "href").trim();
    if (!href || /^(mailto:|tel:|sms:|javascript:)/i.test(href)) continue;

    const rel = getHtmlAttribute(attrs, "rel").toLowerCase();
    const isNoFollow = /\b(nofollow|sponsored|ugc)\b/i.test(rel);

    if (isInternalHref(href, shopHosts)) {
      stats.internal += 1;
    } else {
      stats.external += 1;
      if (!isNoFollow) stats.dofollowExternal += 1;
    }
  }

  return stats;
}

function getHtmlAttribute(attrs: string, name: string) {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[2] || match?.[3] || match?.[4] || "";
}

function isInternalHref(href: string, shopHosts: Set<string>) {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("/")) return true;

  try {
    const url = new URL(trimmed);
    const host = normalizeHost(url.hostname);
    return Array.from(shopHosts).some((shopHost) => host === shopHost || host.endsWith(`.${shopHost}`));
  } catch {
    return true;
  }
}

function buildShopHosts(shopDomain?: string, shopDomains: string[] = []) {
  const hosts = new Set<string>();

  [shopDomain, ...shopDomains].forEach((domain) => {
    const host = normalizeHost(domain || "");
    if (host) hosts.add(host);
  });

  return hosts;
}

function normalizeHost(value: string) {
  return value
    .replace(/^https?:\/\//i, "")
    .split(/[/?#]/)[0]
    .replace(/^www\./i, "")
    .toLowerCase();
}

function getHeadingTexts(body: string) {
  const headings: string[] = [];
  const headingRegex = /<h[2-6][^>]*>(.*?)<\/h[2-6]>/gi;
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(body || "")) !== null) {
    headings.push(stripHtml(match[1] || ""));
  }

  return headings;
}

function hasTableOfContents(body: string) {
  return /\[\[SBS_TOC(?::[^\]]+)?\]\]/i.test(body) || /data-bp-content-nav=["']toc["']|class=["'][^"']*\bbp-toc\b/i.test(body);
}

function getBodyImageAltText(body: string) {
  const alts: string[] = [];
  const imageRegex = /<img\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = imageRegex.exec(body || "")) !== null) {
    const alt = getHtmlAttribute(match[1] || "", "alt");
    if (alt) alts.push(alt);
  }

  return alts.join(" ");
}

function analyzeImages(body: string) {
  const stats = { inlineMissingAlt: 0, missingDimensions: 0, genericFilenames: 0 };
  for (const match of body.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = match[1] || "";
    if (!/\balt\s*=/i.test(attrs)) stats.inlineMissingAlt += 1;
    if (!/\bwidth\s*=/i.test(attrs) || !/\bheight\s*=/i.test(attrs)) stats.missingDimensions += 1;
    const src = getHtmlAttribute(attrs, "src");
    const filename = src.split(/[?#]/)[0].split("/").pop() || "";
    if (/^(img|image|photo|pic|dsc|screenshot|untitled)[-_]?\d*\.(jpe?g|png|gif|webp|avif)$/i.test(filename)) {
      stats.genericFilenames += 1;
    }
  }
  return stats;
}

function analyzeTechnicalMarkup(body: string) {
  let unsafeLinks = 0;
  for (const match of body.matchAll(/<a\b([^>]*)>/gi)) {
    const href = getHtmlAttribute(match[1] || "", "href").trim();
    if (!href || /^javascript:/i.test(href)) unsafeLinks += 1;
  }

  const levels = Array.from(body.matchAll(/<h([2-6])\b/gi), (match) => Number(match[1]));
  let skippedHeadingLevels = 0;
  levels.forEach((level, index) => {
    if (index > 0 && level > levels[index - 1] + 1) skippedHeadingLevels += 1;
  });

  const ids = Array.from(body.matchAll(/<h[2-6]\b([^>]*)>/gi), (match) => getHtmlAttribute(match[1] || "", "id")).filter(Boolean);
  const duplicateHeadingIds = ids.length - new Set(ids).size;
  return { unsafeLinks, skippedHeadingLevels, duplicateHeadingIds };
}

function buildIssueGroups(posts: AuditedPost[]): IssueGroup[] {
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
        status: "Needs review",
        fix: issue.fix,
        actionLabel: getActionLabel(issue.category),
        examples: [],
        targetPostId: post.id,
        affectedPosts: [],
      };

      group.affected += 1;
      if (group.examples.length < 3) group.examples.push(post.title);
      group.affectedPosts.push({ id: post.id, title: post.title, blogTitle: post.blogTitle });
      map.set(issue.type, group);
    });
  });

  return Array.from(map.values()).sort(
    (a, b) => getImpactWeight(b.impact) - getImpactWeight(a.impact) || b.affected - a.affected || a.issue.localeCompare(b.issue),
  );
}

function applyPortfolioIssues(posts: AuditedPost[]) {
  const portfolioIssues = auditSeoPortfolio(posts.map((post) => ({
    id: post.id,
    title: post.title,
    seoTitle: post.effectiveSeoTitle,
    seoDescription: post.effectiveSeoDescription,
    focusKeyword: post.focusKeyword,
    body: post.body,
    blogHandle: post.blogHandle,
    handle: post.handle,
  })));

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

function getActionLabel(category: SeoCategory) {
  if (category === "product_linking") return "Add products";
  if (category === "image") return "Add alt text";
  if (category === "schema") return "Open settings";
  if (category === "content") return "Edit content";
  return "Review";
}

function getPostTarget(postId: string) {
  return `/app/blogs/${encodeURIComponent(postId)}`;
}

function getImpactWeight(impact: Impact) {
  if (impact === "High") return 3;
  if (impact === "Medium") return 2;
  return 1;
}

function getEffortMinutes(effort: Effort) {
  if (effort === "High") return 35;
  if (effort === "Medium") return 20;
  return 8;
}

function getImpactTone(impact: Impact) {
  if (impact === "High") return "critical";
  if (impact === "Medium") return "warning";
  return "success";
}

function getEffortTone(effort: Effort) {
  if (effort === "High") return "critical";
  if (effort === "Medium") return "warning";
  return "success";
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
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

function getEffectiveSeoTitle(metaTitle: unknown, article: ArticleInput) {
  const meta = textValue(metaTitle);
  const title = textValue(article.title);

  if (meta && !isLikelyStaleAutoMetaTitle(meta, title)) return meta;

  const shopifySeoTitle = textValue(article.seoTitle);
  if (shopifySeoTitle && !isLikelyStaleAutoMetaTitle(shopifySeoTitle, title)) return shopifySeoTitle;

  return title;
}

function getEffectiveSeoDescription(metaDescription: unknown, article: ArticleInput) {
  return textValue(metaDescription) || textValue(article.seoDescription) || textValue(article.summary);
}

function slugifyKeyword(value: string) {
  return slugifySeoText(value);
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getSeoContentHash(article: ArticleInput, productCount: number, config: SeoAuditConfig) {
  return crypto.createHash("sha256").update(JSON.stringify({
    title: article.title, handle: article.handle, body: article.body, summary: article.summary, publishedAt: article.publishedAt,
    imageUrl: article.imageUrl, imageAlt: article.imageAlt, seoTitle: article.seoTitle,
    seoDescription: article.seoDescription, authorName: article.authorName, productCount,
    config: { addBlogSchema: config.addBlogSchema, addProductSchema: config.addProductSchema, canContentNavigation: config.canContentNavigation, tocEnabled: config.tocEnabled, tocAutoInsertEnabled: config.tocAutoInsertEnabled },
  })).digest("hex");
}

function datesEqual(left: Date | null | undefined, right: Date | null) {
  return (left?.getTime() || 0) === (right?.getTime() || 0);
}

export function links() {
  return [
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
        `),
    },
  ];
}
