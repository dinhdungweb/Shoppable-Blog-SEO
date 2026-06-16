import { useCallback, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Box,
  Badge,
  IndexTable,
  EmptyState,
  ProgressBar,
  InlineGrid,
  Icon,
  Select,
  Tabs,
} from "@shopify/polaris";
import {
  ViewIcon,
  ChartVerticalFilledIcon,
  CartIcon,
  TargetIcon,
  ArrowUpIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get("days") || "30");

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Get event counts by type
  const [impressions, clicks, addToCarts, purchases] = await Promise.all([
    prisma.widgetEvent.count({
      where: { shop, eventType: "impression", createdAt: { gte: since } },
    }),
    prisma.widgetEvent.count({
      where: { shop, eventType: "click", createdAt: { gte: since } },
    }),
    prisma.widgetEvent.count({
      where: { shop, eventType: "add_to_cart", createdAt: { gte: since } },
    }),
    prisma.widgetEvent.count({
      where: { shop, eventType: "purchase", createdAt: { gte: since } },
    }),
  ]);

  // Top articles by clicks
  const topArticlesByClicks = await prisma.widgetEvent.groupBy({
    by: ["articleId"],
    where: { shop, eventType: "click", createdAt: { gte: since } },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 10,
  });

  // Fetch article titles for top articles
  const articleIds = topArticlesByClicks.map((a) => a.articleId);
  const articleProducts = await prisma.articleProduct.findMany({
    where: { articleId: { in: articleIds } },
    distinct: ["articleId"],
    select: { articleId: true, articleTitle: true },
  });
  const articleTitleMap = new Map(
    articleProducts.map((a) => [a.articleId, a.articleTitle]),
  );

  const topArticles = topArticlesByClicks.map((a) => ({
    articleId: a.articleId,
    articleTitle: articleTitleMap.get(a.articleId) || "Unknown Article",
    clicks: a._count.id,
  }));

  // Top products by clicks
  const topProductsByClicks = await prisma.widgetEvent.groupBy({
    by: ["productId"],
    where: { shop, eventType: "click", createdAt: { gte: since } },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 10,
  });

  const productIds = topProductsByClicks.map((p) => p.productId);
  const productData = await prisma.articleProduct.findMany({
    where: { productId: { in: productIds } },
    distinct: ["productId"],
    select: { productId: true, productTitle: true },
  });
  const productTitleMap = new Map(
    productData.map((p) => [p.productId, p.productTitle]),
  );

  const topProducts = topProductsByClicks.map((p) => ({
    productId: p.productId,
    productTitle: productTitleMap.get(p.productId) || "Unknown Product",
    clicks: p._count.id,
  }));

  // Daily breakdown (last N days)
  const dailyEvents = await prisma.widgetEvent.findMany({
    where: { shop, createdAt: { gte: since } },
    select: { eventType: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  // Group by day
  const dailyMap = new Map<
    string,
    { impressions: number; clicks: number; addToCarts: number }
  >();

  for (const event of dailyEvents) {
    const day = event.createdAt.toISOString().split("T")[0];
    if (!dailyMap.has(day)) {
      dailyMap.set(day, { impressions: 0, clicks: 0, addToCarts: 0 });
    }
    const entry = dailyMap.get(day)!;
    if (event.eventType === "impression") entry.impressions++;
    if (event.eventType === "click") entry.clicks++;
    if (event.eventType === "add_to_cart") entry.addToCarts++;
  }

  const dailyData = Array.from(dailyMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    stats: {
      impressions,
      clicks,
      addToCarts,
      purchases,
      ctr: impressions > 0 ? ((clicks / impressions) * 100).toFixed(1) : "0",
      conversionRate:
        clicks > 0 ? ((addToCarts / clicks) * 100).toFixed(1) : "0",
    },
    topArticles,
    topProducts,
    dailyData,
    days,
  };
};

export default function Analytics() {
  const { stats, topArticles, topProducts, dailyData, days } =
    useLoaderData<typeof loader>();
  const [selectedTab, setSelectedTab] = useState(0);

  const handleTabChange = useCallback(
    (index: number) => setSelectedTab(index),
    [],
  );

  const tabs = [
    { id: "articles", content: "Top Articles" },
    { id: "products", content: "Top Products" },
    { id: "daily", content: "Daily Breakdown" },
  ];

  const maxClicks = Math.max(
    ...topArticles.map((a) => a.clicks),
    1,
  );
  const maxProductClicks = Math.max(
    ...topProducts.map((p) => p.clicks),
    1,
  );

  return (
    <Page>
      <TitleBar title="Analytics" />
      <BlockStack gap="500">
        {/* Period Selector */}
        <InlineStack align="end">
          <Select
            label=""
            labelHidden
            options={[
              { label: "Last 7 days", value: "7" },
              { label: "Last 30 days", value: "30" },
              { label: "Last 90 days", value: "90" },
            ]}
            value={days.toString()}
            onChange={(value) => {
              window.location.href = `/app/analytics?days=${value}`;
            }}
          />
        </InlineStack>

        {/* Main Stats */}
        <InlineGrid columns={{ xs: 2, sm: 3, md: 6 }} gap="400">
          <StatCard
            title="Impressions"
            value={formatNumber(stats.impressions)}
            icon={ViewIcon}
          />
          <StatCard
            title="Clicks"
            value={formatNumber(stats.clicks)}
            icon={ChartVerticalFilledIcon}
          />
          <StatCard
            title="Add to Cart"
            value={formatNumber(stats.addToCarts)}
            icon={CartIcon}
          />
          <StatCard
            title="Purchases"
            value={formatNumber(stats.purchases)}
            icon={TargetIcon}
          />
          <StatCard
            title="CTR"
            value={`${stats.ctr}%`}
            icon={ArrowUpIcon}
          />
          <StatCard
            title="Conversion"
            value={`${stats.conversionRate}%`}
            icon={TargetIcon}
          />
        </InlineGrid>

        {/* Funnel Visualization */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Conversion Funnel
            </Text>
            <BlockStack gap="300">
              <FunnelBar
                label="Impressions"
                value={stats.impressions}
                maxValue={stats.impressions}
                tone="info"
              />
              <FunnelBar
                label="Clicks"
                value={stats.clicks}
                maxValue={stats.impressions}
                tone="warning"
              />
              <FunnelBar
                label="Add to Cart"
                value={stats.addToCarts}
                maxValue={stats.impressions}
                tone="success"
              />
              <FunnelBar
                label="Purchases"
                value={stats.purchases}
                maxValue={stats.impressions}
                tone="success"
              />
            </BlockStack>
          </BlockStack>
        </Card>

        {/* Detailed Data */}
        <Card>
          <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange}>
            <Box paddingBlockStart="400">
              {selectedTab === 0 && (
                <BlockStack gap="300">
                  {topArticles.length > 0 ? (
                    topArticles.map((article, index) => (
                      <Box
                        key={article.articleId}
                        padding="300"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <BlockStack gap="200">
                          <InlineStack
                            align="space-between"
                            blockAlign="center"
                          >
                            <InlineStack gap="200" blockAlign="center">
                              <Text
                                as="span"
                                variant="bodySm"
                                tone="subdued"
                              >
                                #{index + 1}
                              </Text>
                              <Text
                                as="span"
                                variant="bodyMd"
                                fontWeight="semibold"
                              >
                                {article.articleTitle}
                              </Text>
                            </InlineStack>
                            <Badge tone="info">
                              {`${article.clicks} clicks`}
                            </Badge>
                          </InlineStack>
                          <ProgressBar
                            progress={(article.clicks / maxClicks) * 100}
                            size="small"
                            tone="primary"
                          />
                        </BlockStack>
                      </Box>
                    ))
                  ) : (
                    <EmptyState
                      heading="No click data yet"
                      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    >
                      <p>
                        Click data will appear once your product widgets are
                        live and visitors start interacting with them.
                      </p>
                    </EmptyState>
                  )}
                </BlockStack>
              )}

              {selectedTab === 1 && (
                <BlockStack gap="300">
                  {topProducts.length > 0 ? (
                    topProducts.map((product, index) => (
                      <Box
                        key={product.productId}
                        padding="300"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <BlockStack gap="200">
                          <InlineStack
                            align="space-between"
                            blockAlign="center"
                          >
                            <InlineStack gap="200" blockAlign="center">
                              <Text
                                as="span"
                                variant="bodySm"
                                tone="subdued"
                              >
                                #{index + 1}
                              </Text>
                              <Text
                                as="span"
                                variant="bodyMd"
                                fontWeight="semibold"
                              >
                                {product.productTitle}
                              </Text>
                            </InlineStack>
                            <Badge tone="success">
                              {`${product.clicks} clicks`}
                            </Badge>
                          </InlineStack>
                          <ProgressBar
                            progress={
                              (product.clicks / maxProductClicks) * 100
                            }
                            size="small"
                            tone="success"
                          />
                        </BlockStack>
                      </Box>
                    ))
                  ) : (
                    <EmptyState
                      heading="No product click data yet"
                      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    >
                      <p>Product click data will appear here.</p>
                    </EmptyState>
                  )}
                </BlockStack>
              )}

              {selectedTab === 2 && (
                <BlockStack gap="300">
                  {dailyData.length > 0 ? (
                    <IndexTable
                      resourceName={{
                        singular: "day",
                        plural: "days",
                      }}
                      itemCount={dailyData.length}
                      headings={[
                        { title: "Date" },
                        { title: "Impressions" },
                        { title: "Clicks" },
                        { title: "Add to Cart" },
                        { title: "CTR" },
                      ]}
                      selectable={false}
                    >
                      {dailyData.map((day, index) => (
                        <IndexTable.Row
                          id={day.date}
                          key={day.date}
                          position={index}
                        >
                          <IndexTable.Cell>
                            <Text as="span" variant="bodyMd">
                              {new Date(day.date).toLocaleDateString("vi-VN")}
                            </Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Text as="span" variant="bodyMd">
                              {day.impressions}
                            </Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Text as="span" variant="bodyMd">
                              {day.clicks}
                            </Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Text as="span" variant="bodyMd">
                              {day.addToCarts}
                            </Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Badge
                              tone={
                                day.impressions > 0 &&
                                (day.clicks / day.impressions) * 100 > 3
                                  ? "success"
                                  : undefined
                              }
                            >
                              {day.impressions > 0
                                ? (
                                    (day.clicks / day.impressions) *
                                    100
                                  ).toFixed(1) + "%"
                                : "0%"}
                            </Badge>
                          </IndexTable.Cell>
                        </IndexTable.Row>
                      ))}
                    </IndexTable>
                  ) : (
                    <EmptyState
                      heading="No daily data yet"
                      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    >
                      <p>Daily event data will appear here.</p>
                    </EmptyState>
                  )}
                </BlockStack>
              )}
            </Box>
          </Tabs>
        </Card>
      </BlockStack>
    </Page>
  );
}

function StatCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: string;
  icon: any;
}) {
  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="span" variant="bodySm" tone="subdued">
            {title}
          </Text>
          <Icon source={icon} tone="subdued" />
        </InlineStack>
        <Text as="p" variant="headingLg" fontWeight="bold">
          {value}
        </Text>
      </BlockStack>
    </Card>
  );
}

function FunnelBar({
  label,
  value,
  maxValue,
  tone,
}: {
  label: string;
  value: number;
  maxValue: number;
  tone: "info" | "warning" | "success" | "critical";
}) {
  const percentage = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <Box padding="300" background="bg-surface-secondary" borderRadius="200">
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {label}
          </Text>
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" variant="bodyMd" fontWeight="bold">
              {formatNumber(value)}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              ({percentage.toFixed(1)}%)
            </Text>
          </InlineStack>
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
