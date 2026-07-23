import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Badge,
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
  Text,
} from "@shopify/polaris";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CartIcon,
  CashDollarIcon,
  CheckIcon,
  ImageIcon,
  MagicIcon,
  ProductIcon,
  TargetIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import prisma from "../db.server";

type Metrics = {
  sessions: number;
  impressions: number;
  clicks: number;
  addToCarts: number;
  purchases: number;
  revenue: number;
};

type ChartPoint = Metrics & {
  date: string;
};

type ArticleSource = {
  id: string;
  title: string;
  handle: string;
  image: string;
  imageAlt: string;
  blogId: string;
  blogTitle: string;
  blogHandle: string;
};

type PostRow = ArticleSource &
  Metrics & {
    productCount: number;
    seoScore: number | null;
    ctr: number;
    suggestedAction: string;
    suggestedTone: "success" | "info" | "warning";
  };

type ProductRow = Metrics & {
  id: string;
  title: string;
  image: string;
  price: number;
  ctr: number;
};

type InsightIconKey = "target" | "cart" | "cash" | "product" | "magic";

const DAY_MS = 24 * 60 * 60 * 1000;
const PLACEHOLDER_IMAGE = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";
const PIE_COLORS = ["#2C6ECB", "#00A0AC", "#8D51D5", "#E58A1F", "#A3A8B1"];
const INSIGHT_ICON_MAP = {
  target: TargetIcon,
  cart: CartIcon,
  cash: CashDollarIcon,
  product: ProductIcon,
  magic: MagicIcon,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const startedAt = Date.now();
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const { limits } = await getActivePlanAndLimits(billing, shop);
  const windowDays = limits.analyticsWindowDays;

  const now = new Date();
  const currentStart = startOfDay(new Date(now.getTime() - (windowDays - 1) * DAY_MS));
  const previousStart = startOfDay(new Date(now.getTime() - (windowDays * 2 - 1) * DAY_MS));
  const shopifyError = "";
  let articleSources: ArticleSource[] = [];

  const [linkedProducts, seoRows, dailyRows, sessionTotals, dailySessions, sourceSessions] = await Promise.all([
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
      select: {
        articleId: true,
        articleTitle: true,
        seoScore: true,
        articleHandle: true,
        imageUrl: true,
        imageAlt: true,
        blogTitle: true,
        blogHandle: true,
      },
    }),
    prisma.analyticsDaily.findMany({ where: { shop, date: { gte: previousStart } }, orderBy: { date: "asc" } }),
    prisma.$queryRaw<Array<{ period: string; sessions: number }>>`
      SELECT CASE WHEN "date" >= ${currentStart} THEN 'current' ELSE 'previous' END AS "period", COUNT(DISTINCT "sessionKey")::int AS "sessions"
      FROM "AnalyticsDailySession" WHERE "shop" = ${shop} AND "date" >= ${previousStart}
      GROUP BY 1
    `,
    prisma.$queryRaw<Array<{ date: Date; sessions: number }>>`
      SELECT "date", COUNT(DISTINCT "sessionKey")::int AS "sessions" FROM "AnalyticsDailySession"
      WHERE "shop" = ${shop} AND "date" >= ${currentStart} GROUP BY "date" ORDER BY "date"
    `,
    prisma.$queryRaw<Array<{ source: string; sessions: number }>>`
      SELECT "source", COUNT(DISTINCT "sessionKey")::int AS "sessions" FROM "AnalyticsDailySession"
      WHERE "shop" = ${shop} AND "date" >= ${currentStart} GROUP BY "source" ORDER BY "sessions" DESC
    `,
  ]);

  const events: TrackedEvent[] = dailyRows.flatMap((row) => ([
    ["impression", row.impressions], ["click", row.clicks], ["add_to_cart", row.addToCarts], ["purchase", row.purchases],
  ] as const).filter(([, count]) => count > 0).map(([eventType, count]) => ({
    articleId: row.articleId, productId: row.productId, eventType, sessionId: null, referrer: row.source, createdAt: row.date, count,
  })));

  articleSources = seoRows.map((row) => ({ id: row.articleId, title: row.articleTitle || "Untitled post", handle: row.articleHandle,
    image: row.imageUrl, imageAlt: row.imageAlt, blogId: "", blogTitle: row.blogTitle || "Blog", blogHandle: row.blogHandle }));

  const productCountMap = new Map<string, number>();
  const priceMap = new Map<string, number>();
  const productInfoMap = new Map<string, { title: string; image: string; price: number }>();
  const fallbackArticleMap = new Map<string, ArticleSource>();

  linkedProducts.forEach((product) => {
    productCountMap.set(product.articleId, (productCountMap.get(product.articleId) || 0) + 1);
    const price = parseMoney(product.productPrice);
    priceMap.set(`${product.articleId}:${product.productId}`, price);

    if (!productInfoMap.has(product.productId)) {
      productInfoMap.set(product.productId, {
        title: product.productTitle || "Untitled product",
        image: product.productImage || "",
        price,
      });
    }

    if (!fallbackArticleMap.has(product.articleId)) {
      fallbackArticleMap.set(product.articleId, {
        id: product.articleId,
        title: product.articleTitle || "Untitled post",
        handle: product.articleHandle || "",
        image: "",
        imageAlt: "",
        blogId: product.blogId || "",
        blogTitle: "Blog",
        blogHandle: "",
      });
    }
  });

  seoRows.forEach((row) => {
    if (!fallbackArticleMap.has(row.articleId)) {
      fallbackArticleMap.set(row.articleId, {
        id: row.articleId,
        title: row.articleTitle || "Untitled post",
        handle: "",
        image: "",
        imageAlt: "",
        blogId: "",
        blogTitle: "Blog",
        blogHandle: "",
      });
    }
  });

  const articleSourceMap = new Map(articleSources.map((article) => [article.id, article]));
  fallbackArticleMap.forEach((article, id) => {
    if (!articleSourceMap.has(id)) articleSourceMap.set(id, article);
  });

  const seoScoreMap = new Map(seoRows.map((row) => [row.articleId, row.seoScore]));
  const currentEvents = events.filter((event) => event.createdAt >= currentStart);
  const previousEvents = events.filter((event) => event.createdAt < currentStart);
  const currentMetrics = getMetrics(currentEvents, priceMap, sessionTotals.find((row) => row.period === "current")?.sessions || 0);
  const previousMetrics = getMetrics(previousEvents, priceMap, sessionTotals.find((row) => row.period === "previous")?.sessions || 0);
  const chartData = buildChartData(currentEvents, priceMap, currentStart, now, new Map(dailySessions.map((row) => [startOfDay(row.date).getTime(), row.sessions])));
  const postRows = buildPostRows(Array.from(articleSourceMap.values()), currentEvents, priceMap, productCountMap, seoScoreMap);
  const productRows = buildProductRows(currentEvents, priceMap, productInfoMap);
  const topClickedProducts = sortProductRows(productRows, "clicks").slice(0, 5);
  const sourceData = buildSourceDataFromAggregates(sourceSessions);
  const insights = buildInsights({
    currentMetrics,
    previousMetrics,
    postRows,
    productRows,
    compareLabel: `Previous ${windowDays} days`,
  });

  return json({
    shopifyError,
    periodLabel: `Last ${windowDays} days`,
    compareLabel: `Previous ${windowDays} days`,
    analyticsWindowDays: windowDays,
    metrics: currentMetrics,
    previousMetrics,
    productCtr: getRate(currentMetrics.clicks, currentMetrics.impressions),
    purchaseRate: getRate(currentMetrics.purchases, currentMetrics.impressions),
    chartData,
    sourceData,
    topPosts: postRows.slice(0, 8),
    topProducts: topClickedProducts,
    topClickedProducts,
    insights,
  });
  console.info("Analytics loader timing", { shop, articles: articleSourceMap.size, aggregateRows: dailyRows.length, durationMs: Date.now() - startedAt });
};

export default function Analytics() {
  const {
    shopifyError,
    periodLabel,
    metrics,
    previousMetrics,
    productCtr,
    purchaseRate,
    chartData,
    sourceData,
    topPosts,
    topProducts,
    insights,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const hasEvents = metrics.impressions || metrics.clicks || metrics.addToCarts || metrics.purchases;

  return (
    <Page fullWidth>
      <TitleBar title="Analytics" />
      <BlockStack gap="500">
        <InlineStack align="space-between" blockAlign="end">
          <BlockStack gap="100">
            <Text as="h1" variant="headingXl" fontWeight="bold">
              Analytics
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Measure how shoppable blog widgets drive product discovery, clicks, add to carts, and estimated revenue.
            </Text>
          </BlockStack>
          <InlineStack gap="200" blockAlign="center">
            <Badge tone="info">{periodLabel}</Badge>
            <Button onClick={() => navigate("/app/blogs")}>Review posts</Button>
            <Button variant="primary" onClick={() => navigate("/app/seo")}>
              View recommendations
            </Button>
          </InlineStack>
        </InlineStack>

        {shopifyError && (
          <Card padding="400">
            <Text as="p" variant="bodyMd" tone="caution">
              {shopifyError} Analytics still uses events and linked products already stored by the app.
            </Text>
          </Card>
        )}

        <InlineGrid columns={{ xs: 2, sm: 3, md: 6 }} gap="400">
          <MetricCard
            title="Tracked sessions"
            value={formatNumber(metrics.sessions)}
            trend={formatTrend(metrics.sessions, previousMetrics.sessions)}
            data={buildSparkline(chartData, "sessions")}
          />
          <MetricCard
            title="Product impressions"
            value={formatNumber(metrics.impressions)}
            trend={formatTrend(metrics.impressions, previousMetrics.impressions)}
            data={buildSparkline(chartData, "impressions")}
          />
          <MetricCard
            title="Product clicks"
            value={formatNumber(metrics.clicks)}
            trend={formatTrend(metrics.clicks, previousMetrics.clicks)}
            data={buildSparkline(chartData, "clicks")}
          />
          <MetricCard
            title="Add to carts"
            value={formatNumber(metrics.addToCarts)}
            trend={formatTrend(metrics.addToCarts, previousMetrics.addToCarts)}
            data={buildSparkline(chartData, "addToCarts")}
          />
          <MetricCard
            title="Purchases"
            value={formatNumber(metrics.purchases)}
            trend={formatTrend(metrics.purchases, previousMetrics.purchases)}
            data={buildSparkline(chartData, "purchases")}
          />
          <MetricCard
            title="Estimated revenue"
            value={formatMoney(metrics.revenue)}
            trend={formatTrend(metrics.revenue, previousMetrics.revenue)}
            data={buildSparkline(chartData, "revenue")}
          />
        </InlineGrid>

        <InlineGrid columns={{ xs: 1, md: "1fr 2fr 1fr" }} gap="400">
          <Card padding="400">
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd" fontWeight="bold">
                Widget funnel
              </Text>
              <BlockStack gap="300">
                <FunnelStep label="Product impressions" value={formatNumber(metrics.impressions)} percentage="100%" bgWidth="100%" color="#C4E0FE" />
                <FunnelStep
                  label="Product clicks"
                  value={formatNumber(metrics.clicks)}
                  percentage={formatPercent(productCtr)}
                  bgWidth={`${Math.max(12, Math.min(100, productCtr))}%`}
                  color="#D3E8FE"
                />
                <FunnelStep
                  label="Add to carts"
                  value={formatNumber(metrics.addToCarts)}
                  percentage={formatPercent(getRate(metrics.addToCarts, metrics.impressions))}
                  bgWidth={`${Math.max(12, Math.min(100, getRate(metrics.addToCarts, metrics.impressions)))}%`}
                  color="#E1EFFE"
                />
                <FunnelStep
                  label="Purchases"
                  value={formatNumber(metrics.purchases)}
                  percentage={formatPercent(purchaseRate)}
                  bgWidth={`${Math.max(12, Math.min(100, purchaseRate))}%`}
                  color="#F0F7FF"
                />
              </BlockStack>
              <Divider />
              <InlineStack align="space-between" blockAlign="center">
                <Text as="p" variant="headingSm" fontWeight="bold">
                  Purchase rate
                </Text>
                <TrendValue value={formatPercent(purchaseRate)} trend={formatTrend(purchaseRate, getRate(previousMetrics.purchases, previousMetrics.impressions), "pp")} />
              </InlineStack>
            </BlockStack>
          </Card>

          <Card padding="400">
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd" fontWeight="bold">
                  Engagement over time
                </Text>
                <Badge tone="info">{periodLabel}</Badge>
              </InlineStack>
              {hasEvents ? (
                <Box minHeight="280px">
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={chartData} margin={{ top: 5, right: 8, left: -20, bottom: 6 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#6D7175" }} dy={10} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#6D7175" }} tickFormatter={(value) => formatCompactNumber(Number(value))} />
                      <RechartsTooltip />
                      <Legend verticalAlign="bottom" height={42} iconType="plainline" wrapperStyle={{ paddingTop: "8px" }} />
                      <Line type="monotone" dataKey="impressions" name="Impressions" stroke="#2C6ECB" strokeWidth={2} dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="clicks" name="Clicks" stroke="#8D51D5" strokeWidth={2} dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="addToCarts" name="Add to carts" stroke="#00A0AC" strokeWidth={2} dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="purchases" name="Purchases" stroke="#50B83C" strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </Box>
              ) : (
                <EmptyState
                  heading="No tracking events yet"
                  image={PLACEHOLDER_IMAGE}
                  action={{ content: "Check tracking settings", onAction: () => navigate("/app/settings") }}
                >
                  <p>Analytics will appear after storefront visitors view or click linked products in blog posts.</p>
                </EmptyState>
              )}
            </BlockStack>
          </Card>

          <Card padding="400">
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd" fontWeight="bold">
                Referrer breakdown
              </Text>
              {sourceData.length ? (
                <InlineStack align="space-between" blockAlign="center" wrap={false}>
                  <div style={{ width: "150px", height: "150px", position: "relative" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={sourceData} innerRadius={50} outerRadius={70} paddingAngle={2} dataKey="value" stroke="none">
                          {sourceData.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                      <Text as="p" variant="headingMd" fontWeight="bold">
                        {formatNumber(metrics.sessions || metrics.impressions)}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        tracked
                      </Text>
                    </div>
                  </div>
                  <BlockStack gap="200">
                    {sourceData.map((item) => (
                      <InlineStack key={item.name} align="space-between" blockAlign="center" gap="300">
                        <InlineStack gap="100" blockAlign="center">
                          <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: item.color }} />
                          <Text as="span" variant="bodySm">
                            {item.name}
                          </Text>
                        </InlineStack>
                        <Text as="span" variant="bodySm" fontWeight="bold">
                          {formatPercent(item.percent)}
                        </Text>
                      </InlineStack>
                    ))}
                  </BlockStack>
                </InlineStack>
              ) : (
                <EmptyState heading="No referrer data yet" image={PLACEHOLDER_IMAGE}>
                  <p>Referrers are collected from storefront widget events.</p>
                </EmptyState>
              )}
            </BlockStack>
          </Card>
        </InlineGrid>

        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          {insights.map((insight) => (
            <InsightCard
              key={insight.title}
              iconTone={insight.iconTone}
              icon={INSIGHT_ICON_MAP[insight.iconKey as InsightIconKey]}
              title={insight.title}
              desc={insight.desc}
              buttonText={insight.buttonText}
              onAction={() => navigate(insight.to)}
            />
          ))}
        </InlineGrid>

        <InlineGrid columns={{ xs: 1, lg: "minmax(0, 1.7fr) minmax(320px, 0.8fr)" }} gap="400">
          <Card padding="0">
            <Box padding="400" paddingBlockEnd="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd" fontWeight="bold">
                  Top performing posts
                </Text>
                <Button variant="plain" onClick={() => navigate("/app/blogs")}>
                  View all
                </Button>
              </InlineStack>
            </Box>
            {topPosts.length ? (
              <div className="bp-analytics-table-scroll">
                <IndexTable
                  resourceName={{ singular: "post", plural: "posts" }}
                  itemCount={topPosts.length}
                  headings={[
                    { title: "Post" },
                    { title: "Impressions" },
                    { title: "SEO" },
                    { title: "CTR" },
                    { title: "ATC" },
                    { title: "Purchases" },
                    { title: "Revenue" },
                    { title: "Action" },
                  ]}
                  selectable={false}
                >
                  {topPosts.map((post, index) => (
                    <IndexTable.Row id={post.id} key={post.id} position={index}>
                      <IndexTable.Cell>
                        <div className="bp-analytics-post-cell">
                          <AnalyticsThumbnail source={post.image} alt={post.imageAlt || post.title} />
                          <div className="bp-analytics-post-text">
                            <Text as="span" variant="bodyMd" fontWeight="semibold" truncate>
                              {post.title}
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued" truncate>
                              {post.blogTitle}
                            </Text>
                          </div>
                        </div>
                      </IndexTable.Cell>
                      <IndexTable.Cell>{formatNumber(post.impressions)}</IndexTable.Cell>
                      <IndexTable.Cell>
                        {post.seoScore === null ? (
                          <Text as="span" variant="bodyMd" tone="subdued">
                            -
                          </Text>
                        ) : (
                          <Text as="span" variant="bodyMd" tone={getScoreTone(post.seoScore)} fontWeight="bold">
                            {post.seoScore}
                          </Text>
                        )}
                      </IndexTable.Cell>
                      <IndexTable.Cell>{formatPercent(post.ctr)}</IndexTable.Cell>
                      <IndexTable.Cell>{formatNumber(post.addToCarts)}</IndexTable.Cell>
                      <IndexTable.Cell>{formatNumber(post.purchases)}</IndexTable.Cell>
                      <IndexTable.Cell>{formatMoney(post.revenue)}</IndexTable.Cell>
                      <IndexTable.Cell>
                        <Badge tone={post.suggestedTone}>{post.suggestedAction}</Badge>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              </div>
            ) : (
              <Box padding="600">
                <EmptyState
                  heading="No post analytics yet"
                  image={PLACEHOLDER_IMAGE}
                  action={{ content: "Open Blog Manager", onAction: () => navigate("/app/blogs") }}
                >
                  <p>Link products to posts and publish the widget to start collecting analytics.</p>
                </EmptyState>
              </Box>
            )}
          </Card>

          <Card padding="400">
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd" fontWeight="bold">
                  Product leaderboards
                </Text>
                <Button variant="plain" onClick={() => navigate("/app/blogs")}>
                  View all
                </Button>
              </InlineStack>
              {topProducts.length ? (
                <div className="bp-analytics-product-list">
                  {topProducts.map((product) => (
                    <div key={product.id} className="bp-analytics-product-row">
                      <div className="bp-analytics-product-main">
                        <AnalyticsThumbnail source={product.image} alt={product.title} />
                        <div className="bp-analytics-product-text">
                          <Text as="p" variant="bodyMd" fontWeight="semibold" truncate>
                            {product.title}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {formatNumber(product.clicks)} clicks - {formatNumber(product.addToCarts)} add to carts - {formatNumber(product.purchases)} purchases - {formatMoney(product.revenue)} revenue
                          </Text>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState heading="No product clicks yet" image={PLACEHOLDER_IMAGE}>
                  <p>Product performance appears after visitors click products embedded in blog posts.</p>
                </EmptyState>
              )}
            </BlockStack>
          </Card>
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}

function Sparkline({ data, color }: { data: Array<{ value: number }>; color: string }) {
  return (
    <div style={{ height: "40px", width: "100%", marginTop: "8px" }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function FunnelStep({
  label,
  value,
  percentage,
  bgWidth,
  color,
}: {
  label: string;
  value: string;
  percentage: string;
  bgWidth: string;
  color: string;
}) {
  return (
    <InlineStack align="space-between" blockAlign="center" wrap={false}>
      <Box width="145px">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="bodyMd" fontWeight="bold">
          {value}
        </Text>
      </Box>
      <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
        <div style={{ width: bgWidth, minWidth: "48px", backgroundColor: color, padding: "8px 0", textAlign: "center", borderRadius: "4px" }}>
          <Text as="span" variant="bodySm" fontWeight="bold">
            {percentage}
          </Text>
        </div>
      </div>
    </InlineStack>
  );
}

function MetricCard({
  title,
  value,
  trend,
  data,
}: {
  title: string;
  value: string;
  trend: { label: string; isUp: boolean };
  data: Array<{ value: number }>;
}) {
  return (
    <Card padding="400">
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {title}
        </Text>
        <InlineStack gap="200" blockAlign="baseline">
          <Text as="p" variant="headingLg" fontWeight="bold">
            {value}
          </Text>
          <InlineStack gap="025" blockAlign="center">
            <Icon source={trend.isUp ? ArrowUpIcon : ArrowDownIcon} tone={trend.isUp ? "success" : "critical"} />
            <Text as="span" variant="bodySm" tone={trend.isUp ? "success" : "critical"}>
              {trend.label}
            </Text>
          </InlineStack>
        </InlineStack>
        <Sparkline data={data} color={trend.isUp ? "#00A0AC" : "#D82C0D"} />
      </BlockStack>
    </Card>
  );
}

function TrendValue({ value, trend }: { value: string; trend: { label: string; isUp: boolean } }) {
  return (
    <InlineStack gap="200" blockAlign="center">
      <Text as="span" variant="headingSm" fontWeight="bold">
        {value}
      </Text>
      <InlineStack gap="025" blockAlign="center">
        <Icon source={trend.isUp ? ArrowUpIcon : ArrowDownIcon} tone={trend.isUp ? "success" : "critical"} />
        <Text as="span" variant="bodySm" tone={trend.isUp ? "success" : "critical"}>
          {trend.label}
        </Text>
      </InlineStack>
    </InlineStack>
  );
}

function InsightCard({
  iconTone,
  icon,
  title,
  desc,
  buttonText,
  onAction,
}: {
  iconTone: "success" | "warning" | "info" | "magic";
  icon: any;
  title: string;
  desc: string;
  buttonText: string;
  onAction: () => void;
}) {
  return (
    <Card padding="400">
      <div style={{ display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between" }}>
        <BlockStack gap="300">
          <InlineStack gap="200" blockAlign="center">
            <Box background={`bg-surface-${iconTone}` as any} padding="100" borderRadius="100">
              <Icon source={icon || CheckIcon} tone={iconTone} />
            </Box>
            <Text as="p" variant="headingSm" fontWeight="bold">
              {title}
            </Text>
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued">
            {desc}
          </Text>
        </BlockStack>
        <Box paddingBlockStart="400">
          <InlineStack align="start">
            <Button size="micro" onClick={onAction}>
              {buttonText}
            </Button>
          </InlineStack>
        </Box>
      </div>
    </Card>
  );
}

function AnalyticsThumbnail({ source, alt }: { source?: string | null; alt: string }) {
  return (
    <span className="bp-analytics-thumbnail">
      {source ? (
        <img src={source} alt={alt} loading="lazy" decoding="async" />
      ) : (
        <Icon source={ImageIcon} tone="subdued" />
      )}
    </span>
  );
}

function buildPostRows(
  articles: ArticleSource[],
  events: TrackedEvent[],
  priceMap: Map<string, number>,
  productCountMap: Map<string, number>,
  seoScoreMap: Map<string, number>,
): PostRow[] {
  const metricMap = new Map<string, Metrics>();

  events.forEach((event) => {
    const metrics = metricMap.get(event.articleId) || emptyMetrics();
    addEventToMetrics(metrics, event, priceMap);
    metricMap.set(event.articleId, metrics);
  });

  return articles
    .map((article) => {
      const metrics = metricMap.get(article.id) || emptyMetrics();
      const seoScore = seoScoreMap.has(article.id) ? seoScoreMap.get(article.id)! : null;
      const productCount = productCountMap.get(article.id) || 0;
      const suggested = getSuggestedAction({
        productCount,
        seoScore,
        impressions: metrics.impressions,
        clicks: metrics.clicks,
        purchases: metrics.purchases,
      });

      return {
        ...article,
        ...metrics,
        productCount,
        seoScore,
        ctr: getRate(metrics.clicks, metrics.impressions),
        suggestedAction: suggested.label,
        suggestedTone: suggested.tone,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.clicks - a.clicks || b.impressions - a.impressions || a.title.localeCompare(b.title));
}

function buildProductRows(
  events: TrackedEvent[],
  priceMap: Map<string, number>,
  productInfoMap: Map<string, { title: string; image: string; price: number }>,
): ProductRow[] {
  const metricsMap = new Map<string, Metrics>();

  events.forEach((event) => {
    if (event.productId === "all") return;
    let normalizedProductId = event.productId;
    if (normalizedProductId && /^\d+$/.test(normalizedProductId)) {
      normalizedProductId = `gid://shopify/Product/${normalizedProductId}`;
    } else if (normalizedProductId && !normalizedProductId.startsWith("gid://")) {
      normalizedProductId = `gid://shopify/Product/${normalizedProductId}`;
    }
    const metrics = metricsMap.get(normalizedProductId) || emptyMetrics();
    addEventToMetrics(metrics, event, priceMap);
    metricsMap.set(normalizedProductId, metrics);
  });

  productInfoMap.forEach((info, productId) => {
    if (!metricsMap.has(productId)) metricsMap.set(productId, emptyMetrics());
  });

  return Array.from(metricsMap.entries())
    .map(([productId, metrics]) => {
      const info = productInfoMap.get(productId);
      return {
        id: productId,
        title: info?.title || "Untitled product",
        image: info?.image || "",
        price: info?.price || 0,
        ...metrics,
        ctr: getRate(metrics.clicks, metrics.impressions),
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.clicks - a.clicks || a.title.localeCompare(b.title));
}

function sortProductRows(products: ProductRow[], metricKey: "clicks" | "addToCarts" | "purchases") {
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

type TrackedEvent = {
  articleId: string;
  productId: string;
  eventType: string;
  sessionId: string | null;
  referrer: string | null;
  createdAt: Date;
  count?: number;
};

function getMetrics(events: TrackedEvent[], priceMap: Map<string, number>, sessionCount?: number): Metrics {
  const metrics = emptyMetrics();
  const sessions = new Set<string>();

  events.forEach((event, index) => {
    if (sessionCount === undefined) {
      if (event.sessionId) sessions.add(event.sessionId);
      else sessions.add(`event-${index}`);
    }
    addEventToMetrics(metrics, event, priceMap);
  });

  metrics.sessions = sessionCount ?? sessions.size;
  return metrics;
}

function addEventToMetrics(metrics: Metrics, event: TrackedEvent, priceMap: Map<string, number>) {
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
}

function buildChartData(events: TrackedEvent[], priceMap: Map<string, number>, start: Date, end: Date, sessionCounts?: Map<number, number>): ChartPoint[] {
  const days: ChartPoint[] = [];

  for (let time = start.getTime(); time <= end.getTime(); time += DAY_MS) {
    days.push({
      date: formatShortDate(new Date(time)),
      ...emptyMetrics(),
    });
  }

  events.forEach((event) => {
    const index = Math.floor((startOfDay(event.createdAt).getTime() - start.getTime()) / DAY_MS);
    if (index < 0 || index >= days.length) return;
    addEventToMetrics(days[index], event, priceMap);
  });

  if (sessionCounts) {
    days.forEach((day, index) => { day.sessions = sessionCounts.get(start.getTime() + index * DAY_MS) || 0; });
  } else {
    const sessionsByDay = new Map<number, Set<string>>();
    events.forEach((event, eventIndex) => {
      const index = Math.floor((startOfDay(event.createdAt).getTime() - start.getTime()) / DAY_MS);
      if (index < 0 || index >= days.length) return;
      const set = sessionsByDay.get(index) || new Set<string>();
      set.add(event.sessionId || `event-${eventIndex}`);
      sessionsByDay.set(index, set);
    });
    sessionsByDay.forEach((sessions, index) => { days[index].sessions = sessions.size; });
  }

  return days;
}

function buildSourceDataFromAggregates(rows: Array<{ source: string; sessions: number }>) {
  const grouped = new Map<string, number>();
  rows.forEach((row) => {
    const name = row.source === "Direct" ? "Direct" : getReferrerSource(row.source);
    grouped.set(name, (grouped.get(name) || 0) + row.sessions);
  });
  const total = Array.from(grouped.values()).reduce((sum, sessions) => sum + sessions, 0);
  if (!total) return [];
  return Array.from(grouped.entries()).map(([name, sessions], index) => ({ name, value: sessions, percent: (sessions / total) * 100, color: PIE_COLORS[index % PIE_COLORS.length] }))
    .sort((left, right) => right.value - left.value);
}

function buildInsights({
  currentMetrics,
  previousMetrics,
  postRows,
  productRows,
  compareLabel,
}: {
  currentMetrics: Metrics;
  previousMetrics: Metrics;
  postRows: PostRow[];
  productRows: ProductRow[];
  compareLabel: string;
}) {
  const topPost = postRows.find((post) => post.clicks > 0);
  const topProduct = productRows.find((product) => product.clicks > 0);
  const abandonedAdds = Math.max(0, currentMetrics.addToCarts - currentMetrics.purchases);
  const revenueTrend = formatTrend(currentMetrics.revenue, previousMetrics.revenue);
  const lowSeoPosts = postRows.filter((post) => post.seoScore !== null && post.seoScore < 70).length;

  return [
    {
      iconTone: topPost ? ("success" as const) : ("info" as const),
      iconKey: "target" as const,
      title: topPost ? "Highest engagement post" : "Waiting for engagement",
      desc: topPost
        ? `${topPost.title} has ${formatNumber(topPost.clicks)} product clicks and ${formatPercent(topPost.ctr)} product CTR.`
        : "Clicks will appear here after visitors interact with products embedded in posts.",
      buttonText: "Review posts",
      to: "/app/blogs",
    },
    {
      iconTone: abandonedAdds ? ("warning" as const) : ("success" as const),
      iconKey: "cart" as const,
      title: "Conversion opportunity",
      desc: `${formatNumber(abandonedAdds)} add to carts have no matching purchase event in this period.`,
      buttonText: "Check products",
      to: "/app/blogs",
    },
    {
      iconTone: revenueTrend.isUp ? ("success" as const) : ("info" as const),
      iconKey: "cash" as const,
      title: "Revenue impact",
      desc: `${formatMoney(currentMetrics.revenue)} estimated revenue, ${revenueTrend.label} vs ${compareLabel.toLowerCase()}.`,
      buttonText: "View posts",
      to: "/app/blogs",
    },
    {
      iconTone: lowSeoPosts ? ("warning" as const) : ("magic" as const),
      iconKey: topProduct ? ("product" as const) : ("magic" as const),
      title: lowSeoPosts ? "SEO opportunity" : "Product opportunity",
      desc: lowSeoPosts
        ? `${formatNumber(lowSeoPosts)} posts have SEO scores below 70.`
        : topProduct
          ? `${topProduct.title} is the top clicked product from blog content.`
          : "Add products to posts to unlock product-level analytics.",
      buttonText: lowSeoPosts ? "Open SEO" : "Add products",
      to: lowSeoPosts ? "/app/seo" : "/app/blogs",
    },
  ];
}

function getSuggestedAction({
  productCount,
  seoScore,
  impressions,
  clicks,
  purchases,
}: {
  productCount: number;
  seoScore: number | null;
  impressions: number;
  clicks: number;
  purchases: number;
}) {
  if (productCount === 0) return { label: "Add products", tone: "warning" as const };
  if (seoScore !== null && seoScore < 70) return { label: "Optimize SEO", tone: "warning" as const };
  if (impressions >= 10 && getRate(clicks, impressions) < 1) return { label: "Improve CTR", tone: "info" as const };
  if (clicks > 0 && purchases === 0) return { label: "Review products", tone: "info" as const };
  return { label: "Maintain", tone: "success" as const };
}

function emptyMetrics(): Metrics {
  return {
    sessions: 0,
    impressions: 0,
    clicks: 0,
    addToCarts: 0,
    purchases: 0,
    revenue: 0,
  };
}

function getReferrerSource(referrer: string | null) {
  if (!referrer) return "Direct";

  let hostname = "";
  try {
    hostname = new URL(referrer).hostname.toLowerCase();
  } catch {
    hostname = referrer.toLowerCase();
  }

  if (/(google|bing|yahoo|duckduckgo|baidu|yandex)/.test(hostname)) return "Organic search";
  if (/(facebook|instagram|pinterest|tiktok|twitter|x\.com|linkedin|youtube)/.test(hostname)) return "Social";
  if (/(mail|email|klaviyo|omnisend|mailchimp)/.test(hostname)) return "Email";
  return "Other";
}

function buildSparkline(chartData: ChartPoint[], key: keyof Metrics) {
  return chartData.map((point) => ({ value: Number(point[key]) || 0 }));
}

function getRate(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
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
  return new Intl.NumberFormat("en-US").format(Math.round(value || 0));
}

function formatPercent(value: number) {
  return `${(value || 0).toFixed(1)}%`;
}

function formatTrend(current: number, previous: number, mode: "percent" | "pp" = "percent") {
  const diff = current - previous;
  const isUp = diff >= 0;

  if (mode === "pp") {
    return {
      label: `${isUp ? "+" : ""}${diff.toFixed(1)} pp`,
      isUp,
    };
  }

  if (previous === 0) {
    return {
      label: current > 0 ? "+100%" : "0%",
      isUp: current >= previous,
    };
  }

  return {
    label: `${isUp ? "+" : ""}${((diff / previous) * 100).toFixed(0)}%`,
    isUp,
  };
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value || 0);
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

function getScoreTone(score: number) {
  if (score >= 80) return "success";
  if (score >= 60) return "caution";
  return "critical";
}

export function links() {
  return [
    {
      rel: "stylesheet",
      href:
        "data:text/css," +
        encodeURIComponent(`
          .bp-analytics-table-scroll {
            max-width: 100%;
            overflow-x: auto;
            overflow-y: hidden;
          }
          .bp-analytics-table-scroll table {
            min-width: 860px;
          }
          .bp-analytics-post-cell {
            display: flex;
            align-items: center;
            gap: 12px;
            min-width: 260px;
            max-width: 320px;
          }
          .bp-analytics-thumbnail {
            width: 40px;
            height: 40px;
            flex: 0 0 40px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            border: 1px solid var(--p-color-border);
            border-radius: 6px;
            background: var(--p-color-bg-surface-secondary);
          }
          .bp-analytics-thumbnail img {
            width: 100%;
            height: 100%;
            display: block;
            object-fit: cover;
          }
          .bp-analytics-post-text {
            min-width: 0;
            display: grid;
            gap: 2px;
          }
          .bp-analytics-product-list {
            display: grid;
            gap: 12px;
            max-height: 340px;
            overflow-y: auto;
            padding-right: 4px;
          }
          .bp-analytics-product-row {
            min-width: 0;
          }
          .bp-analytics-product-main {
            display: flex;
            align-items: center;
            gap: 12px;
            min-width: 0;
          }
          .bp-analytics-product-text {
            min-width: 0;
            display: grid;
            gap: 2px;
          }
        `),
    },
  ];
}
