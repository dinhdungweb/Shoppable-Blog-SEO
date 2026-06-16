import { useCallback, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Box,
  Icon,
  Badge,
  Button,
  Divider,
  InlineGrid,
  Tabs,
  ProgressBar,
  EmptyState,
  Banner,
} from "@shopify/polaris";
import {
  BlogIcon,
  ProductIcon,
  ChartVerticalFilledIcon,
  TargetIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ViewIcon,
  CartIcon,
  SearchIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Fetch stats from database
  const [totalEmbeds, totalArticles, recentEvents, topArticles] =
    await Promise.all([
      prisma.articleProduct.count({ where: { shop, isActive: true } }),
      prisma.articleProduct.findMany({
        where: { shop },
        distinct: ["articleId"],
        select: { articleId: true },
      }),
      prisma.widgetEvent.count({
        where: {
          shop,
          createdAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        },
      }),
      prisma.articleProduct.groupBy({
        by: ["articleId", "articleTitle"],
        where: { shop, isActive: true },
        _count: { productId: true },
        orderBy: { _count: { productId: "desc" } },
        take: 5,
      }),
    ]);

  // Fetch event breakdown
  const [clicks, impressions, addToCarts] = await Promise.all([
    prisma.widgetEvent.count({
      where: {
        shop,
        eventType: "click",
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      },
    }),
    prisma.widgetEvent.count({
      where: {
        shop,
        eventType: "impression",
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      },
    }),
    prisma.widgetEvent.count({
      where: {
        shop,
        eventType: "add_to_cart",
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      },
    }),
  ]);

  // Fetch SEO stats
  const seoStats = await prisma.articleSEO.findMany({
    where: { shop },
    select: { seoScore: true, articleTitle: true, articleId: true },
    orderBy: { seoScore: "desc" },
    take: 5,
  });

  const avgSeoScore =
    seoStats.length > 0
      ? Math.round(
          seoStats.reduce((sum, s) => sum + s.seoScore, 0) / seoStats.length,
        )
      : 0;

  const ctr = impressions > 0 ? ((clicks / impressions) * 100).toFixed(1) : "0";
  const conversionRate =
    clicks > 0 ? ((addToCarts / clicks) * 100).toFixed(1) : "0";

  return {
    stats: {
      totalArticlesLinked: totalArticles.length,
      totalProductsEmbedded: totalEmbeds,
      totalClicks: clicks,
      totalImpressions: impressions,
      totalAddToCarts: addToCarts,
      ctr,
      conversionRate,
      avgSeoScore,
    },
    topArticles,
    seoStats,
    recentEvents,
  };
};

export default function Dashboard() {
  const { stats, topArticles, seoStats } = useLoaderData<typeof loader>();
  const [selectedTab, setSelectedTab] = useState(0);

  const handleTabChange = useCallback(
    (selectedTabIndex: number) => setSelectedTab(selectedTabIndex),
    [],
  );

  const tabs = [
    { id: "overview", content: "Overview" },
    { id: "performance", content: "Performance" },
  ];

  return (
    <Page>
      <TitleBar title="BP Shoppable Blog Posts" />
      <BlockStack gap="600">
        {/* Welcome Banner */}
        {stats.totalArticlesLinked === 0 && (
          <Banner
            title="Welcome to BP Shoppable Blog Posts! 🎉"
            tone="info"
            onDismiss={() => {}}
          >
            <p>
              Start by going to <strong>Blog Manager</strong> to connect
              products to your blog articles and boost your conversions.
            </p>
          </Banner>
        )}

        {/* Stats Cards */}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          <StatCard
            title="Articles Linked"
            value={stats.totalArticlesLinked.toString()}
            icon={BlogIcon}
            trend={null}
            helpText="Blog posts with products"
          />
          <StatCard
            title="Products Embedded"
            value={stats.totalProductsEmbedded.toString()}
            icon={ProductIcon}
            trend={null}
            helpText="Total product widgets"
          />
          <StatCard
            title="Widget Clicks"
            value={formatNumber(stats.totalClicks)}
            icon={ChartVerticalFilledIcon}
            trend={null}
            helpText="Last 30 days"
          />
          <StatCard
            title="Conversion Rate"
            value={`${stats.conversionRate}%`}
            icon={TargetIcon}
            trend={null}
            helpText="Click → Add to Cart"
          />
        </InlineGrid>

        {/* Main Content */}
        <Layout>
          <Layout.Section>
            <Card>
              <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange}>
                <Box paddingBlockStart="400">
                  {selectedTab === 0 ? (
                    <OverviewTab stats={stats} />
                  ) : (
                    <PerformanceTab stats={stats} />
                  )}
                </Box>
              </Tabs>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              {/* Quick Actions */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Quick Actions
                  </Text>
                  <BlockStack gap="200">
                    <Button
                      url="/app/blogs"
                      icon={ProductIcon}
                      fullWidth
                      textAlign="start"
                    >
                      Embed Products in Blog
                    </Button>
                    <Button
                      url="/app/seo"
                      icon={SearchIcon}
                      fullWidth
                      textAlign="start"
                    >
                      Analyze Blog SEO
                    </Button>
                    <Button
                      url="/app/analytics"
                      icon={ChartVerticalFilledIcon}
                      fullWidth
                      textAlign="start"
                    >
                      View Full Analytics
                    </Button>
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* SEO Score Overview */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      SEO Health
                    </Text>
                    <Badge
                      tone={
                        stats.avgSeoScore >= 80
                          ? "success"
                          : stats.avgSeoScore >= 50
                            ? "warning"
                            : "critical"
                      }
                    >
                      {stats.avgSeoScore >= 80
                        ? "Excellent"
                        : stats.avgSeoScore >= 50
                          ? "Needs Work"
                          : stats.avgSeoScore > 0
                            ? "Poor"
                            : "Not Analyzed"}
                    </Badge>
                  </InlineStack>

                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd" tone="subdued">
                        Average Score
                      </Text>
                      <Text as="span" variant="headingLg" fontWeight="bold">
                        {stats.avgSeoScore}/100
                      </Text>
                    </InlineStack>
                    <ProgressBar
                      progress={stats.avgSeoScore}
                      size="small"
                      tone={
                        stats.avgSeoScore >= 80
                          ? "success"
                          : stats.avgSeoScore >= 50
                            ? "primary"
                            : "critical"
                      }
                    />
                  </BlockStack>

                  {seoStats.length > 0 && (
                    <>
                      <Divider />
                      <BlockStack gap="200">
                        {seoStats.slice(0, 3).map((article) => (
                          <InlineStack
                            key={article.articleId}
                            align="space-between"
                            blockAlign="center"
                          >
                            <Text
                              as="span"
                              variant="bodySm"
                              truncate
                            >
                              {article.articleTitle || "Untitled"}
                            </Text>
                            <Badge
                              tone={
                                article.seoScore >= 80
                                  ? "success"
                                  : article.seoScore >= 50
                                    ? "warning"
                                    : "critical"
                              }
                            >
                              {article.seoScore.toString()}
                            </Badge>
                          </InlineStack>
                        ))}
                      </BlockStack>
                    </>
                  )}

                  <Button url="/app/seo" variant="plain" fullWidth>
                    View all SEO reports →
                  </Button>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>

        {/* Top Performing Articles */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Top Articles by Product Embeds
              </Text>
              <Button url="/app/blogs" variant="plain">
                View all →
              </Button>
            </InlineStack>

            {topArticles.length > 0 ? (
              <BlockStack gap="300">
                {topArticles.map((article, index) => (
                  <Box
                    key={article.articleId}
                    padding="300"
                    background="bg-surface-secondary"
                    borderRadius="200"
                  >
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="300" blockAlign="center">
                        <Box
                          background="bg-fill-info"
                          borderRadius="200"
                          padding="200"
                          minWidth="32px"
                        >
                          <Text
                            as="span"
                            variant="bodySm"
                            fontWeight="bold"
                            alignment="center"
                          >
                            #{index + 1}
                          </Text>
                        </Box>
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {article.articleTitle || "Untitled Article"}
                        </Text>
                      </InlineStack>
                      <Badge tone="info">
                        {`${article._count.productId} products`}
                      </Badge>
                    </InlineStack>
                  </Box>
                ))}
              </BlockStack>
            ) : (
              <EmptyState
                heading="No articles linked yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                action={{ content: "Link Products to Blog", url: "/app/blogs" }}
              >
                <p>
                  Start embedding products in your blog articles to boost
                  engagement and conversions.
                </p>
              </EmptyState>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

// ---- Sub-components ----

interface StatCardProps {
  title: string;
  value: string;
  icon: any;
  trend: { value: string; direction: "up" | "down" } | null;
  helpText: string;
}

function StatCard({ title, value, icon, trend, helpText }: StatCardProps) {
  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="span" variant="bodySm" tone="subdued">
            {title}
          </Text>
          <Box>
            <Icon source={icon} tone="subdued" />
          </Box>
        </InlineStack>
        <Text as="p" variant="headingXl" fontWeight="bold">
          {value}
        </Text>
        <InlineStack gap="200" blockAlign="center">
          {trend && (
            <InlineStack gap="100" blockAlign="center">
              <Icon
                source={trend.direction === "up" ? ArrowUpIcon : ArrowDownIcon}
                tone={trend.direction === "up" ? "success" : "critical"}
              />
              <Text
                as="span"
                variant="bodySm"
                tone={trend.direction === "up" ? "success" : "critical"}
              >
                {trend.value}
              </Text>
            </InlineStack>
          )}
          <Text as="span" variant="bodySm" tone="subdued">
            {helpText}
          </Text>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function OverviewTab({
  stats,
}: {
  stats: {
    totalImpressions: number;
    totalClicks: number;
    totalAddToCarts: number;
    ctr: string;
  };
}) {
  return (
    <BlockStack gap="400">
      <Text as="h3" variant="headingMd">
        Funnel Overview (Last 30 Days)
      </Text>
      <BlockStack gap="300">
        <FunnelStep
          label="Impressions"
          value={stats.totalImpressions}
          percentage={100}
          icon={ViewIcon}
          tone="info"
        />
        <FunnelStep
          label="Clicks"
          value={stats.totalClicks}
          percentage={
            stats.totalImpressions > 0
              ? (stats.totalClicks / stats.totalImpressions) * 100
              : 0
          }
          icon={ChartVerticalFilledIcon}
          tone="warning"
        />
        <FunnelStep
          label="Add to Cart"
          value={stats.totalAddToCarts}
          percentage={
            stats.totalImpressions > 0
              ? (stats.totalAddToCarts / stats.totalImpressions) * 100
              : 0
          }
          icon={CartIcon}
          tone="success"
        />
      </BlockStack>
      <Divider />
      <InlineGrid columns={2} gap="400">
        <Box padding="300" background="bg-surface-secondary" borderRadius="200">
          <BlockStack gap="100">
            <Text as="span" variant="bodySm" tone="subdued">
              Click-through Rate
            </Text>
            <Text as="p" variant="headingLg" fontWeight="bold">
              {stats.ctr}%
            </Text>
          </BlockStack>
        </Box>
        <Box padding="300" background="bg-surface-secondary" borderRadius="200">
          <BlockStack gap="100">
            <Text as="span" variant="bodySm" tone="subdued">
              Cart Conversion
            </Text>
            <Text as="p" variant="headingLg" fontWeight="bold">
              {stats.totalClicks > 0
                ? ((stats.totalAddToCarts / stats.totalClicks) * 100).toFixed(1)
                : "0"}
              %
            </Text>
          </BlockStack>
        </Box>
      </InlineGrid>
    </BlockStack>
  );
}

function PerformanceTab({
  stats,
}: {
  stats: {
    totalImpressions: number;
    totalClicks: number;
    totalAddToCarts: number;
  };
}) {
  const total = stats.totalImpressions + stats.totalClicks + stats.totalAddToCarts;
  return (
    <BlockStack gap="400">
      <Text as="h3" variant="headingMd">
        Event Breakdown (Last 30 Days)
      </Text>
      {total > 0 ? (
        <BlockStack gap="300">
          <MetricRow
            label="Impressions"
            value={stats.totalImpressions}
            total={total}
            tone="info"
          />
          <MetricRow
            label="Widget Clicks"
            value={stats.totalClicks}
            total={total}
            tone="warning"
          />
          <MetricRow
            label="Add to Cart"
            value={stats.totalAddToCarts}
            total={total}
            tone="success"
          />
        </BlockStack>
      ) : (
        <Box padding="600">
          <BlockStack gap="200" inlineAlign="center">
            <Icon source={ChartVerticalFilledIcon} tone="subdued" />
            <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
              No events recorded yet. Events will appear once your widgets are
              live on your storefront.
            </Text>
          </BlockStack>
        </Box>
      )}
    </BlockStack>
  );
}

function FunnelStep({
  label,
  value,
  percentage,
  icon,
  tone,
}: {
  label: string;
  value: number;
  percentage: number;
  icon: any;
  tone: "info" | "warning" | "success" | "critical";
}) {
  return (
    <Box padding="300" background="bg-surface-secondary" borderRadius="200">
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Icon source={icon} tone={tone === "warning" ? "caution" : tone} />
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {label}
            </Text>
          </InlineStack>
          <Text as="span" variant="headingMd" fontWeight="bold">
            {formatNumber(value)}
          </Text>
        </InlineStack>
        <ProgressBar
          progress={Math.min(percentage, 100)}
          size="small"
          tone={getProgressTone(tone)}
        />
      </BlockStack>
    </Box>
  );
}

function MetricRow({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: "info" | "warning" | "success" | "critical";
}) {
  const percentage = total > 0 ? ((value / total) * 100).toFixed(0) : "0";
  return (
    <InlineStack align="space-between" blockAlign="center">
      <InlineStack gap="200" blockAlign="center">
        <Box
          borderRadius="100"
          padding="100"
          background={
            tone === "success"
              ? "bg-fill-success"
              : tone === "warning"
                ? "bg-fill-caution"
                : "bg-fill-info"
          }
        >
          <Box minWidth="8px" minHeight="8px" />
        </Box>
        <Text as="span" variant="bodyMd">
          {label}
        </Text>
      </InlineStack>
      <InlineStack gap="200" blockAlign="center">
        <Text as="span" variant="bodyMd" fontWeight="bold">
          {formatNumber(value)}
        </Text>
        <Text as="span" variant="bodySm" tone="subdued">
          ({percentage}%)
        </Text>
      </InlineStack>
    </InlineStack>
  );
}

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

function getProgressTone(
  tone: "info" | "warning" | "success" | "critical",
): "primary" | "success" | "critical" {
  if (tone === "success" || tone === "critical") return tone;
  return "primary";
}
