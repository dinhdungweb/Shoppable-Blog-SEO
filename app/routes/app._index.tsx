import type { LoaderFunctionArgs } from "react-router";
import { data as json , useFetcher, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { useEffect, useRef, useState } from "react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Divider,
  InlineGrid,
  InlineStack,
  Spinner,
  Text,
  Layout,
} from "@shopify/polaris";
import {
  CheckIcon,
  ImageIcon,
  MagicIcon,
  NoteIcon,
  LockIcon,
  CartIcon,
  ChartVerticalIcon,
  CodeIcon,
  ListBulletedIcon,
  ClockIcon,
  ProductIcon,
  SearchIcon,
  LinkIcon,
  RefreshIcon,
  GaugeIcon,
  SettingsIcon,
} from "@shopify/polaris-icons";
import { AppPage } from "../components/AppPage";
import { ActionRow, ActionRows, Bar, IconTile, Pill, ScoreRing, StatTile, impactTone } from "../components/rm";
import { SetupGuide, type SetupStep } from "../components/SetupGuide";
import { ModuleGrid, type AppModule, type ModuleStatus } from "../components/ModuleGrid";
import { getAiUsageStatus } from "../ai-usage.server";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import prisma from "../db.server";
import { analyticsWindow, emptyMetrics as emptyCoreMetrics, formatMoney as formatCurrency, groupRows, normalizeProductGid, parseMoney, sumRows, type Metrics } from "../analytics-core";
import { canonicalArticleId, getShopLocale, loadDailyRows, priceLookup } from "../analytics.server";
import { auditMetaTags } from "../meta-tag-audit";
import { buildHomeTasks, computeStoreSeoScore, type HomeTask, type StoreSeoScore } from "../home-tasks";

type DashboardArticle = {
  id: string;
  title: string;
  handle: string;
  image: string;
  imageAlt: string;
  publishedAt: string | null;
  updatedAt: string | null;
  seoTitle: string;
  seoDescription: string;
  blogId: string;
  blogTitle: string;
  blogHandle: string;
  productCount: number;
  seoScore: number | null;
  clicks: number;
  impressions: number;
  addToCarts: number;
  purchases: number;
  revenue: number;
};

type PeriodMetrics = {
  impressions: number;
  clicks: number;
  addToCarts: number;
  purchases: number;
  revenue: number;
};



export const loader = async ({ request }: LoaderFunctionArgs) => {
  const startedAt = Date.now();
  const { admin, session, billing } = await authenticate.admin(request);
  const shop = session.shop;

  // Resolve plan limits to determine the analytics window
  const { planKey, limits } = await getActivePlanAndLimits(billing, shop);
  const windowDays = limits.analyticsWindowDays; // e.g. 7, 30, or 90

  const now = new Date();
  // Home and Insights read the same daily aggregates in the shop's time zone.
  const locale = await getShopLocale(admin, shop);
  const { currentStart, previousStart } = analyticsWindow(now, windowDays, locale.timezone);

  const shopifyError = "";
  let baseArticles: any[] = [];

  const [
    linkedProducts,
    seoRows,
    allEvents,
    everEventCount,
  ] = await Promise.all([
    prisma.articleProduct.findMany({
      where: { shop, isActive: true },
      select: {
        articleId: true,
        articleTitle: true,
        articleHandle: true,
        blogId: true,
        productId: true,
        productTitle: true,
        productImage: true,
        productPrice: true,
      },
    }),
    prisma.articleSEO.findMany({
      where: { shop },
      select: { articleId: true, articleTitle: true, seoScore: true, metaDescription: true, metaTitle: true, articleHandle: true, imageUrl: true, imageAlt: true, blogTitle: true, blogHandle: true, sourceUpdatedAt: true, publishedAt: true, lastAnalyzedAt: true, issues: true },
    }),
    loadDailyRows(shop, previousStart),
    prisma.widgetEvent.count({ where: { shop } }),
  ]);

  baseArticles = seoRows.map((row) => ({ id: row.articleId, title: row.articleTitle || "Untitled post", handle: row.articleHandle,
    image: row.imageUrl, imageAlt: row.imageAlt, publishedAt: row.publishedAt?.toISOString() || null,
    updatedAt: row.sourceUpdatedAt?.toISOString() || null, seoTitle: row.metaTitle || "", seoDescription: row.metaDescription || "",
    blogId: "", blogTitle: row.blogTitle || "Blog", blogHandle: row.blogHandle }));

  const productCountMap = new Map<string, number>();
  const productInfoMap = new Map<string, { title: string; image: string; price: number }>();

  linkedProducts.forEach((product) => {
    const price = parseMoney(product.productPrice);
    productCountMap.set(product.articleId, (productCountMap.get(product.articleId) || 0) + 1);

    if (!productInfoMap.has(product.productId)) {
      productInfoMap.set(product.productId, {
        title: product.productTitle || "Untitled product",
        image: product.productImage || "",
        price,
      });
    }
  });

  const fallbackArticleMap = new Map<string, (typeof baseArticles)[number]>();

  linkedProducts.forEach((product) => {
    if (!fallbackArticleMap.has(product.articleId)) {
      fallbackArticleMap.set(product.articleId, {
        id: product.articleId,
        title: product.articleTitle || "Untitled post",
        handle: product.articleHandle || "",
        image: "",
        imageAlt: "",
        publishedAt: null,
        updatedAt: null,
        seoTitle: "",
        seoDescription: "",
        blogId: product.blogId || "",
        blogTitle: "Blog",
        blogHandle: "",
      });
    }
  });

  seoRows.forEach((row) => {
    const existingArticle = fallbackArticleMap.get(row.articleId);
    fallbackArticleMap.set(row.articleId, {
      id: row.articleId,
      title: existingArticle?.title || row.articleTitle || "Untitled post",
      handle: existingArticle?.handle || "",
      image: existingArticle?.image || "",
      imageAlt: existingArticle?.imageAlt || "",
      publishedAt: existingArticle?.publishedAt || null,
      updatedAt: existingArticle?.updatedAt || null,
      seoTitle: existingArticle?.seoTitle || "",
      seoDescription: existingArticle?.seoDescription || row.metaDescription || "",
      blogId: existingArticle?.blogId || "",
      blogTitle: existingArticle?.blogTitle || "Blog",
      blogHandle: existingArticle?.blogHandle || "",
    });
  });

  const seoMap = new Map(seoRows.map((row) => [row.articleId, row.seoScore]));
  const seoDescriptionMap = new Map(seoRows.map((row) => [row.articleId, row.metaDescription || ""]));
  const currency = locale.currencyCode;
  const priceOf = priceLookup(linkedProducts.map((product) => ({ ...product, articleId: canonicalArticleId(product.articleId), productId: normalizeProductGid(product.productId) })));
  const currentEvents = allEvents.filter((row) => row.date >= currentStart);
  const previousEvents = allEvents.filter((row) => row.date < currentStart);
  const currentMetrics = toPeriod(sumRows(currentEvents, currency, priceOf));
  const previousMetrics = toPeriod(sumRows(previousEvents, currency, priceOf));
  const articleMetricsMap = new Map([...groupRows(currentEvents, (row) => row.articleId, currency, priceOf)].map(([id, metrics]) => [id, toPeriod(metrics)]));
  const articleSources = baseArticles.length ? baseArticles : Array.from(fallbackArticleMap.values());

  const articles: DashboardArticle[] = articleSources
    .map((article) => {
      const metrics = articleMetricsMap.get(article.id) || emptyMetrics();
      return {
        ...article,
        seoDescription: article.seoDescription || seoDescriptionMap.get(article.id) || "",
        productCount: productCountMap.get(article.id) || 0,
        seoScore: seoMap.has(article.id) ? seoMap.get(article.id)! : null,
        ...metrics,
      };
    })
    .sort((a, b) => getTimeValue(b.updatedAt || b.publishedAt) - getTimeValue(a.updatedAt || a.publishedAt));

  const hasPublishStateSnapshot = articles.some((article) => Boolean(article.publishedAt));
  const publishedArticles = hasPublishStateSnapshot ? articles.filter((article) => Boolean(article.publishedAt)) : articles;
  const shoppablePublishedCount = publishedArticles.filter((article) => article.productCount > 0).length;
  const missingMetaDescriptions = articles.filter((article) => !article.seoDescription).length;
  const noLinkedProducts = articles.filter((article) => article.productCount === 0).length;
  const highTrafficNoProducts = articles.filter((article) => article.impressions >= 10 && article.productCount === 0).length;
  const lowCtrPosts = articles.filter(
    (article) => article.productCount > 0 && article.impressions >= 10 && getCtr(article.clicks, article.impressions) < 1,
  ).length;
  const averageSeoScore = getAverageSeoScore(articles);

  // ── Cross-workspace signals for the "What to do next" queue ──────────────
  const [catalogAverages, catalogIssueCounts, speedScans, decayAnalysis, linkAnalysis, searchConnection, moduleConfig, aiUsage] = await Promise.all([
    prisma.resourceSEO.groupBy({ by: ["resourceType"], where: { shop, lastAnalyzedAt: { not: null } }, _avg: { seoScore: true }, _count: { _all: true } }),
    prisma.resourceSEO.groupBy({ by: ["resourceType"], where: { shop, issueCount: { gt: 0 } }, _count: { _all: true } }),
    prisma.storefrontPerformanceScan.findMany({ where: { shop, status: "completed", scannedAt: { not: null } }, select: { mobileScore: true } }),
    prisma.contentDecayAnalysis.findUnique({ where: { shop }, select: { report: true } }),
    prisma.internalLinkAnalysis.findUnique({ where: { shop }, select: { report: true } }),
    prisma.searchConsoleConnection.findUnique({ where: { shop }, select: { selectedSiteUrl: true } }),
    prisma.shopConfig.findUnique({ where: { shop }, select: { appStatus: true, enableConversionTracking: true, breadcrumbsEnabled: true, tocEnabled: true, seoAutoScanEnabled: true } }),
    getAiUsageStatus(shop, limits.aiRequestsPerMonth),
  ]);

  const scannedSeoRows = seoRows.filter((row) => row.lastAnalyzedAt);
  const lastScanAt = scannedSeoRows.reduce<Date | null>((latest, row) => (!latest || row.lastAnalyzedAt! > latest ? row.lastAnalyzedAt : latest), null);
  const metaProblems = seoRows.map((row) => auditMetaTags(row));
  const catalogAverage = (type: string) => catalogAverages.find((row) => row.resourceType === type);
  const catalogIssues = (type: string) => catalogIssueCounts.find((row) => row.resourceType === type)?._count._all || 0;
  const decayIssues = readReportArray<{ articleId: string; severity: string }>(decayAnalysis?.report, "issues");
  const linkReport = linkAnalysis?.report as { orphanArticles?: unknown[]; brokenLinks?: unknown[] } | null | undefined;

  const storeScore = computeStoreSeoScore({
    blog: {
      average: scannedSeoRows.length ? scannedSeoRows.reduce((sum, row) => sum + row.seoScore, 0) / scannedSeoRows.length : null,
      count: scannedSeoRows.length,
    },
    products: { average: catalogAverage("product")?._avg.seoScore ?? null, count: catalogAverage("product")?._count._all || 0 },
    collections: { average: catalogAverage("collection")?._avg.seoScore ?? null, count: catalogAverage("collection")?._count._all || 0 },
    speed: speedScans.length ? speedScans.reduce((sum, scan) => sum + scan.mobileScore, 0) / speedScans.length : null,
  });

  const homeTasks = buildHomeTasks({
    now,
    lastScanAt,
    articlesScanned: scannedSeoRows.length,
    lowScoreArticles: scannedSeoRows.filter((row) => row.seoScore < 50).length,
    missingMetaDescriptions: metaProblems.filter((problems) => problems.includes("missing_description")).length,
    metaLengthProblems: metaProblems.filter((problems) => problems.some((problem) => problem.endsWith("_too_long") || problem.endsWith("_too_short"))).length,
    missingFeaturedAlt: metaProblems.filter((problems) => problems.includes("missing_featured_alt")).length,
    productIssues: catalogIssues("product"),
    collectionIssues: catalogIssues("collection"),
    decay: decayAnalysis
      ? {
          high: new Set(decayIssues.filter((issue) => issue.severity === "high").map((issue) => issue.articleId)).size,
          total: new Set(decayIssues.map((issue) => issue.articleId)).size,
        }
      : null,
    internalLinks: linkReport
      ? { orphans: linkReport.orphanArticles?.length || 0, broken: linkReport.brokenLinks?.length || 0 }
      : null,
    highTrafficNoProducts,
    noLinkedProducts,
    lowCtrPosts,
    trackingEventsReceived: everEventCount > 0,
    limits,
  });

  // Theme and pixel steps are checked after render (slow Shopify calls) and merged on the client.
  const setupSteps: Array<Omit<SetupStep, "action"> & { actionUrl?: string; actionLabel?: string }> = [
    { id: "embed", title: "Turn on the app in your theme", description: "Enable the Shoppable Blog Markers app embed so products, breadcrumbs and the table of contents can appear on your storefront.", done: false, checking: true, actionUrl: "/app/theme-setup", actionLabel: "Open theme setup" },
    { id: "pixel", title: "Connect conversion tracking", description: "The checkout pixel credits add-to-carts and orders to the post that sent the shopper.", done: false, checking: true, actionLabel: "Connect pixel" },
    { id: "products", title: "Link products to a post", description: "Open a post and add the products it mentions. They appear as a carousel or grid inside the article.", done: linkedProducts.length > 0, actionUrl: "/app/blogs", actionLabel: "Open posts" },
    { id: "publish", title: "Publish a shoppable post", description: "Publish a post with linked products so shoppers can discover and buy from your content.", done: shoppablePublishedCount > 0, actionUrl: "/app/blogs", actionLabel: "Open posts" },
    { id: "scan", title: "Run your first SEO scan", description: "Scores every post, product and collection and lists the fixes that matter most.", done: Boolean(lastScanAt), actionUrl: "/app/seo", actionLabel: "Open SEO Analyzer" },
    ...(limits.canSearchConsole
      ? [{ id: "gsc", title: "Connect Google Search Console", description: "See the searches that bring readers to each post and spot posts losing traffic.", done: Boolean(searchConnection?.selectedSiteUrl), actionUrl: "/app/settings?tab=integrations", actionLabel: "Connect" }]
      : []),
    { id: "events", title: "Receive your first tracking events", description: "This completes automatically once shoppers view a post with linked products.", done: everEventCount > 0 },
  ];
  console.info("Dashboard loader timing", { shop, articles: articles.length, aggregateRows: allEvents.length, durationMs: Date.now() - startedAt });

  return json({
    shop,
    shopifyError,
    generatedAt: now.toISOString(),
    currency,
    planKey,
    analyticsWindowDays: windowDays,
    metrics: currentMetrics,
    previousMetrics,
    counts: {
      totalPosts: articles.length,
      publishedPosts: publishedArticles.length,
      shoppablePublishedCount,
      missingMetaDescriptions,
      noLinkedProducts,
      highTrafficNoProducts,
      lowCtrPosts,
      averageSeoScore,
      activeProductLinks: linkedProducts.length,
      everEventCount,
    },
    setupSteps,
    issueSummary: summarizeIssues(scannedSeoRows.map((row) => row.issues)),
    modules: {
      config: {
        appStatus: moduleConfig?.appStatus ?? true,
        enableConversionTracking: moduleConfig?.enableConversionTracking ?? true,
        breadcrumbsEnabled: moduleConfig?.breadcrumbsEnabled ?? true,
        tocEnabled: moduleConfig?.tocEnabled ?? true,
        seoAutoScanEnabled: moduleConfig?.seoAutoScanEnabled ?? false,
      },
      limits: {
        canContentNavigation: limits.canContentNavigation,
        canAutoSeoScan: limits.canAutoSeoScan,
        canSearchConsole: limits.canSearchConsole,
        canCatalogSeo: limits.canCatalogSeo,
        canBulkReview: limits.canBulkReview,
        canInternalLinking: limits.canInternalLinking,
        canContentDecay: limits.canContentDecay,
        canContentBriefs: limits.canContentBriefs,
      },
      searchConnected: Boolean(searchConnection?.selectedSiteUrl),
      catalogScanned: catalogAverages.some((row) => row._count._all > 0),
      linkedProducts: linkedProducts.length,
      aiUsed: aiUsage.used,
      aiLimit: aiUsage.limit,
    },
    recentPosts: articles.slice(0, 5),
    homeTasks,
    storeScore,
    lastScanAt: lastScanAt?.toISOString() || null,
  });
};

function readReportArray<T>(report: unknown, key: string): T[] {
  if (!report || typeof report !== "object") return [];
  const value = (report as Record<string, unknown>)[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

export default function Dashboard() {
  const data = useLoaderData<any>();
  const setupFetcher = useFetcher<any>();
  const pixelFetcher = useFetcher<any>();
  const moduleFetcher = useFetcher<{ success?: boolean; module?: string; enabled?: boolean; error?: string }>();
  const [moduleOverrides, setModuleOverrides] = useState<Record<string, boolean>>({});
  const [showAllSteps, setShowAllSteps] = useState(false);
  const pixelAutoActivationAttempted = useRef(false);
  const pixelSuccessHandled = useRef(false);
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  useEffect(() => {
    if (data?.needsRevalidation && revalidator.state === "idle") {
      revalidator.revalidate();
    }
  }, [data, revalidator]);

  useEffect(() => {
    if (setupFetcher.state === "idle" && !setupFetcher.data) setupFetcher.load("/app/dashboard-status");
  }, [setupFetcher]);

  useEffect(() => {
    if (!pixelFetcher.data?.success || pixelSuccessHandled.current) return;
    pixelSuccessHandled.current = true;
    setupFetcher.load("/app/dashboard-status");
  }, [pixelFetcher.data, setupFetcher]);

  useEffect(() => {
    if (
      pixelAutoActivationAttempted.current
      || setupFetcher.state !== "idle"
      || !setupFetcher.data
      || setupFetcher.data.webPixelEnabled
      || setupFetcher.data.webPixelError
      || pixelFetcher.state !== "idle"
    ) return;
    pixelAutoActivationAttempted.current = true;
    pixelFetcher.submit({ intent: "activate_pixel" }, { method: "post", action: "/app/dashboard-status" });
  }, [pixelFetcher, setupFetcher.data, setupFetcher.state]);

  if (data?.needsRevalidation) {
    return (
      <AppPage title="Loading">
        <Layout>
          <Layout.Section>
            <s-section>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text as="p" variant="bodyMd">Loading your dashboard...</Text>
              </BlockStack>
            </s-section>
          </Layout.Section>
        </Layout>
      </AppPage>
    );
  }

  const {
    shopifyError,
    planKey,
    analyticsWindowDays,
    metrics,
    previousMetrics,
    counts,
    setupSteps: initialSteps,
    modules: moduleState,
    homeTasks,
    storeScore,
    currency,
  } = data as typeof data & { homeTasks: HomeTask[]; storeScore: StoreSeoScore };
  const setupSteps = buildSetupSteps(initialSteps, setupFetcher.data, pixelFetcher, navigate);
  const toggleModule = (id: string, enabled: boolean) => {
    setModuleOverrides((current) => ({ ...current, [id]: enabled }));
    moduleFetcher.submit({ module: id, enabled: String(enabled) }, { method: "post", action: "/app/modules" });
  };
  const modules = buildModules(moduleState, moduleOverrides, setupFetcher.data, moduleFetcher.state !== "idle" ? String(moduleFetcher.formData?.get("module") || "") : "", toggleModule);

  const productCtr = getCtr(metrics.clicks, metrics.impressions);
  const issueSummary = (data.issueSummary || { failed: 0, warnings: 0, quickWins: 0, scanned: 0 }) as IssueSummary;
  const nextStep = setupSteps.find((step) => !step.done);
  const doneSteps = setupSteps.filter((step) => step.done).length;
  const verdict = storeScore.score === null ? "Run a scan to get your score" : storeScore.score >= 80 ? "Great, keep it up" : storeScore.score >= 50 ? "Good, room to grow" : "Needs work";

  return (
    <AppPage
      title="Dashboard"
      subtitle="How your store is doing in search, and what to fix next."
      fullWidth
      primaryAction={{ content: "Create post", onAction: () => navigate("/app/blogs/new") }}
      secondaryActions={[{ content: "Open SEO Analyzer", onAction: () => navigate("/app/seo") }]}
    >
      <BlockStack gap="400">
        {shopifyError && (
          <Banner tone="warning" title="Shopify blog posts could not be loaded">
            <p>{shopifyError} The dashboard below only shows data already stored by the app.</p>
          </Banner>
        )}
        {moduleFetcher.data?.error && <Banner tone="critical"><p>{moduleFetcher.data.error}</p></Banner>}

        <InlineGrid columns={{ xs: 1, md: 2, lg: 3 }} gap="400">
          <s-section>
            <InlineStack gap="500" blockAlign="center" wrap={false}>
              <ScoreRing score={storeScore.score} size={124} caption="out of 100" label={storeScore.score === null ? "Store not scanned yet" : `Store SEO score ${storeScore.score} out of 100`} />
              <BlockStack gap="200">
                <span className="rm-eyebrow">Store SEO score</span>
                <Text as="p" variant="headingMd">{verdict}</Text>
                <BlockStack gap="100">
                  {storeScore.parts.map((part: StoreSeoScore["parts"][number]) => (
                    <InlineStack key={part.label} align="space-between" gap="600" wrap={false}>
                      <Text as="span" variant="bodySm">{part.label}</Text>
                      <Text as="span" variant="bodySm" fontWeight={part.score === null ? "regular" : "semibold"} tone={part.score === null ? "subdued" : undefined}>{part.score === null ? "Not scanned" : String(part.score)}</Text>
                    </InlineStack>
                  ))}
                </BlockStack>
                {storeScore.score === null && <Button size="slim" onClick={() => navigate("/app/seo")}>Run SEO scan</Button>}
              </BlockStack>
            </InlineStack>
          </s-section>

          <s-section>
            <div className="rm-tiles rm-tiles--2">
              <StatTile tone="bad" label="Failed checks" value={issueSummary.failed} />
              <StatTile tone="warn" label="Warnings" value={issueSummary.warnings} />
              <StatTile tone="good" label="Quick wins" value={issueSummary.quickWins} />
              <StatTile tone="brand" label="Posts scanned" value={<>{issueSummary.scanned} <Text as="span" variant="bodySm">of {formatNumber(counts.totalPosts)}</Text></>} />
            </div>
          </s-section>

          {nextStep ? (
            <div className="rm-callout rm-callout--dark">
              <BlockStack gap="300">
                <BlockStack gap="150">
                  <Text as="p" variant="bodySm" fontWeight="semibold"><span style={{ color: "#b9bbff" }}>{`Setup · ${doneSteps} of ${setupSteps.length} done`}</span></Text>
                  <Text as="h2" variant="headingMd">{nextStep.title}</Text>
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{nextStep.description}</p>
                </BlockStack>
                <Bar value={(doneSteps / Math.max(1, setupSteps.length)) * 100} />
                <InlineStack gap="200">
                  {nextStep.action && !nextStep.checking && (
                    <button type="button" className="rm-light-button" onClick={nextStep.action.onAction} disabled={nextStep.action.loading}>{nextStep.action.loading ? "Working…" : nextStep.action.content}</button>
                  )}
                  <button type="button" className="rm-ghost-button" onClick={() => setShowAllSteps((value) => !value)}>{showAllSteps ? "Hide steps" : "All steps"}</button>
                </InlineStack>
              </BlockStack>
            </div>
          ) : (
            <s-section>
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center"><IconTile icon={CheckIcon} tone="good" /><Text as="h2" variant="headingMd">Setup complete</Text></InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">The app is installed on your theme, tracking is connected and your store has been scanned.</Text>
              </BlockStack>
            </s-section>
          )}
        </InlineGrid>

        {showAllSteps && nextStep && <SetupGuide steps={setupSteps} />}

        <InlineGrid columns={{ xs: 1, lg: "2fr 1fr" }} gap="400">
          <s-section padding="none">
            <Box padding="400">
              <InlineStack align="space-between" blockAlign="center" gap="300">
                <BlockStack gap="050">
                  <Text as="h2" variant="headingMd">Next best actions</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Ranked by impact on traffic and revenue</Text>
                </BlockStack>
                <Button variant="plain" onClick={() => navigate("/app/seo")}>Open SEO Analyzer</Button>
              </InlineStack>
            </Box>
            <Divider />
            {homeTasks.length ? (
              <ActionRows>
                {homeTasks.map((task: HomeTask) => (
                  <ActionRow
                    key={task.id}
                    icon={TASK_ICONS[task.area] || SearchIcon}
                    iconTone={task.impact === "High" ? "bad" : task.impact === "Medium" ? "warn" : "brand"}
                    title={task.title}
                    text={task.detail}
                    aside={
                      <>
                        <Pill tone={impactTone(task.impact)}>{task.impact}</Pill>
                        {task.locked
                          ? <Button size="slim" icon={LockIcon} onClick={() => navigate(`/app/pricing?reason=home_task&plan=${planKey}`)}>Upgrade</Button>
                          : <Button size="slim" onClick={() => navigate(task.url)}>{task.actionLabel}</Button>}
                      </>
                    }
                  />
                ))}
              </ActionRows>
            ) : (
              <Box padding="400">
                <InlineStack gap="200" blockAlign="center"><IconTile icon={CheckIcon} tone="good" size="sm" /><Text as="p">Nothing urgent. Your store is in good shape.</Text></InlineStack>
              </Box>
            )}
          </s-section>

          <s-section>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Revenue from content</Text>
                <Pill>{`Last ${analyticsWindowDays} days`}</Pill>
              </InlineStack>
              <Text as="p" variant="heading2xl">{formatCurrency(metrics.revenue, currency)}</Text>
              <div className="rm-tiles rm-tiles--2">
                <StatTile label="Product views" value={formatNumber(metrics.impressions)} hint={formatTrend(metrics.impressions, previousMetrics.impressions)} />
                <StatTile label="Product clicks" value={formatNumber(metrics.clicks)} hint={`${formatPercent(productCtr)} CTR`} />
                <StatTile label="Add to carts" value={formatNumber(metrics.addToCarts)} hint={formatTrend(metrics.addToCarts, previousMetrics.addToCarts)} />
                <StatTile label="Orders" value={formatNumber(metrics.purchases)} hint={formatTrend(metrics.purchases, previousMetrics.purchases)} />
              </div>
              {!counts.everEventCount && <Text as="p" variant="bodySm" tone="subdued">Numbers appear once shoppers read a post with linked products.</Text>}
              <InlineStack><Button variant="plain" onClick={() => navigate("/app/analytics")}>Open Analytics</Button></InlineStack>
            </BlockStack>
          </s-section>
        </InlineGrid>

        <s-section>
          <BlockStack gap="300">
            <BlockStack gap="050">
              <Text as="h2" variant="headingMd">Modules</Text>
              <Text as="p" variant="bodySm" tone="subdued">Turn features on or off. Locked modules show the plan they need.</Text>
            </BlockStack>
            <ModuleGrid modules={modules} planKey={planKey} />
          </BlockStack>
        </s-section>
      </BlockStack>
    </AppPage>
  );
}

type IssueSummary = { failed: number; warnings: number; quickWins: number; scanned: number };

const TASK_ICONS: Record<string, any> = {
  "SEO Analyzer": SearchIcon,
  Posts: NoteIcon,
  "Products & collections": ProductIcon,
  Analytics: ChartVerticalIcon,
  Setup: SettingsIcon,
};

/** Failed checks (high impact), warnings (other check types) and quick wins (low-effort fixes) across scanned posts. */
function summarizeIssues(values: Array<string | null>): IssueSummary {
  const types = new Map<string, { impact: string; effort: string; count: number }>();
  for (const value of values) {
    let issues: any[] = [];
    try { issues = JSON.parse(value || "[]"); } catch { issues = []; }
    if (!Array.isArray(issues)) continue;
    for (const issue of issues) {
      if (!issue || typeof issue.type !== "string") continue;
      const impact = issue.impact || (issue.severity === "critical" ? "High" : issue.severity === "warning" ? "Medium" : "Low");
      const entry = types.get(issue.type) || { impact, effort: issue.effort || "Low", count: 0 };
      entry.count += 1;
      types.set(issue.type, entry);
    }
  }
  const all = [...types.values()];
  return {
    failed: all.filter((entry) => entry.impact === "High").length,
    warnings: all.filter((entry) => entry.impact !== "High").length,
    quickWins: all.filter((entry) => entry.effort === "Low").reduce((sum, entry) => sum + entry.count, 0),
    scanned: values.length,
  };
}








type LoaderSetupStep = Omit<SetupStep, "action"> & { actionUrl?: string; actionLabel?: string };

/** Loader steps + the deferred theme/pixel checks + actions. */
function buildSetupSteps(steps: LoaderSetupStep[], status: any, pixelFetcher: any, navigate: (url: string) => void): SetupStep[] {
  return steps.map((step) => {
    let next: SetupStep = { ...step };
    if (step.id === "embed" && status) {
      next = { ...next, checking: false, done: Boolean(status.appEmbedEnabled), error: status.appEmbedError || undefined };
    }
    if (step.id === "pixel" && status) {
      next = { ...next, checking: false, done: Boolean(status.webPixelEnabled), error: pixelFetcher.data?.error || status.webPixelError || undefined };
    }
    if (step.id === "pixel") {
      next.action = { content: next.error ? "Retry" : step.actionLabel || "Connect", loading: pixelFetcher.state !== "idle", onAction: () => pixelFetcher.submit({ intent: "activate_pixel" }, { method: "post", action: "/app/dashboard-status" }) };
    } else if (step.actionUrl) {
      const url = step.actionUrl;
      next.action = { content: step.actionLabel || "Open", onAction: () => navigate(url) };
    }
    return next;
  });
}

type ModuleState = {
  config: { appStatus: boolean; enableConversionTracking: boolean; breadcrumbsEnabled: boolean; tocEnabled: boolean; seoAutoScanEnabled: boolean };
  limits: Record<"canContentNavigation" | "canAutoSeoScan" | "canSearchConsole" | "canCatalogSeo" | "canBulkReview" | "canInternalLinking" | "canContentDecay" | "canContentBriefs", boolean>;
  searchConnected: boolean;
  catalogScanned: boolean;
  linkedProducts: number;
  aiUsed: number;
  aiLimit: number | null;
};

/** Dashboard › Modules, in the order merchants usually set them up. */
function buildModules(state: ModuleState, overrides: Record<string, boolean>, themeStatus: any, pendingId: string, onToggle: (id: string, enabled: boolean) => void): AppModule[] {
  const { config, limits } = state;
  const value = (id: string, fallback: boolean) => (id in overrides ? overrides[id] : fallback);
  const toggleable = (id: string, enabled: boolean) => ({ checked: enabled, pending: pendingId === id, onChange: (checked: boolean) => onToggle(id, checked) });
  const onOff = (enabled: boolean): ModuleStatus => (enabled ? "active" : "off");
  const gated = (allowed: boolean, status: ModuleStatus): ModuleStatus => (allowed ? status : "locked");
  const tracking = value("tracking", config.enableConversionTracking);
  const breadcrumbs = value("breadcrumbs", config.breadcrumbsEnabled);
  const toc = value("toc", config.tocEnabled);
  const autoScan = value("auto-scan", config.seoAutoScanEnabled);
  // undefined while the theme check runs; null when the theme could not be read.
  const schemaInstalled: boolean | null | undefined = themeStatus ? (themeStatus.themeBlocks ? Boolean(themeStatus.themeBlocks.seoSchema) : null) : undefined;

  return [
    { id: "shoppable", icon: CartIcon, tone: "brand", title: "Shoppable products", description: "Show the products you link inside blog posts as a carousel or grid.", status: !config.appStatus ? "off" : state.linkedProducts ? "active" : "setup", detail: state.linkedProducts ? `${state.linkedProducts} product links` : undefined, url: "/app/settings?tab=display" },
    { id: "tracking", icon: ChartVerticalIcon, tone: "good", title: "Conversion tracking", description: "Credit clicks, add-to-carts and orders to the post that sent the shopper.", status: onOff(tracking), url: "/app/settings?tab=tracking", toggle: toggleable("tracking", tracking) },
    { id: "schema", icon: CodeIcon, tone: "warn", title: "SEO schema (JSON-LD)", description: "BlogPosting and breadcrumb structured data for rich results.", status: schemaInstalled === undefined ? "checking" : schemaInstalled ? "active" : "setup", detail: schemaInstalled === false ? "Add the SEO Schema block to your blog post template." : schemaInstalled === null ? "Could not read your theme." : undefined, url: "/app/theme-setup" },
    { id: "breadcrumbs", icon: ListBulletedIcon, tone: "good", title: "Breadcrumbs", description: "Home › Blog › Post navigation with breadcrumb schema.", status: gated(limits.canContentNavigation, onOff(breadcrumbs)), requiredPlan: "Pro", url: "/app/settings?tab=content-navigation", toggle: toggleable("breadcrumbs", breadcrumbs) },
    { id: "toc", icon: ListBulletedIcon, tone: "good", title: "Table of contents", description: "Automatic, clickable table of contents built from your headings.", status: gated(limits.canContentNavigation, onOff(toc)), requiredPlan: "Pro", url: "/app/settings?tab=content-navigation", toggle: toggleable("toc", toc) },
    { id: "auto-scan", icon: ClockIcon, tone: "brand", title: "Scheduled SEO scans", description: "Rescan posts, products and collections every week.", status: gated(limits.canAutoSeoScan, onOff(autoScan)), requiredPlan: "Pro", url: "/app/seo", toggle: toggleable("auto-scan", autoScan) },
    { id: "catalog", icon: ProductIcon, tone: "brand", title: "Product & collection SEO", description: "Scores, search listings, descriptions and image alt text for your catalog.", status: gated(limits.canCatalogSeo, state.catalogScanned ? "active" : "setup"), requiredPlan: "Plus", url: "/app/catalog-seo?view=manager&type=product" },
    { id: "search-console", icon: SearchIcon, tone: "brand", title: "Google Search Console", description: "Queries, clicks and rankings for every post.", status: gated(limits.canSearchConsole, state.searchConnected ? "active" : "setup"), requiredPlan: "Pro", url: "/app/settings?tab=integrations" },
    { id: "internal-links", icon: LinkIcon, tone: "good", title: "Internal links", description: "Find orphan posts and add relevant links between articles.", status: gated(limits.canInternalLinking, "active"), requiredPlan: "Pro", url: "/app/internal-links" },
    { id: "briefs", icon: NoteIcon, tone: "brand", title: "AI content briefs", description: "Keyword clusters and outlines before you write.", status: gated(limits.canContentBriefs, "active"), requiredPlan: "Pro", url: "/app/content-briefs" },
    { id: "image-seo", icon: ImageIcon, tone: "warn", title: "Image SEO", description: "Write alt text for featured and inline images in bulk.", status: gated(limits.canBulkReview, "active"), requiredPlan: "Growth", url: "/app/image-seo" },
    { id: "decay", icon: RefreshIcon, tone: "warn", title: "Content decay", description: "Spot posts that are losing clicks and refresh them.", status: gated(limits.canContentDecay, "active"), requiredPlan: "Growth", url: "/app/content-decay" },
    { id: "speed", icon: GaugeIcon, tone: "good", title: "Site speed", description: "PageSpeed scores for your storefront's key pages.", status: "active", url: "/app/performance" },
    { id: "ai", icon: MagicIcon, tone: "brand", title: "AI writing", description: "Drafts, rewrites, SEO fixes and alt text that follow your rules.", status: "active", detail: state.aiLimit === null ? `${state.aiUsed} generations this month` : `${state.aiUsed} of ${state.aiLimit} generations used this month`, url: "/app/settings?tab=rules" },
  ];
}

function toPeriod(metrics: Metrics): PeriodMetrics {
  return { impressions: metrics.impressions, clicks: metrics.clicks, addToCarts: metrics.addToCarts, purchases: metrics.purchases, revenue: metrics.revenue };
}

function emptyMetrics(): PeriodMetrics {
  return toPeriod(emptyCoreMetrics());
}



function getAverageSeoScore(articles: DashboardArticle[]) {
  const scores = articles
    .map((article) => article.seoScore)
    .filter((score): score is number => typeof score === "number");

  if (!scores.length) return null;

  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function getCtr(clicks: number, impressions: number) {
  return impressions > 0 ? (clicks / impressions) * 100 : 0;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}


function formatPercent(value: number) {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function formatTrend(current: number, previous: number, unit: "%" | "pp" = "%") {
  if (previous === 0 && current === 0) return "0%";
  if (previous === 0) return unit === "pp" ? `+${current.toFixed(1)} pp` : "+100%";

  const delta = unit === "pp" ? current - previous : ((current - previous) / previous) * 100;
  const sign = delta > 0 ? "+" : "";

  return unit === "pp" ? `${sign}${delta.toFixed(1)} pp` : `${sign}${delta.toFixed(0)}%`;
}



function getTimeValue(value: string | null) {
  return value ? new Date(value).getTime() : 0;
}


export function links() {
  return [
    {
      rel: "stylesheet",
      href: "data:text/css," + encodeURIComponent(`
        .bp-overview-action {
          width: 100%;
          border: 0;
          background: transparent;
          text-align: left;
          padding: 8px;
          border-radius: 8px;
          cursor: pointer;
        }
        .bp-overview-action:hover {
          background: var(--p-color-bg-surface-secondary);
        }
        .bp-overview-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          width: 100%;
        }
        .bp-overview-chevron {
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-left: auto;
        }
      `),
    },
  ];
}
