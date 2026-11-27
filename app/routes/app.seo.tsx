import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data as json , useFetcher, useLoaderData, useNavigate, useRevalidator, useSearchParams } from "react-router";
import {
  Badge,
  BlockStack,
  Box,
  Button,
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
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import prisma from "../db.server";
import { articleSearchPath, buildImpressionsByPath, formatImpressions, issuePriority } from "../seo-priority";
import { getPublicSeoScanError } from "../seo-scan-error";
import catalogSeoStyles from "../styles/catalog-seo.css?url";
import { SEO_WORKSPACE_TABS } from "../components/WorkspaceTabs";
import { IssueScopeSwitcher } from "../components/IssueScopeSwitcher";
import { AppPage } from "../components/AppPage";
import { ActionRow, ActionRows, AiButton, Chips, DotScore, GroupLabel, IconTile, Pill, ScoreRing, StatTile, StatTiles, impactTone } from "../components/rm";

import { SEO_AUDIT_VERSION, parseStoredIssues, getAverageScore } from "../seo-scan.server";
import type { SeoCategory, Impact, Effort, AuditedPost } from "../seo-scan.server";

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

const PLACEHOLDER_IMAGE = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";
// v8: single engine (seo-audit.ts), Shopify-sourced metadata, area-based scoring.
const CATEGORY_TABS: Array<{ id: SeoCategory | "all"; content: string }> = [
  { id: "all", content: "All issues" },
  { id: "on_page", content: "On-page SEO" },
  { id: "product_linking", content: "Product linking" },
  { id: "image", content: "Images" },
  { id: "schema", content: "Schema" },
  { id: "content", content: "Content quality" },
];


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
  // Background and scheduled scans call /api/seo-worker, not this page.
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
          <s-section>
            <Text as="p" variant="bodyMd" tone="caution">
              {shopifyError} Existing saved SEO rows are still shown when available.
            </Text>
          </s-section>
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
          <s-section padding="none">
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
          </s-section>

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

            <s-section>
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
            </s-section>

            <s-section padding="none">
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
            </s-section>
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
    <s-section>
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
    </s-section>
  );
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
