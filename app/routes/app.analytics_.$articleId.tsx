import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import { BlockStack, Button, Card, InlineGrid, InlineStack, Page, Select, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import { allowedRanges, loadAnalyticsReport, resolveRange } from "../analytics.server";
import { emptyMetrics, formatMoney, rate } from "../analytics-core";
import { articleEditorUrl, postKpis } from "../analytics-insights";
import { ANALYTICS_CSS, EngagementChart, Funnel, KpiCard, RevenueNote, Thumbnail, formatNumber, formatPercent, trend } from "../components/AnalyticsWidgets";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const rawId = decodeURIComponent(params.articleId || "");
  if (!/^\d+$/.test(rawId) && !rawId.startsWith("gid://shopify/Article/")) throw new Response("Article not found", { status: 404 });
  const articleId = rawId.startsWith("gid://") ? rawId : `gid://shopify/Article/${rawId}`;
  const { limits } = await getActivePlanAndLimits(billing, shop);
  const days = resolveRange(new URL(request.url).searchParams.get("range"), limits.analyticsWindowDays);

  const [report, seo] = await Promise.all([
    loadAnalyticsReport({ admin, shop, days, articleId }),
    prisma.articleSEO.findUnique({ where: { shop_articleId: { shop, articleId } }, select: { articleTitle: true, blogTitle: true, blogHandle: true, articleHandle: true, imageUrl: true, focusKeyword: true } }),
  ]);
  const post = report.posts[0] || null;
  const title = post?.title || seo?.articleTitle || "Untitled post";

  // Top Google queries for this article (Search Console, closest synced window).
  const path = seo?.blogHandle && seo.articleHandle ? `/blogs/${seo.blogHandle}/${seo.articleHandle}` : "";
  const connection = path ? await prisma.searchConsoleConnection.findUnique({ where: { shop }, select: { selectedSiteUrl: true } }).catch(() => null) : null;
  const queries = connection?.selectedSiteUrl
    ? await prisma.searchConsoleMetric.findMany({
        where: {
          shop, siteUrl: connection.selectedSiteUrl, windowDays: report.google.windowDays || 28, period: "current", query: { not: "" },
          OR: [{ pageUrl: { endsWith: path } }, { pageUrl: { endsWith: `${path}/` } }],
        },
        orderBy: { impressions: "desc" },
        take: 10,
        select: { query: true, clicks: true, impressions: true, position: true },
      }).catch(() => [])
    : [];

  return json({
    report: { ...report, posts: [] },
    post,
    title,
    blogTitle: post?.blogTitle || seo?.blogTitle || "Blog",
    image: post?.image || seo?.imageUrl || "",
    articleId,
    products: report.products,
    queries,
    ranges: allowedRanges(limits.analyticsWindowDays),
  });
};

export default function ArticleAnalytics() {
  const { report, post, title, blogTitle, image, articleId, products, queries, ranges } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const money = (value: number) => formatMoney(value, report.currency);
  // The report is filtered to this article, so its totals and previous period are the article's own.
  const metrics = report.metrics || post?.metrics || emptyMetrics();
  const previous = report.previous;
  const kpis = postKpis(metrics);
  const previousKpis = postKpis(previous);

  return (
    <Page
      fullWidth
      backAction={{ content: "Analytics", onAction: () => navigate(`/app/analytics?range=${report.days}`) }}
      title={title}
      subtitle={`${blogTitle} · ${report.range.start} → ${report.range.end}`}
      primaryAction={{ content: "Edit post", onAction: () => navigate(articleEditorUrl(articleId)) }}
    >
      <TitleBar title={title} />
      <BlockStack gap="500">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="300" blockAlign="center">
            <Thumbnail source={image} alt={title} />
            <Text as="p" tone="subdued">{post?.productCount ? `${post.productCount} linked products` : "No linked products"}{post?.seoScore != null ? ` · SEO score ${post.seoScore}` : ""}</Text>
          </InlineStack>
          <div style={{ minWidth: 170 }}>
            <Select label="Date range" labelHidden options={ranges.map((days) => ({ label: `Last ${days} days`, value: String(days) }))} value={String(report.days)}
              onChange={(value) => { const next = new URLSearchParams(searchParams); next.set("range", value); setSearchParams(next); }} />
          </div>
        </InlineStack>

        <InlineGrid columns={{ xs: 2, md: 5 }} gap="400">
          <KpiCard title="Readers" value={formatNumber(metrics.views)} change={trend(metrics.views, previous.views)} spark={report.chart.map((day) => day.views)} />
          <KpiCard title="Saw products" value={formatPercent(kpis.productVisibility)} change={trend(kpis.productVisibility, previousKpis.productVisibility, "pp")} hint="Share of readers who scrolled to the products." />
          <KpiCard title="Product CTR" value={formatPercent(kpis.productCtr)} change={trend(kpis.productCtr, previousKpis.productCtr, "pp")} />
          <KpiCard title="Orders" value={formatNumber(metrics.purchases)} change={trend(metrics.purchases, previous.purchases)} spark={report.chart.map((day) => day.purchases)} color="#50B83C" />
          <KpiCard title="Revenue" value={money(metrics.revenue)} change={trend(metrics.revenue, previous.revenue)} hint={`${money(kpis.revenuePerThousandReaders)} per 1,000 readers`} color="#50B83C" spark={report.chart.map((day) => day.revenue)} />
        </InlineGrid>
        <RevenueNote estimated={metrics.estimatedRevenue} otherCurrencies={metrics.otherCurrencies} currency={report.currency} />

        <InlineGrid columns={{ xs: 1, md: "1fr 2fr" }} gap="400">
          <Card padding="400">
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd" fontWeight="bold">Funnel</Text>
              <Funnel steps={[
                ...(post?.google ? [{ label: "Google impressions", value: post.google.impressions }, { label: "Google clicks", value: post.google.clicks }] : []),
                { label: "Readers", value: metrics.views },
                { label: "Saw products", value: metrics.seen },
                { label: "Clicked a product", value: metrics.clicks },
                { label: "Added to cart", value: metrics.addToCarts },
                { label: "Ordered", value: metrics.purchases },
              ]} />
            </BlockStack>
          </Card>
          <Card padding="400">
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd" fontWeight="bold">Over time</Text>
              <EngagementChart data={report.chart} />
            </BlockStack>
          </Card>
        </InlineGrid>

        <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
          <Card padding="400">
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd" fontWeight="bold">Products in this post</Text>
              {products.length ? products.map((product) => (
                <InlineStack key={product.id} align="space-between" blockAlign="center" gap="200" wrap={false}>
                  <BlockStack gap="050">
                    <Text as="span" fontWeight="semibold" truncate>{product.title}</Text>
                    <Text as="span" variant="bodySm" tone="subdued">{formatNumber(product.metrics.clicks)} clicks · {formatNumber(product.metrics.addToCarts)} carts · {formatNumber(product.metrics.purchases)} orders</Text>
                  </BlockStack>
                  <Text as="span" fontWeight="semibold">{money(product.metrics.revenue)}</Text>
                </InlineStack>
              )) : <Text as="p" tone="subdued">No product clicks in this period.</Text>}
            </BlockStack>
          </Card>
          <Card padding="400">
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd" fontWeight="bold">Traffic sources</Text>
              {report.channels.length ? report.channels.map((channel) => (
                <InlineStack key={channel.name} align="space-between">
                  <Text as="span" variant="bodySm">{channel.name}</Text>
                  <Text as="span" variant="bodySm" fontWeight="semibold">{formatNumber(channel.sessions)} · {formatPercent(channel.percent)}</Text>
                </InlineStack>
              )) : <Text as="p" tone="subdued">No sessions yet.</Text>}
            </BlockStack>
          </Card>
          <Card padding="400">
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd" fontWeight="bold">Top Google queries</Text>
              {queries.length ? queries.map((row) => (
                <InlineStack key={row.query} align="space-between" gap="200" wrap={false}>
                  <Text as="span" variant="bodySm" truncate>{row.query}</Text>
                  <Text as="span" variant="bodySm" tone="subdued">{formatNumber(row.clicks)} / {formatNumber(row.impressions)} · {formatPercent(rate(row.clicks, row.impressions))} · #{row.position.toFixed(1)}</Text>
                </InlineStack>
              )) : (
                <BlockStack gap="200">
                  <Text as="p" tone="subdued">No Search Console data for this post.</Text>
                  {!report.google.connected && <InlineStack><Button variant="plain" url="/app/settings?tab=integrations">Connect Google Search Console</Button></InlineStack>}
                </BlockStack>
              )}
              {queries.length > 0 && <Text as="p" variant="bodySm" tone="subdued">Clicks / impressions · CTR · average position, last {report.google.windowDays || 28} days.</Text>}
            </BlockStack>
          </Card>
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}

export function links() {
  return [{ rel: "stylesheet", href: `data:text/css,${encodeURIComponent(ANALYTICS_CSS)}` }];
}
