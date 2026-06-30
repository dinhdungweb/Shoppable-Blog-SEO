import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
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
  Text,
  Thumbnail,
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
  const { admin, session, billing } = await authenticate.admin(request);
  const shop = session.shop;

  // Resolve plan limits to determine the analytics window
  const { planKey, limits } = await getActivePlanAndLimits(billing);
  const windowDays = limits.analyticsWindowDays; // e.g. 7, 30, or 90

  const now = new Date();
  const currentStart = startOfDay(new Date(now.getTime() - (windowDays - 1) * DAY_MS));
  const previousStart = startOfDay(new Date(now.getTime() - (windowDays * 2 - 1) * DAY_MS));

  let blogs: any[] = [];
  let shopifyArticles: any[] = [];
  let shopifyError = "";

  try {
    const response = await admin.graphql(
      `#graphql
      query OverviewBlogs {
        blogs(first: 50) {
          nodes {
            id
            title
            handle
            articles(first: 100) {
              nodes {
                id
                title
                handle
                publishedAt
                image {
                  url
                  altText
                }
                blog {
                  id
                  title
                  handle
                }
              }
            }
          }
        }
      }`,
    );
    const result: any = await response.json();

    if (result.errors?.length) {
      console.error("Overview Shopify query error:", result.errors);
      shopifyError = "Could not load Shopify blog posts.";
    } else {
      blogs = result.data?.blogs?.nodes || [];
      shopifyArticles = blogs.flatMap((blog: any) =>
        (blog.articles?.nodes || []).map((article: any) => ({
          ...article,
          blog: article.blog || {
            id: blog.id,
            title: blog.title,
            handle: blog.handle,
          },
        })),
      );
    }
  } catch (error) {
    console.error("Overview Shopify query failed:", error);
    shopifyError = "Could not load Shopify blog posts.";
  }

  const baseArticles = shopifyArticles.map((article: any) => ({
    id: article.id,
    title: article.title || "Untitled post",
    handle: article.handle || "",
    image: article.image?.url || "",
    imageAlt: article.image?.altText || "",
    publishedAt: article.publishedAt || null,
    updatedAt: article.updatedAt || article.publishedAt || null,
    seoTitle: "",
    seoDescription: "",
    blogId: article.blog?.id || "",
    blogTitle: article.blog?.title || "Blog",
    blogHandle: article.blog?.handle || "",
  }));

  const [
    config,
    linkedProducts,
    seoRows,
    allEvents,
    everEventCount,
  ] = await Promise.all([
    prisma.shopConfig.upsert({
      where: { shop },
      update: {},
      create: { shop },
    }),
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
      select: { articleId: true, articleTitle: true, seoScore: true, metaDescription: true },
    }),
    prisma.widgetEvent.findMany({
      where: { shop, createdAt: { gte: previousStart } },
      select: {
        articleId: true,
        productId: true,
        eventType: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.widgetEvent.count({ where: { shop } }),
  ]);

  let appEmbedEnabled = false;
  try {
    const themesResponse = await admin.rest.get({ path: "themes" });
    const themesResult = await themesResponse.json();
    const mainTheme = themesResult.themes?.find((t: any) => t.role === "main");

    if (mainTheme) {
      const assetResponse = await admin.rest.get({
        path: `themes/${mainTheme.id}/assets`,
        query: { "asset[key]": "config/settings_data.json" }
      });
      const assetResult = await assetResponse.json();
      if (assetResult.asset?.value) {
        const settingsData = JSON.parse(assetResult.asset.value);
        const blocks = settingsData?.current?.blocks || {};
        for (const blockId in blocks) {
          const block = blocks[blockId];
          if (block.type && block.type.includes("sbs-article-embed")) {
            if (String(block.disabled) !== "true") {
              appEmbedEnabled = true;
              break;
            }
          }
        }
      }
    }
  } catch (error) {
    console.error("Failed to check app embed status:", error);
    appEmbedEnabled = false;
  }

  const productCountMap = new Map<string, number>();
  const productPriceMap = new Map<string, number>();

  linkedProducts.forEach((product) => {
    productCountMap.set(product.articleId, (productCountMap.get(product.articleId) || 0) + 1);
    productPriceMap.set(`${product.articleId}:${product.productId}`, parseMoney(product.productPrice));
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

  const publishedArticles = articles.filter((article) => Boolean(article.publishedAt));
  const shoppablePublishedCount = publishedArticles.filter((article) => article.productCount > 0).length;
  const missingMetaDescriptions = articles.filter((article) => !article.seoDescription).length;
  const noLinkedProducts = articles.filter((article) => article.productCount === 0).length;
  const highTrafficNoProducts = articles.filter((article) => article.impressions >= 10 && article.productCount === 0).length;
  const lowCtrPosts = articles.filter(
    (article) => article.productCount > 0 && article.impressions >= 10 && getCtr(article.clicks, article.impressions) < 1,
  ).length;
  const averageSeoScore = getAverageSeoScore(articles);
  const setupItems = [
    { label: "Blog connected", done: blogs.length > 0 },
    { 
      label: "App enabled in theme", 
      done: appEmbedEnabled,
      actionUrl: appEmbedEnabled ? undefined : `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${process.env.SHOPIFY_API_KEY}/sbs-article-embed`,
      actionLabel: "Enable"
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

  return json({
    shop,
    shopifyError,
    generatedAt: now.toISOString(),
    planKey,
    analyticsWindowDays: windowDays,
    metrics: currentMetrics,
    previousMetrics,
    chartData,
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
  const {
    shopifyError,
    planKey,
    analyticsWindowDays,
    metrics,
    previousMetrics,
    chartData,
    counts,
    setup,
    recentPosts,
    recommendedActions,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

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
                {setup.items.map((item) => (
                  <ProgressItem key={item.label} label={item.label} done={item.done} actionUrl={item.actionUrl} actionLabel={item.actionLabel} />
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
                  {recommendedActions.map((action, index) => (
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
                  <Badge tone="info">Last {analyticsWindowDays} days</Badge>
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
                {chartData.some((point) => point.impressions || point.clicks || point.addToCarts || point.purchases) ? (
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
              {recentPosts.map((post, index) => (
                <IndexTable.Row id={post.id} key={post.id} position={index}>
                  <IndexTable.Cell>
                    <InlineStack gap="300" blockAlign="center" wrap={false}>
                      <Thumbnail source={post.image || ImageIcon} alt={post.imageAlt || post.title} size="small" />
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

function ProgressItem({ label, done, actionUrl, actionLabel }: { label: string; done: boolean; actionUrl?: string; actionLabel?: string }) {
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
      ) : actionUrl ? (
        <Button size="micro" url={actionUrl} target="_blank">{actionLabel || "Enable"}</Button>
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

function getMetrics(events: Array<{ articleId: string; productId: string; eventType: string }>, priceMap: Map<string, number>) {
  return events.reduce((acc, event) => addEventToMetrics(acc, event, priceMap), emptyMetrics());
}

function getArticleMetricsMap(
  events: Array<{ articleId: string; productId: string; eventType: string }>,
  priceMap: Map<string, number>,
) {
  const map = new Map<string, PeriodMetrics>();

  events.forEach((event) => {
    const metrics = map.get(event.articleId) || emptyMetrics();
    map.set(event.articleId, addEventToMetrics(metrics, event, priceMap));
  });

  return map;
}

function addEventToMetrics(
  metrics: PeriodMetrics,
  event: { articleId: string; productId: string; eventType: string },
  priceMap: Map<string, number>,
) {
  if (event.eventType === "impression") metrics.impressions += 1;
  if (event.eventType === "click") metrics.clicks += 1;
  if (event.eventType === "add_to_cart") metrics.addToCarts += 1;
  if (event.eventType === "purchase" || event.eventType === "order") {
    metrics.purchases += 1;
    metrics.revenue += priceMap.get(`${event.articleId}:${event.productId}`) || 0;
  }

  return metrics;
}

function buildChartData(
  events: Array<{ articleId: string; productId: string; eventType: string; createdAt: Date }>,
  priceMap: Map<string, number>,
  start: Date,
  end: Date,
) {
  const points = new Map<string, ChartPoint>();

  for (let date = new Date(start); date <= end; date = new Date(date.getTime() + DAY_MS)) {
    const key = date.toISOString().slice(0, 10);
    points.set(key, { date: formatShortDate(date), ...emptyMetrics() });
  }

  events.forEach((event) => {
    const key = event.createdAt.toISOString().slice(0, 10);
    const point = points.get(key);
    if (point) addEventToMetrics(point, event, priceMap);
  });

  return Array.from(points.values());
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
