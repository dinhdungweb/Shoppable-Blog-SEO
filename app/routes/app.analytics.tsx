import { useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  EmptyState,
  IndexTable,
  ProgressBar,
  InlineGrid,
  InlineStack,
  Select,
  Text,
} from "@shopify/polaris";
import { AlertTriangleIcon, ChartVerticalIcon, ExportIcon, InfoIcon } from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import { allowedRanges, loadAnalyticsReport, resolveRange } from "../analytics.server";
import { formatMoney, rate } from "../analytics-core";
import { articleAnalyticsUrl } from "../analytics-insights";
import {
  ANALYTICS_CSS,
  EngagementChart,
  Funnel,
  KpiCard,
  RevenueNote,
  Thumbnail,
  formatNumber,
  formatPercent,
  trend,
} from "../components/AnalyticsWidgets";
import { AppPage } from "../components/AppPage";
import { ANALYTICS_WORKSPACE_TABS } from "../components/WorkspaceTabs";
import { ActionRow, ActionRows, Pill } from "../components/rm";

const PLACEHOLDER_IMAGE = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";
const MAX_POST_ROWS = 50;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const startedAt = Date.now();
  const { admin, session, billing } = await authenticate.admin(request);
  const { limits, planKey } = await getActivePlanAndLimits(billing, session.shop);
  const days = resolveRange(new URL(request.url).searchParams.get("range"), limits.analyticsWindowDays);
  const report = await loadAnalyticsReport({ admin, shop: session.shop, days });
  console.info("Insights loader timing", { shop: session.shop, days, posts: report.posts.length, durationMs: Date.now() - startedAt });
  return json({
    ...report,
    posts: report.posts.slice(0, MAX_POST_ROWS),
    totalPosts: report.posts.length,
    products: report.products.slice(0, 10),
    ranges: allowedRanges(limits.analyticsWindowDays),
    maxDays: limits.analyticsWindowDays,
    planKey,
  });
};

export default function Insights() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const shopify = useAppBridge();
  const [exporting, setExporting] = useState(false);
  const { metrics, previous, kpis, previousKpis, currency } = data;
  const money = (value: number) => formatMoney(value, currency);
  const hasData = metrics.views || metrics.impressions || metrics.clicks || metrics.purchases;

  const exportCsv = async () => {
    setExporting(true);
    try {
      // App Bridge adds the session token to same-origin fetch requests.
      const response = await fetch(`/app/analytics/export?range=${data.days}`);
      if (!response.ok) throw new Error(`Export failed (${response.status})`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `blog-insights-${data.range.start}-to-${data.range.end}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      shopify.toast.show(error instanceof Error ? error.message : "Export failed", { isError: true });
    } finally {
      setExporting(false);
    }
  };

  const rangeOptions = data.ranges.map((days) => ({ label: `Last ${days} days`, value: String(days) }));

  return (
    <AppPage
      title="Analytics"
      subtitle="How blog readers become customers: from Google, to the article, to the products you linked, to orders."
      fullWidth
      tabs={{ items: ANALYTICS_WORKSPACE_TABS, activeId: "overview" }}
      secondaryActions={[{ content: "Export CSV", icon: ExportIcon, onAction: exportCsv, loading: exporting, disabled: !data.totalPosts }]}
    >
      <BlockStack gap="500">
        <InlineStack align="end" blockAlign="center" gap="300">
          <InlineStack gap="200" blockAlign="center">
            <div style={{ minWidth: 170 }}>
              <Select
                label="Date range"
                labelHidden
                options={rangeOptions}
                value={String(data.days)}
                onChange={(value) => {
                  const next = new URLSearchParams(searchParams);
                  next.set("range", value);
                  setSearchParams(next);
                }}
              />
            </div>
          </InlineStack>
        </InlineStack>

        {data.maxDays < 365 && (
          <Text as="p" variant="bodySm" tone="subdued">
            Your plan includes {data.maxDays} days of history. <Button variant="plain" url={`/app/pricing?reason=analytics&plan=${data.planKey}`}>Upgrade for longer history</Button>
          </Text>
        )}

        <InlineGrid columns={{ xs: 2, sm: 3, lg: 6 }} gap="400">
          <KpiCard title="Readers" value={formatNumber(metrics.views)} change={trend(metrics.views, previous.views)} spark={data.chart.map((day) => day.views)} hint="Article views on posts with a shoppable widget, counted once per session." />
          <KpiCard title="Product clicks" value={formatNumber(metrics.clicks)} change={trend(metrics.clicks, previous.clicks)} spark={data.chart.map((day) => day.clicks)} />
          <KpiCard title="Add to carts" value={formatNumber(metrics.addToCarts)} change={trend(metrics.addToCarts, previous.addToCarts)} spark={data.chart.map((day) => day.addToCarts)} />
          <KpiCard title="Orders" value={formatNumber(metrics.purchases)} change={trend(metrics.purchases, previous.purchases)} spark={data.chart.map((day) => day.purchases)} color="#50B83C" hint={`${formatNumber(metrics.units)} units`} />
          <KpiCard title="Revenue" value={money(metrics.revenue)} change={trend(metrics.revenue, previous.revenue)} spark={data.chart.map((day) => day.revenue)} color="#50B83C" hint="Amount paid for products shoppers clicked in a blog post, within your attribution window." />
          <KpiCard title="Revenue per 1,000 readers" value={money(kpis.revenuePerThousandReaders)} change={trend(kpis.revenuePerThousandReaders, previousKpis.revenuePerThousandReaders)} hint="Revenue divided by readers, per 1,000. Compare posts and periods with it." />
        </InlineGrid>
        <RevenueNote estimated={metrics.estimatedRevenue} otherCurrencies={metrics.otherCurrencies} currency={currency} />

        <InlineGrid columns={{ xs: 1, md: "1fr 2fr" }} gap="400">
          <Card padding="400">
            <BlockStack gap="400">
              <BlockStack gap="050">
                <Text as="h2" variant="headingMd" fontWeight="bold">Reader funnel</Text>
                <Text as="p" variant="bodySm" tone="subdued">Conversion: {formatPercent(kpis.conversionRate)} of readers ordered ({trend(kpis.conversionRate, previousKpis.conversionRate, "pp").label})</Text>
              </BlockStack>
              <Funnel steps={[
                ...(data.google.connected ? [
                  { label: "Google impressions", value: data.google.impressions, hint: `Search Console, last ${data.google.windowDays} days (posts listed below)` },
                  { label: "Google clicks", value: data.google.clicks, hint: `Search Console, last ${data.google.windowDays} days` },
                ] : []),
                { label: "Readers", value: metrics.views },
                { label: "Saw products", value: metrics.seen, hint: "Readers whose shoppable widget was at least 50% visible for one second." },
                { label: "Clicked a product", value: metrics.clicks },
                { label: "Added to cart", value: metrics.addToCarts },
                { label: "Ordered", value: metrics.purchases },
              ]} />
              {!data.google.connected && (
                <Text as="p" variant="bodySm" tone="subdued">
                  <Button variant="plain" url="/app/settings?tab=integrations">Connect Google Search Console</Button> to start the funnel at Google search.
                </Text>
              )}
            </BlockStack>
          </Card>

          <Card padding="400">
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd" fontWeight="bold">Over time</Text>
                <Badge tone="info">{`${data.range.start} → ${data.range.end}`}</Badge>
              </InlineStack>
              {hasData ? <EngagementChart data={data.chart} /> : (
                <EmptyState heading="No tracking data yet" image={PLACEHOLDER_IMAGE} action={{ content: "Check theme setup", onAction: () => navigate("/app/theme-setup") }}>
                  <p>Data appears after readers open posts that contain a shoppable widget.</p>
                </EmptyState>
              )}
            </BlockStack>
          </Card>
        </InlineGrid>

        <InlineGrid columns={{ xs: 1, md: "2fr 1fr" }} gap="400">
          <Card padding="0">
            <Box padding="400"><Text as="h2" variant="headingMd">What to improve</Text></Box>
            {data.insights.length ? (
              <ActionRows>
                {data.insights.map((insight) => (
                  <ActionRow
                    key={insight.id}
                    icon={insight.tone === "success" ? ChartVerticalIcon : insight.tone === "warning" ? AlertTriangleIcon : InfoIcon}
                    iconTone={insight.tone === "success" ? "good" : insight.tone === "warning" ? "warn" : "brand"}
                    title={insight.title}
                    text={insight.detail}
                    aside={<>
                      <Pill tone={insight.tone === "success" ? "good" : insight.tone === "warning" ? "warn" : "brand"}>{insight.tone === "success" ? "Opportunity" : insight.tone === "warning" ? "Fix" : "Review"}</Pill>
                      <Button size="slim" onClick={() => navigate(insight.url)}>{insight.actionLabel}</Button>
                    </>}
                  />
                ))}
              </ActionRows>
            ) : (
              <Box padding="400" paddingBlockStart="0"><Text as="p" tone="subdued">Recommendations appear once posts have enough readers (about 100 per post) to be reliable.</Text></Box>
            )}
          </Card>

          <Card padding="400">
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd" fontWeight="bold">Where readers come from</Text>
              {data.channels.length ? data.channels.map((channel) => (
                <BlockStack key={channel.name} gap="050">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm">{channel.name}</Text>
                    <Text as="span" variant="bodySm" fontWeight="semibold">{formatNumber(channel.sessions)} · {formatPercent(channel.percent)}</Text>
                  </InlineStack>
                  <ProgressBar progress={Math.min(100, channel.percent)} size="small" />
                </BlockStack>
              )) : <Text as="p" tone="subdued">No sessions yet.</Text>}
              <Text as="p" variant="bodySm" tone="subdued">Sessions by the site that sent the reader to the post. Orders keep the source of the reading session.</Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        <Card padding="0">
          <Box padding="400" paddingBlockEnd="200">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd" fontWeight="bold">Posts</Text>
              <Text as="span" variant="bodySm" tone="subdued">{data.totalPosts > data.posts.length ? `Top ${data.posts.length} of ${data.totalPosts} · export for all` : `${data.totalPosts} posts`}</Text>
            </InlineStack>
          </Box>
          {data.posts.length ? (
            <div className="bp-analytics-table-scroll">
              <IndexTable
                resourceName={{ singular: "post", plural: "posts" }}
                itemCount={data.posts.length}
                selectable={false}
                headings={[
                  { title: "Post" },
                  { title: "Readers", alignment: "end" },
                  { title: "Saw products", alignment: "end" },
                  { title: "Product CTR", alignment: "end" },
                  { title: "Orders", alignment: "end" },
                  { title: "Revenue", alignment: "end" },
                  { title: "Per 1k readers", alignment: "end" },
                  { title: "Google clicks", alignment: "end" },
                ]}
              >
                {data.posts.map((post, index) => (
                  <IndexTable.Row id={post.id} key={post.id} position={index} onClick={() => navigate(articleAnalyticsUrl(post.id))}>
                    <IndexTable.Cell>
                      <div className="bp-analytics-post-cell">
                        <Thumbnail source={post.image} alt={post.imageAlt || post.title} />
                        <div className="bp-analytics-post-text">
                          <Text as="span" fontWeight="semibold" truncate>{post.title}</Text>
                          <Text as="span" variant="bodySm" tone="subdued" truncate>{post.productCount ? `${post.productCount} products · ${post.blogTitle}` : `No products · ${post.blogTitle}`}</Text>
                        </div>
                      </div>
                    </IndexTable.Cell>
                    <IndexTable.Cell><Text as="span" alignment="end" numeric>{formatNumber(post.metrics.views)}</Text></IndexTable.Cell>
                    <IndexTable.Cell><Text as="span" alignment="end" numeric>{post.metrics.views ? formatPercent(post.kpis.productVisibility) : "—"}</Text></IndexTable.Cell>
                    <IndexTable.Cell><Text as="span" alignment="end" numeric>{post.metrics.impressions ? formatPercent(post.kpis.productCtr) : "—"}</Text></IndexTable.Cell>
                    <IndexTable.Cell><Text as="span" alignment="end" numeric>{formatNumber(post.metrics.purchases)}</Text></IndexTable.Cell>
                    <IndexTable.Cell><Text as="span" alignment="end" numeric>{money(post.metrics.revenue)}</Text></IndexTable.Cell>
                    <IndexTable.Cell><Text as="span" alignment="end" numeric>{post.metrics.views ? money(post.kpis.revenuePerThousandReaders) : "—"}</Text></IndexTable.Cell>
                    <IndexTable.Cell><Text as="span" alignment="end" numeric tone={post.google ? undefined : "subdued"}>{post.google ? `${formatNumber(post.google.clicks)} (${formatPercent(rate(post.google.clicks, post.google.impressions))})` : "—"}</Text></IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            </div>
          ) : (
            <Box padding="600">
              <EmptyState heading="No post analytics yet" image={PLACEHOLDER_IMAGE} action={{ content: "Link products to posts", onAction: () => navigate("/app/blogs") }}>
                <p>Link products to posts and add the widget to your theme to start collecting analytics.</p>
              </EmptyState>
            </Box>
          )}
        </Card>

        <Card padding="400">
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd" fontWeight="bold">Products sold through blog posts</Text>
            {data.products.length ? (
              <div className="bp-analytics-product-list">
                {data.products.map((product) => (
                  <InlineStack key={product.id} align="space-between" blockAlign="center" gap="300" wrap={false}>
                    <div className="bp-analytics-product-main">
                      <Thumbnail source={product.image} alt={product.title} />
                      <div className="bp-analytics-product-text">
                        <Text as="p" fontWeight="semibold" truncate>{product.title}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">{formatNumber(product.metrics.clicks)} clicks · {formatNumber(product.metrics.addToCarts)} add to carts · {formatNumber(product.metrics.purchases)} orders</Text>
                      </div>
                    </div>
                    <Text as="span" fontWeight="semibold">{money(product.metrics.revenue)}</Text>
                  </InlineStack>
                ))}
              </div>
            ) : <Text as="p" tone="subdued">Products appear after shoppers click them in a blog post.</Text>}
          </BlockStack>
        </Card>
      </BlockStack>
    </AppPage>
  );
}

export function links() {
  return [{ rel: "stylesheet", href: `data:text/css,${encodeURIComponent(ANALYTICS_CSS)}` }];
}
