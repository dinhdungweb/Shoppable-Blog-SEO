import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate, useRevalidator } from "@remix-run/react";
import { useEffect } from "react";
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
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CashDollarIcon,
  ChartVerticalFilledIcon,
  CheckIcon,
  ChevronRightIcon,
  EditIcon,
  ImageIcon,
  MagicIcon,
  NoteIcon,
  PlusIcon,
  SearchIcon,
  TargetIcon,
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

type RecommendedIconKey = "alert" | "plus" | "chart" | "target";

const DAY_MS = 24 * 60 * 60 * 1000;
const PLACEHOLDER_IMAGE = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";
const RECOMMENDED_ICON_MAP = {
  alert: AlertCircleIcon,
  plus: PlusIcon,
  chart: ChartVerticalFilledIcon,
  target: TargetIcon,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const startedAt = Date.now();
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;

  // Resolve plan limits to determine the analytics window
  const { planKey, limits } = await getActivePlanAndLimits(billing);
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
      select: { articleId: true, articleTitle: true, seoScore: true, metaDescription: true, metaTitle: true, articleHandle: true, imageUrl: true, imageAlt: true, blogTitle: true, blogHandle: true, sourceUpdatedAt: true, publishedAt: true },
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

  type SetupItem = {
    label: string;
    done: boolean;
    actionUrl?: string;
    actionLabel?: string;
  };

  const setupItems: SetupItem[] = [
    { label: "Blog connected", done: baseArticles.length > 0 },
    { 
      label: "App enabled in theme", 
      done: appEmbedEnabled,
      actionUrl: appEmbedEnabled ? undefined : `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${process.env.SHOPIFY_API_KEY}/sbs-article-embed`,
      actionLabel: appEmbedError === "Checking…" ? "Checking…" : appEmbedError ? `Error: ${appEmbedError}` : "Enable"
    },
    {
      label: "Conversion tracking (Web Pixel) active",
      done: webPixelEnabled,
      actionLabel: webPixelError === "Checking…" ? "Checking…" : webPixelError ? `Error: ${webPixelError}` : undefined
    },
    { label: "Products linked to posts", done: linkedProducts.length > 0 },
    { label: "Tracking events received", done: everEventCount > 0 },
    { label: "First shoppable post published", done: shoppablePublishedCount > 0 },
  ];
  const setupDone = setupItems.filter((item) => item.done).length;
  const recommendedActions = buildRecommendedActions({
    missingMetaDescriptions,
    noLinkedProducts,
    highTrafficNoProducts,
    lowCtrPosts,
    everEventCount,
  });
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
    recommendedActions,
  });
};

export default function Dashboard() {
  const data = useLoaderData<any>();
  const setupFetcher = useFetcher<any>();
  const pixelFetcher = useFetcher<any>();
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
    if (pixelFetcher.data?.success) setupFetcher.load("/app/dashboard-status");
  }, [pixelFetcher.data, setupFetcher]);

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
    recommendedActions,
  } = data;
  const setup = mergeSetupStatus(initialSetup, setupFetcher.data, pixelFetcher.data?.error);

  const productCtr = getCtr(metrics.clicks, metrics.impressions);

  return (
    <Page fullWidth>
      <TitleBar title="Overview" />
      <BlockStack gap="600">
        <InlineStack align="space-between" blockAlign="end">
          <BlockStack gap="100">
            <Text as="h1" variant="headingLg" fontWeight="bold">
              Overview
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Monitor shoppable blog setup, SEO health, and product engagement from the last 30 days.
            </Text>
          </BlockStack>
          <InlineStack gap="200">
            <Button onClick={() => navigate("/app/seo")}>Run SEO scan</Button>
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

        <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
          <Card padding="400">
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd" fontWeight="bold">
                  Setup progress
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  {setup.done} of {setup.total} completed
                </Text>
              </InlineStack>
              <ProgressBar progress={setup.progress} tone={setup.progress === 100 ? "success" : "primary"} size="small" />
              <BlockStack gap="300">
                {setup.items.map((item: any) => (
                  <ProgressItem
                    key={item.label} label={item.label} done={item.done} actionUrl={item.actionUrl} actionLabel={item.actionLabel}
                    loading={item.label === "Conversion tracking (Web Pixel) active" && pixelFetcher.state !== "idle"}
                    onAction={item.label === "Conversion tracking (Web Pixel) active"
                      ? () => pixelFetcher.submit({ intent: "activate_pixel" }, { method: "post", action: "/app/dashboard-status" })
                      : undefined}
                  />
                ))}
              </BlockStack>
            </BlockStack>
          </Card>

          <Card padding="400">
            <BlockStack gap="400">
              <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", width: "fit-content" }}>
                <Icon source={AlertTriangleIcon} tone={recommendedActions.length ? "warning" : "success"} />
                <Text as="h2" variant="headingMd" fontWeight="bold">
                  Current priorities
                </Text>
              </div>
              <BlockStack gap="300">
                <PriorityItem number={String(counts.missingMetaDescriptions)} label="posts missing meta descriptions" tone={counts.missingMetaDescriptions ? "critical" : "subdued"} />
                <Divider />
                <PriorityItem number={String(counts.noLinkedProducts)} label="posts without linked products" tone={counts.noLinkedProducts ? "warning" : "subdued"} />
                <Divider />
                <PriorityItem number={String(counts.lowCtrPosts)} label="linked posts with low product CTR" tone={counts.lowCtrPosts ? "warning" : "subdued"} />
              </BlockStack>
              <InlineStack gap="200">
                <Button variant="primary" onClick={() => navigate("/app/seo")}>
                  Review SEO
                </Button>
                <Button onClick={() => navigate("/app/blogs")}>Review posts</Button>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card padding="400">
            <BlockStack gap="400">
              <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", width: "fit-content" }}>
                <Icon source={MagicIcon} tone="info" />
                <Text as="h2" variant="headingMd" fontWeight="bold">
                  Quick actions
                </Text>
              </div>
              <BlockStack gap="100">
                <ActionItem icon={EditIcon} title="Create shoppable post" desc="Draft a post in the blog editor" onAction={() => navigate("/app/blogs/new")} />
                <ActionItem icon={SearchIcon} title="Run SEO scan" desc="Find posts missing metadata or products" onAction={() => navigate("/app/seo")} />
                <ActionItem icon={PlusIcon} title="Add products to posts" desc="Open Blog Manager and link products" onAction={() => navigate("/app/blogs")} />
                <ActionItem icon={TargetIcon} title="Review app settings" desc="Check tracking and widget display rules" onAction={() => navigate("/app/settings")} />
              </BlockStack>
            </BlockStack>
          </Card>
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

        <InlineGrid columns={{ xs: 1, lg: "1fr 2fr" }} gap="400">
          <Card padding="400">
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd" fontWeight="bold">
                Recommended next actions
              </Text>
              {recommendedActions.length ? (
                <BlockStack gap="400">
                  {recommendedActions.map((action: any, index: number) => (
                    <RecommendedAction
                      key={action.title}
                      icon={RECOMMENDED_ICON_MAP[action.iconKey as RecommendedIconKey]}
                      iconTone={action.iconTone}
                      title={action.title}
                      badge={action.badge}
                      badgeTone={action.badgeTone}
                      button={action.button}
                      onAction={() => navigate(action.to)}
                      showDivider={index < recommendedActions.length - 1}
                    />
                  ))}
                </BlockStack>
              ) : (
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={CheckIcon} tone="success" />
                  <Text as="p" variant="bodyMd">
                    No urgent recommendations right now.
                  </Text>
                </InlineStack>
              )}
            </BlockStack>
          </Card>

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
        </InlineGrid>

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

function ProgressItem({ label, done, actionUrl, actionLabel, onAction, loading }: { label: string; done: boolean; actionUrl?: string; actionLabel?: string; onAction?: () => void; loading?: boolean }) {
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
      ) : actionLabel?.startsWith("Error:") ? (
        <Badge tone="critical">{actionLabel}</Badge>
      ) : actionUrl || onAction ? (
        <Button size="micro" url={actionUrl} target={actionUrl ? "_blank" : undefined} onClick={onAction} loading={loading}>{actionLabel || "Enable"}</Button>
      ) : (
        <Badge tone="new">Pending</Badge>
      )}
    </InlineStack>
  );
}

function PriorityItem({ number, label, tone }: { number: string; label: string; tone: "critical" | "warning" | "subdued" }) {
  return (
    <div className="bp-overview-row">
      <InlineStack gap="300" blockAlign="center" wrap={false}>
        <Text as="span" variant="headingLg" fontWeight="bold" tone={tone === "warning" ? "caution" : tone}>
          {number}
        </Text>
        <Text as="span" variant="bodyMd">
          {label}
        </Text>
      </InlineStack>
      <span className="bp-overview-chevron">
        <Icon source={ChevronRightIcon} tone="subdued" />
      </span>
    </div>
  );
}

function ActionItem({
  icon,
  title,
  desc,
  onAction,
}: {
  icon: any;
  title: string;
  desc: string;
  onAction: () => void;
}) {
  return (
    <button type="button" className="bp-overview-action" onClick={onAction}>
      <div className="bp-overview-row">
        <InlineStack gap="300" blockAlign="center" wrap={false}>
          <Box padding="100" background="bg-surface-secondary" borderRadius="100">
            <Icon source={icon} tone="subdued" />
          </Box>
          <BlockStack gap="0">
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {title}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {desc}
            </Text>
          </BlockStack>
        </InlineStack>
        <span className="bp-overview-chevron">
          <Icon source={ChevronRightIcon} tone="subdued" />
        </span>
      </div>
    </button>
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

function RecommendedAction({
  icon,
  iconTone,
  title,
  badge,
  badgeTone,
  button,
  onAction,
  showDivider,
}: {
  icon: any;
  iconTone: "critical" | "warning" | "info";
  title: string;
  badge: string;
  badgeTone: "critical" | "warning" | "info";
  button: string;
  onAction: () => void;
  showDivider: boolean;
}) {
  return (
    <BlockStack gap="400">
      <InlineStack align="space-between" blockAlign="center" wrap={false}>
        <InlineStack gap="300" blockAlign="center" wrap={false}>
          <Icon source={icon} tone={iconTone} />
          <Text as="span" variant="bodyMd">
            {title}
          </Text>
          <Badge tone={badgeTone}>{badge}</Badge>
        </InlineStack>
        <Button size="micro" onClick={onAction}>
          {button}
        </Button>
      </InlineStack>
      {showDivider && <Divider />}
    </BlockStack>
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

function buildRecommendedActions({
  missingMetaDescriptions,
  noLinkedProducts,
  highTrafficNoProducts,
  lowCtrPosts,
  everEventCount,
}: {
  missingMetaDescriptions: number;
  noLinkedProducts: number;
  highTrafficNoProducts: number;
  lowCtrPosts: number;
  everEventCount: number;
}) {
  const actions = [];

  if (missingMetaDescriptions > 0) {
    actions.push({
      iconKey: "alert" as const,
      iconTone: "critical" as const,
      title: `Fix ${missingMetaDescriptions} posts missing meta descriptions`,
      badge: "High impact",
      badgeTone: "critical" as const,
      button: "Fix now",
      to: "/app/seo",
    });
  }

  if (highTrafficNoProducts > 0) {
    actions.push({
      iconKey: "plus" as const,
      iconTone: "warning" as const,
      title: `Add products to ${highTrafficNoProducts} posts with impressions`,
      badge: "High impact",
      badgeTone: "warning" as const,
      button: "Review posts",
      to: "/app/blogs",
    });
  } else if (noLinkedProducts > 0) {
    actions.push({
      iconKey: "plus" as const,
      iconTone: "warning" as const,
      title: `Link products to ${noLinkedProducts} posts`,
      badge: "Medium impact",
      badgeTone: "warning" as const,
      button: "Review posts",
      to: "/app/blogs",
    });
  }

  if (lowCtrPosts > 0) {
    actions.push({
      iconKey: "chart" as const,
      iconTone: "warning" as const,
      title: `Improve ${lowCtrPosts} posts with low product CTR`,
      badge: "Medium impact",
      badgeTone: "warning" as const,
      button: "View posts",
      to: "/app/blogs",
    });
  }

  if (everEventCount === 0) {
    actions.push({
      iconKey: "target" as const,
      iconTone: "info" as const,
      title: "Verify storefront tracking after enabling the widget",
      badge: "Setup",
      badgeTone: "info" as const,
      button: "Settings",
      to: "/app/settings",
    });
  }

  return actions;
}

function mergeSetupStatus(setup: any, status: any, pixelActionError?: string) {
  if (!status || status.error) return setup;
  const items = setup.items.map((item: any) => {
    if (item.label === "App enabled in theme") return { ...item, done: Boolean(status.appEmbedEnabled), actionLabel: status.appEmbedError || (status.appEmbedEnabled ? undefined : "Enable") };
    if (item.label === "Conversion tracking (Web Pixel) active") return { ...item, done: Boolean(status.webPixelEnabled), actionLabel: pixelActionError ? `Error: ${pixelActionError}` : status.webPixelError ? `Error: ${status.webPixelError}` : status.webPixelEnabled ? undefined : "Activate" };
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
