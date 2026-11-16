import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate, useRevalidator } from "@remix-run/react";
import { useEffect, useRef } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  EmptyState,
  Icon,
  IndexTable,
  InlineGrid,
  InlineStack,
  Page,
  ProgressBar,
  Spinner,
  Text,
  Layout,
} from "@shopify/polaris";
import {
  AlertCircleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CashDollarIcon,
  ChartVerticalFilledIcon,
  CheckIcon,
  EditIcon,
  ImageIcon,
  MagicIcon,
  NoteIcon,
  LockIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import prisma from "../db.server";
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

type DashboardProduct = PeriodMetrics & {
  id: string;
  title: string;
  image: string;
  price: number;
};

type ChartPoint = PeriodMetrics & {
  date: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const PLACEHOLDER_IMAGE = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const startedAt = Date.now();
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;

  // Resolve plan limits to determine the analytics window
  const { planKey, limits } = await getActivePlanAndLimits(billing, shop);
  const windowDays = limits.analyticsWindowDays; // e.g. 7, 30, or 90

  const now = new Date();
  const currentStart = startOfDay(new Date(now.getTime() - (windowDays - 1) * DAY_MS));
  const previousStart = startOfDay(new Date(now.getTime() - (windowDays * 2 - 1) * DAY_MS));

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
      select: { articleId: true, articleTitle: true, seoScore: true, metaDescription: true, metaTitle: true, articleHandle: true, imageUrl: true, imageAlt: true, blogTitle: true, blogHandle: true, sourceUpdatedAt: true, publishedAt: true, lastAnalyzedAt: true },
    }),
    prisma.$queryRaw<Array<{ articleId: string; productId: string; eventType: string; createdAt: Date; count: number }>>`
      SELECT "articleId", "productId", "eventType", date_trunc('day', "createdAt") AS "createdAt", COUNT(*)::int AS "count"
      FROM "WidgetEvent"
      WHERE "shop" = ${shop} AND "createdAt" >= ${previousStart}
      GROUP BY "articleId", "productId", "eventType", date_trunc('day', "createdAt")
      ORDER BY "createdAt" ASC
    `,
    prisma.widgetEvent.count({ where: { shop } }),
  ]);

  baseArticles = seoRows.map((row) => ({ id: row.articleId, title: row.articleTitle || "Untitled post", handle: row.articleHandle,
    image: row.imageUrl, imageAlt: row.imageAlt, publishedAt: row.publishedAt?.toISOString() || null,
    updatedAt: row.sourceUpdatedAt?.toISOString() || null, seoTitle: row.metaTitle || "", seoDescription: row.metaDescription || "",
    blogId: "", blogTitle: row.blogTitle || "Blog", blogHandle: row.blogHandle }));

  // Slow theme and pixel checks are loaded after the dashboard renders.
  const appEmbedEnabled = false;
  const appEmbedError = "Checking…";
  const webPixelEnabled = false;
  const webPixelError = "Checking…";

  const productCountMap = new Map<string, number>();
  const productPriceMap = new Map<string, number>();
  const productInfoMap = new Map<string, { title: string; image: string; price: number }>();

  linkedProducts.forEach((product) => {
    const price = parseMoney(product.productPrice);
    productCountMap.set(product.articleId, (productCountMap.get(product.articleId) || 0) + 1);
    productPriceMap.set(`${product.articleId}:${product.productId}`, price);

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
  const currentEvents = allEvents.filter((event) => event.createdAt >= currentStart);
  const previousEvents = allEvents.filter((event) => event.createdAt < currentStart);
  const currentMetrics = getMetrics(currentEvents, productPriceMap);
  const previousMetrics = getMetrics(previousEvents, productPriceMap);
  const chartData = buildChartData(currentEvents, productPriceMap, currentStart, now);
  const productRows = buildDashboardProductRows(currentEvents, productPriceMap, productInfoMap);
  const topAddToCartProducts = sortDashboardProductRows(productRows, "addToCarts").slice(0, 4);
  const topPurchasedProducts = sortDashboardProductRows(productRows, "purchases").slice(0, 4);
  const articleMetricsMap = getArticleMetricsMap(currentEvents, productPriceMap);
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
  const [catalogAverages, catalogIssueCounts, speedScans, decayAnalysis, linkAnalysis, searchConnection] = await Promise.all([
    prisma.resourceSEO.groupBy({ by: ["resourceType"], where: { shop, lastAnalyzedAt: { not: null } }, _avg: { seoScore: true }, _count: { _all: true } }),
    prisma.resourceSEO.groupBy({ by: ["resourceType"], where: { shop, issueCount: { gt: 0 } }, _count: { _all: true } }),
    prisma.storefrontPerformanceScan.findMany({ where: { shop, status: "completed", scannedAt: { not: null } }, select: { mobileScore: true } }),
    prisma.contentDecayAnalysis.findUnique({ where: { shop }, select: { report: true } }),
    prisma.internalLinkAnalysis.findUnique({ where: { shop }, select: { report: true } }),
    prisma.searchConsoleConnection.findUnique({ where: { shop }, select: { selectedSiteUrl: true } }),
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

  type SetupItem = {
    label: string;
    done: boolean;
    actionUrl?: string;
    actionLabel?: string;
    actionError?: string;
  };

  const setupItems: SetupItem[] = [
    { label: "Blog connected", done: baseArticles.length > 0 },
    { 
      label: "App enabled in theme", 
      done: appEmbedEnabled,
      actionUrl: "/app/theme-setup",
      actionLabel: appEmbedError === "Checking…" ? "Checking…" : "View setup guide",
      actionError: appEmbedError && appEmbedError !== "Checking…" ? appEmbedError : undefined,
    },
    {
      label: "Conversion tracking (Web Pixel) active",
      done: webPixelEnabled,
      actionLabel: webPixelError === "Checking…" ? "Checking…" : "Activate",
      actionError: webPixelError && webPixelError !== "Checking…" ? webPixelError : undefined,
    },
    { label: "First SEO scan completed", done: Boolean(lastScanAt), actionUrl: "/app/seo", actionLabel: "Run scan" },
    ...(limits.canSearchConsole
      ? [{ label: "Google Search Console connected", done: Boolean(searchConnection?.selectedSiteUrl), actionUrl: "/app/settings?tab=integrations", actionLabel: "Connect" }]
      : []),
    { label: "Products linked to posts", done: linkedProducts.length > 0, actionUrl: "/app/blogs", actionLabel: "Link products" },
    { label: "Tracking events received", done: everEventCount > 0 },
    { label: "First shoppable post published", done: shoppablePublishedCount > 0 },
  ];
  const setupDone = setupItems.filter((item) => item.done).length;
  console.info("Dashboard loader timing", { shop, articles: articles.length, events: allEvents.length, durationMs: Date.now() - startedAt });

  return json({
    shop,
    shopifyError,
    generatedAt: now.toISOString(),
    planKey,
    analyticsWindowDays: windowDays,
    metrics: currentMetrics,
    previousMetrics,
    chartData,
    topAddToCartProducts,
    topPurchasedProducts,
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
    setup: {
      items: setupItems,
      done: setupDone,
      total: setupItems.length,
      progress: Math.round((setupDone / setupItems.length) * 100),
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
      <Page>
        <Layout>
          <Layout.Section>
            <Card padding="400">
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text as="p" variant="bodyMd">Loading your dashboard...</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const {
    shopifyError,
    planKey,
    analyticsWindowDays,
    metrics,
    previousMetrics,
    chartData,
    topAddToCartProducts,
    topPurchasedProducts,
    counts,
    setup: initialSetup,
    recentPosts,
    homeTasks,
    storeScore,
    lastScanAt,
  } = data as typeof data & { homeTasks: HomeTask[]; storeScore: StoreSeoScore; lastScanAt: string | null };
  const setup = mergeSetupStatus(initialSetup, setupFetcher.data, pixelFetcher.data?.error);

  const productCtr = getCtr(metrics.clicks, metrics.impressions);

  return (
    <Page fullWidth>
      <TitleBar title="Home" />
      <BlockStack gap="600">
        <InlineStack align="space-between" blockAlign="end">
          <BlockStack gap="100">
            <Text as="h1" variant="headingLg" fontWeight="bold">
              Home
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Your store&apos;s SEO health and the most valuable fixes to make next.
            </Text>
          </BlockStack>
          <InlineStack gap="200">
            <Button onClick={() => navigate("/app/seo")}>SEO Audit</Button>
            <Button variant="primary" onClick={() => navigate("/app/blogs/new")}>
              Create post
            </Button>
          </InlineStack>
        </InlineStack>

        {shopifyError && (
          <Banner tone="warning" title="Shopify blog posts could not be loaded">
            <p>{shopifyError} The dashboard below will only show data already stored by the app.</p>
          </Banner>
        )}

        <InlineGrid columns={{ xs: 1, md: "1fr 2fr" }} gap="400">
          <BlockStack gap="400">
          <StoreScoreCard storeScore={storeScore} lastScanAt={lastScanAt} onScan={() => navigate("/app/seo")} />
          {setup.progress < 100 && (
          <Card padding="400">
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd" fontWeight="bold">
                  Setup checklist
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  {setup.done} of {setup.total} completed
                </Text>
              </InlineStack>
              <ProgressBar progress={setup.progress} tone={setup.progress === 100 ? "success" : "primary"} size="small" />
              <BlockStack gap="300">
                {setup.items.map((item: any) => (
                  <ProgressItem
                    key={item.label} label={item.label} done={item.done} actionUrl={item.actionUrl} actionLabel={item.actionLabel} actionError={item.actionError}
                    loading={item.label === "Conversion tracking (Web Pixel) active" && pixelFetcher.state !== "idle"}
                    onAction={item.label === "Conversion tracking (Web Pixel) active"
                      ? () => pixelFetcher.submit({ intent: "activate_pixel" }, { method: "post", action: "/app/dashboard-status" })
                      : undefined}
                  />
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
          )}
          </BlockStack>

          <HomeTaskList tasks={homeTasks} planKey={planKey} onNavigate={(url) => navigate(url)} />
        </InlineGrid>

        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          <MetricCard
            title="Published shoppable posts"
            value={formatNumber(counts.shoppablePublishedCount)}
            detail={`${formatNumber(counts.publishedPosts)} published total`}
            iconTone="success"
            icon={NoteIcon}
          />
          <MetricCard
            title="Average SEO score"
            value={counts.averageSeoScore === null ? "Not scanned" : `${counts.averageSeoScore}/100`}
            detail={`${formatNumber(counts.totalPosts)} posts in Shopify`}
            iconTone="info"
            icon={ChartVerticalFilledIcon}
          />
          <MetricCard
            title="Product clicks"
            value={formatNumber(metrics.clicks)}
            detail={formatTrend(metrics.clicks, previousMetrics.clicks)}
            iconTone="magic"
            icon={MagicIcon}
          />
          <MetricCard
            title="Estimated revenue"
            value={formatMoney(metrics.revenue)}
            detail="Purchase events x linked product price"
            iconTone="success"
            icon={CashDollarIcon}
          />
        </InlineGrid>

        <Card padding="400">
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd" fontWeight="bold">
                  Product engagement
                </Text>
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="info">{`Last ${analyticsWindowDays} days`}</Badge>
                  {planKey === "free" && (
                    <Badge tone="attention">Free plan</Badge>
                  )}
                </InlineStack>
              </InlineStack>

              <Box>
                <InlineGrid columns={{ xs: 2, sm: 5 }} gap="200">
                  <PerformanceStat label="Impressions" value={formatNumber(metrics.impressions)} trend={formatTrend(metrics.impressions, previousMetrics.impressions)} color="#2C6ECB" />
                  <PerformanceStat label="Clicks" value={formatNumber(metrics.clicks)} trend={formatTrend(metrics.clicks, previousMetrics.clicks)} color="#8F72F6" />
                  <PerformanceStat label="Product CTR" value={formatPercent(productCtr)} trend={formatTrend(productCtr, getCtr(previousMetrics.clicks, previousMetrics.impressions), "pp")} color="#6B46C1" />
                  <PerformanceStat label="Add to carts" value={formatNumber(metrics.addToCarts)} trend={formatTrend(metrics.addToCarts, previousMetrics.addToCarts)} color="#00A0AC" />
                  <PerformanceStat label="Purchases" value={formatNumber(metrics.purchases)} trend={formatTrend(metrics.purchases, previousMetrics.purchases)} color="#50B83C" />
                </InlineGrid>
              </Box>

              <Box minHeight="250px">
                {chartData.some((point: any) => point.impressions || point.clicks || point.addToCarts || point.purchases) ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={chartData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" stroke="#8c9196" fontSize={12} tickMargin={10} />
                      <YAxis stroke="#8c9196" fontSize={12} tickFormatter={(value) => formatCompactNumber(Number(value))} />
                      <RechartsTooltip />
                      <Legend verticalAlign="bottom" height={42} iconType="plainline" wrapperStyle={{ paddingTop: "6px" }} />
                      <Line type="monotone" dataKey="impressions" name="Impressions" stroke="#2C6ECB" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="clicks" name="Clicks" stroke="#8F72F6" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="addToCarts" name="Add to carts" stroke="#00A0AC" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="purchases" name="Purchases" stroke="#50B83C" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState
                    heading="No tracking events yet"
                    image={PLACEHOLDER_IMAGE}
                    action={{ content: "Check tracking settings", onAction: () => navigate("/app/settings") }}
                  >
                    <p>Events will appear after storefront visitors view or click linked products in blog posts.</p>
                  </EmptyState>
                )}
              </Box>

              <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
                <CompactProductLeaderboard
                  title="Top add to cart products"
                  products={topAddToCartProducts}
                  metricKey="addToCarts"
                  metricLabel="add to carts"
                />
                <CompactProductLeaderboard
                  title="Top purchased products"
                  products={topPurchasedProducts}
                  metricKey="purchases"
                  metricLabel="purchases"
                />
              </InlineGrid>
            </BlockStack>
          </Card>

        <Card padding="0">
          <Box padding="400" paddingBlockEnd="200">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd" fontWeight="bold">
                Recent posts
              </Text>
              <Button variant="plain" onClick={() => navigate("/app/blogs")}>
                View all posts
              </Button>
            </InlineStack>
          </Box>
          {recentPosts.length ? (
            <IndexTable
              resourceName={{ singular: "post", plural: "posts" }}
              itemCount={recentPosts.length}
              headings={[
                { title: "Post" },
                { title: "Status" },
                { title: "SEO score" },
                { title: "Products linked" },
                { title: "Clicks" },
                { title: "Estimated revenue" },
                { title: "Updated" },
                { title: "Actions", alignment: "end" },
              ]}
              selectable={false}
            >
              {recentPosts.map((post: any, index: number) => (
                <IndexTable.Row id={post.id} key={post.id} position={index}>
                  <IndexTable.Cell>
                    <InlineStack gap="300" blockAlign="center" wrap={false}>
                      <DashboardThumbnail source={post.image} alt={post.imageAlt || post.title} />
                      <BlockStack gap="050">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {post.title}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {post.blogTitle}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={post.publishedAt ? "success" : "info"}>{post.publishedAt ? "Published" : "Draft"}</Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {post.seoScore === null ? (
                      <Text as="span" variant="bodyMd" tone="subdued">
                        Not scanned
                      </Text>
                    ) : (
                      <Text as="span" variant="bodyMd" fontWeight="semibold" tone={getScoreTone(post.seoScore)}>
                        {post.seoScore}
                      </Text>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {post.productCount}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{formatNumber(post.clicks)}</IndexTable.Cell>
                  <IndexTable.Cell>{formatMoney(post.revenue)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd" tone="subdued">
                      {formatDate(post.updatedAt || post.publishedAt)}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <Button size="micro" icon={EditIcon} onClick={() => navigate(`/app/blogs/${encodeURIComponent(post.id)}`)}>
                        Edit
                      </Button>
                    </div>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          ) : (
            <Box padding="600">
              <EmptyState
                heading="No blog posts found"
                image={PLACEHOLDER_IMAGE}
                action={{ content: "Create post", onAction: () => navigate("/app/blogs/new") }}
              >
                <p>Create your first shoppable blog post to start building product discovery from content.</p>
              </EmptyState>
            </Box>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}

function ProgressItem({ label, done, actionUrl, actionLabel, actionError, onAction, loading }: { label: string; done: boolean; actionUrl?: string; actionLabel?: string; actionError?: string; onAction?: () => void; loading?: boolean }) {
  return (
    <InlineStack align="space-between" blockAlign="center">
      <InlineStack gap="200" blockAlign="center">
        <Icon source={done ? CheckIcon : AlertCircleIcon} tone={done ? "success" : "subdued"} />
        <Text as="span" variant="bodyMd" tone={done ? "base" : "subdued"}>
          {label}
        </Text>
      </InlineStack>
      {done ? (
        <Badge tone="success">Done</Badge>
      ) : actionLabel === "Checking…" ? (
        <Badge tone="info">Checking…</Badge>
      ) : actionUrl || onAction ? (
        <InlineStack gap="200" blockAlign="center">
          {actionError ? <Badge tone="critical">{`Error: ${actionError}`}</Badge> : null}
          <Button size="micro" url={actionUrl} onClick={onAction} loading={loading}>{actionError ? "Retry" : actionLabel || "Enable"}</Button>
        </InlineStack>
      ) : (
        <Badge tone="new">Pending</Badge>
      )}
    </InlineStack>
  );
}

function StoreScoreCard({ storeScore, lastScanAt, onScan }: { storeScore: StoreSeoScore; lastScanAt: string | null; onScan: () => void }) {
  const tone = storeScore.score === null ? "subdued" : getScoreTone(storeScore.score);
  return (
    <Card padding="400">
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd" fontWeight="bold">Store SEO health</Text>
          <Text as="span" variant="bodySm" tone="subdued">{lastScanAt ? `Scanned ${formatDate(lastScanAt)}` : "Not scanned"}</Text>
        </InlineStack>
        {storeScore.score === null ? (
          <BlockStack gap="300">
            <Text as="p" tone="subdued">Run one scan to score your blog posts, products and collections.</Text>
            <InlineStack><Button variant="primary" onClick={onScan}>Run SEO scan</Button></InlineStack>
          </BlockStack>
        ) : (
          <>
            <InlineStack gap="200" blockAlign="end">
              <Text as="p" variant="heading3xl" fontWeight="bold" tone={tone}>{storeScore.score}</Text>
              <Text as="span" variant="bodyMd" tone="subdued">/ 100</Text>
            </InlineStack>
            <ProgressBar progress={storeScore.score} size="small" tone={storeScore.score >= 80 ? "success" : storeScore.score >= 50 ? "highlight" : "critical"} />
            <BlockStack gap="200">
              {storeScore.parts.map((part) => (
                <InlineStack key={part.label} align="space-between" blockAlign="center">
                  <Text as="span" variant="bodySm">{part.label}</Text>
                  {part.score === null ? (
                    <Text as="span" variant="bodySm" tone="subdued">Not scanned</Text>
                  ) : (
                    <Text as="span" variant="bodySm" fontWeight="semibold" tone={getScoreTone(part.score)}>
                      {part.score}{part.label === "Site speed" ? "" : ` · ${formatNumber(part.count)}`}
                    </Text>
                  )}
                </InlineStack>
              ))}
            </BlockStack>
          </>
        )}
      </BlockStack>
    </Card>
  );
}

const IMPACT_TONE = { High: "critical", Medium: "warning", Low: "info" } as const;

function HomeTaskList({ tasks, planKey, onNavigate }: { tasks: HomeTask[]; planKey: string; onNavigate: (url: string) => void }) {
  return (
    <Card padding="400">
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd" fontWeight="bold">What to do next</Text>
          <Text as="p" variant="bodySm" tone="subdued">Highest-impact fixes across SEO Audit, Bulk Optimize, Content and Catalog.</Text>
        </BlockStack>
        {tasks.length ? (
          <BlockStack gap="0">
            {tasks.map((task, index) => (
              <div key={task.id}>
                {index > 0 && <Divider />}
                <div style={{ padding: "12px 0" }}>
                  <InlineStack align="space-between" blockAlign="center" gap="300" wrap={false}>
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Badge tone={IMPACT_TONE[task.impact]}>{`${task.impact} impact`}</Badge>
                        <Text as="span" variant="bodySm" tone="subdued">{task.area}</Text>
                      </InlineStack>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">{task.title}</Text>
                      <Text as="span" variant="bodySm" tone="subdued">{task.detail}</Text>
                    </BlockStack>
                    {task.locked ? (
                      <Button icon={LockIcon} onClick={() => onNavigate(`/app/pricing?reason=home_task&plan=${planKey}`)}>Upgrade</Button>
                    ) : (
                      <Button onClick={() => onNavigate(task.url)}>{task.actionLabel}</Button>
                    )}
                  </InlineStack>
                </div>
              </div>
            ))}
          </BlockStack>
        ) : (
          <InlineStack gap="300" blockAlign="center">
            <Icon source={CheckIcon} tone="success" />
            <Text as="p" variant="bodyMd">Nothing urgent. Your store is in good shape.</Text>
          </InlineStack>
        )}
      </BlockStack>
    </Card>
  );
}

function MetricCard({
  title,
  value,
  detail,
  iconTone,
  icon,
}: {
  title: string;
  value: string;
  detail: string;
  iconTone: "success" | "info" | "magic" | "warning";
  icon: any;
}) {
  return (
    <Card padding="400">
      <InlineStack align="space-between" blockAlign="start" wrap={false}>
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd" fontWeight="semibold">
            {title}
          </Text>
          <BlockStack gap="100">
            <Text as="p" variant="heading2xl" fontWeight="bold">
              {value}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {detail}
            </Text>
          </BlockStack>
        </BlockStack>
        <Box background={`bg-surface-${iconTone}` as any} padding="200" borderRadius="200">
          <Icon source={icon} tone={iconTone} />
        </Box>
      </InlineStack>
    </Card>
  );
}

function PerformanceStat({
  label,
  value,
  trend,
  color,
}: {
  label: string;
  value: string;
  trend: string;
  color: string;
}) {
  const isDown = trend.startsWith("-");

  return (
    <BlockStack gap="100">
      <InlineStack gap="100" blockAlign="center">
        <div style={{ width: 8, height: 2, backgroundColor: color }} />
        <Text as="span" variant="bodySm" tone="subdued">
          {label}
        </Text>
      </InlineStack>
      <InlineStack gap="200" blockAlign="baseline">
        <Text as="span" variant="headingMd" fontWeight="bold">
          {value}
        </Text>
        <InlineStack gap="025" blockAlign="center">
          <Icon source={isDown ? ArrowDownIcon : ArrowUpIcon} tone={isDown ? "critical" : "success"} />
          <Text as="span" variant="bodySm" tone={isDown ? "critical" : "success"} fontWeight="semibold">
            {trend}
          </Text>
        </InlineStack>
      </InlineStack>
    </BlockStack>
  );
}

function DashboardThumbnail({ source, alt }: { source?: string | null; alt: string }) {
  return (
    <div
      style={{
        width: "40px",
        height: "40px",
        borderRadius: "6px",
        overflow: "hidden",
        background: "#f1f1f1",
        border: "1px solid #e3e3e3",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {source ? (
        <img
          src={source}
          alt={alt}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        <Icon source={ImageIcon} tone="subdued" />
      )}
    </div>
  );
}

function CompactProductLeaderboard({
  title,
  products,
  metricKey,
  metricLabel,
}: {
  title: string;
  products: DashboardProduct[];
  metricKey: "addToCarts" | "purchases";
  metricLabel: string;
}) {
  return (
    <Box borderColor="border" borderWidth="025" borderRadius="200" padding="300">
      <BlockStack gap="300">
        <Text as="h3" variant="headingSm" fontWeight="bold">
          {title}
        </Text>
        {products.length ? (
          <BlockStack gap="300">
            {products.map((product) => (
              <div
                key={`${title}-${product.id}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "40px minmax(0, 1fr) auto",
                  alignItems: "center",
                  columnGap: "10px",
                  minHeight: "48px",
                  padding: "4px 0",
                }}
              >
                <DashboardThumbnail source={product.image} alt={product.title} />
                <div style={{ minWidth: 0 }}>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm" fontWeight="semibold" truncate>
                      {product.title}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {formatMoney(product.revenue)} revenue
                    </Text>
                  </BlockStack>
                </div>
                <div style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                  <Text as="span" variant="bodySm" fontWeight="bold">
                    {formatNumber(product[metricKey])} {metricLabel}
                  </Text>
                </div>
              </div>
            ))}
          </BlockStack>
        ) : (
          <Text as="p" variant="bodySm" tone="subdued">
            No events yet.
          </Text>
        )}
      </BlockStack>
    </Box>
  );
}

function mergeSetupStatus(setup: any, status: any, pixelActionError?: string) {
  if (!status || status.error) return setup;
  const items = setup.items.map((item: any) => {
    if (item.label === "App enabled in theme") return {
      ...item,
      done: Boolean(status.appEmbedEnabled),
      actionLabel: "View setup guide",
      actionError: status.appEmbedError || undefined,
    };
    if (item.label === "Conversion tracking (Web Pixel) active") return {
      ...item,
      done: Boolean(status.webPixelEnabled),
      actionLabel: status.webPixelEnabled ? undefined : "Activate",
      actionError: pixelActionError || status.webPixelError || undefined,
    };
    return item;
  });
  const done = items.filter((item: any) => item.done).length;
  return { ...setup, items, done, progress: Math.round((done / items.length) * 100) };
}

function getMetrics(events: Array<{ articleId: string; productId: string; eventType: string; count?: number }>, priceMap: Map<string, number>) {
  return events.reduce((acc, event) => addEventToMetrics(acc, event, priceMap), emptyMetrics());
}

function getArticleMetricsMap(
  events: Array<{ articleId: string; productId: string; eventType: string; count?: number }>,
  priceMap: Map<string, number>,
) {
  const map = new Map<string, PeriodMetrics>();

  events.forEach((event) => {
    const metrics = map.get(event.articleId) || emptyMetrics();
    map.set(event.articleId, addEventToMetrics(metrics, event, priceMap));
  });

  return map;
}

function buildDashboardProductRows(
  events: Array<{ articleId: string; productId: string; eventType: string; count?: number }>,
  priceMap: Map<string, number>,
  productInfoMap: Map<string, { title: string; image: string; price: number }>,
) {
  const map = new Map<string, DashboardProduct>();

  productInfoMap.forEach((info, productId) => {
    map.set(productId, {
      id: productId,
      title: info.title,
      image: info.image,
      price: info.price,
      ...emptyMetrics(),
    });
  });

  events.forEach((event) => {
    if (event.productId === "all") return;
    const productId = normalizeProductId(event.productId);
    const existing = map.get(productId) || {
      id: productId,
      title: "Untitled product",
      image: "",
      price: 0,
      ...emptyMetrics(),
    };

    addEventToMetrics(existing, { ...event, productId }, priceMap);
    map.set(productId, existing);
  });

  return Array.from(map.values());
}

function sortDashboardProductRows(products: DashboardProduct[], metricKey: "addToCarts" | "purchases") {
  return products
    .filter((product) => product[metricKey] > 0)
    .sort(
      (a, b) =>
        b[metricKey] - a[metricKey] ||
        b.revenue - a.revenue ||
        b.purchases - a.purchases ||
        b.addToCarts - a.addToCarts ||
        b.clicks - a.clicks ||
        a.title.localeCompare(b.title),
    );
}

function addEventToMetrics(
  metrics: PeriodMetrics,
  event: { articleId: string; productId: string; eventType: string; count?: number },
  priceMap: Map<string, number>,
) {
  const count = event.count || 1;
  if (event.eventType === "impression") metrics.impressions += count;
  if (event.eventType === "click") metrics.clicks += count;
  if (event.eventType === "add_to_cart") metrics.addToCarts += count;
  if (event.eventType === "purchase" || event.eventType === "order") {
    metrics.purchases += count;
    
    let normalizedProductId = event.productId;
    if (normalizedProductId && /^\d+$/.test(normalizedProductId)) {
      normalizedProductId = `gid://shopify/Product/${normalizedProductId}`;
    } else if (normalizedProductId && !normalizedProductId.startsWith("gid://")) {
      normalizedProductId = `gid://shopify/Product/${normalizedProductId}`;
    }
    
    metrics.revenue += (priceMap.get(`${event.articleId}:${normalizedProductId}`) || 0) * count;
  }

  return metrics;
}

function normalizeProductId(value: string) {
  if (/^\d+$/.test(value)) return `gid://shopify/Product/${value}`;
  if (!value.startsWith("gid://")) return `gid://shopify/Product/${value}`;
  return value;
}

function buildChartData(
  events: Array<{ articleId: string; productId: string; eventType: string; createdAt: Date; count?: number }>,
  priceMap: Map<string, number>,
  start: Date,
  end: Date,
) {
  const days: ChartPoint[] = [];
  const normalizedStart = startOfDay(start).getTime();
  const normalizedEnd = startOfDay(end).getTime();

  for (let time = normalizedStart; time <= normalizedEnd; time += DAY_MS) {
    days.push({
      date: formatShortDate(new Date(time)),
      ...emptyMetrics(),
    });
  }

  events.forEach((event) => {
    const index = Math.floor((startOfDay(event.createdAt).getTime() - normalizedStart) / DAY_MS);
    if (index >= 0 && index < days.length) {
      addEventToMetrics(days[index], event, priceMap);
    }
  });

  return days;
}


function emptyMetrics(): PeriodMetrics {
  return {
    impressions: 0,
    clicks: 0,
    addToCarts: 0,
    purchases: 0,
    revenue: 0,
  };
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

function parseMoney(value: string) {
  const number = Number((value || "0").replace(/[^0-9.]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value || 0);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value || 0);
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

function formatDate(value: string | null) {
  if (!value) return "Not saved";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatShortDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(value);
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function getTimeValue(value: string | null) {
  return value ? new Date(value).getTime() : 0;
}

function getScoreTone(score: number) {
  if (score >= 80) return "success";
  if (score >= 60) return "caution";
  return "critical";
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
