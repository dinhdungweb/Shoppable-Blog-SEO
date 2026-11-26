import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import type { Prisma } from "@prisma/client";
import { Badge, Banner, BlockStack, Box, Button, Card, Divider, EmptyState, IndexTable, InlineStack, Select, Text } from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { analyzeContentDecay } from "../content-decay";
import type { ContentDecayReport, DecayArticle, DecayIssue, DecayProduct } from "../content-decay";
import prisma from "../db.server";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import { fetchShopDomains } from "../shopify-domains.server";
import { isPublicHostname, isPublicUrlReachable } from "../safe-fetch.server";
import { loadSearchConsoleView } from "../search-console-view.server";
import { SearchConsoleCard } from "../components/SearchConsoleCard";
import { ANALYTICS_WORKSPACE_TABS } from "../components/WorkspaceTabs";
import { AppPage } from "../components/AppPage";
import { StatTile, StatTiles } from "../components/rm";

const EMPTY_IMAGE = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";
const MAX_EXTERNAL_LINKS = 30;
const ISSUE_PAGE_SIZE = 20;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const { limits, planKey } = await getActivePlanAndLimits(billing, session.shop);
  const searchConsole = await loadSearchConsoleView(session.shop, limits.canSearchConsole);
  if (!limits.canContentDecay) return json({ report: null, analyzedAt: null, canContentDecay: false, planKey, searchConsole });
  const saved = await prisma.contentDecayAnalysis.findUnique({ where: { shop: session.shop } });
  const report = saved?.report as unknown as ContentDecayReport | undefined;
  return json({ report: report?.version === 1 ? report : null, analyzedAt: saved?.analyzedAt.toISOString() || null, canContentDecay: true, planKey, searchConsole });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const { limits } = await getActivePlanAndLimits(billing, session.shop);
  if (!limits.canContentDecay) return json({ error: "Content Decay Monitor is available on the Growth plan." }, { status: 403 });
  const formData = await request.formData();
  if (String(formData.get("intent") || "") !== "analyze") return json({ error: "Unsupported action." }, { status: 400 });
  try {
    const searchConnection = await prisma.searchConsoleConnection.findUnique({ where: { shop: session.shop }, select: { selectedSiteUrl: true } });
    const [articles, linkedProducts, metrics, config, shopDomains] = await Promise.all([
      fetchArticles(admin),
      prisma.articleProduct.findMany({ where: { shop: session.shop, isActive: true }, select: { articleId: true, productId: true, productTitle: true } }),
      searchConnection?.selectedSiteUrl ? prisma.searchConsoleMetric.findMany({
        where: { shop: session.shop, siteUrl: searchConnection.selectedSiteUrl, windowDays: 28, period: { in: ["current", "previous"] } },
        select: { pageUrl: true, period: true, clicks: true, impressions: true, ctr: true },
      }) : Promise.resolve([]),
      prisma.shopConfig.findUnique({ where: { shop: session.shop }, select: { addBlogSchema: true } }),
      fetchShopDomains(admin, session.shop),
    ]);
    const [productResult, external] = await Promise.all([
      fetchProductStates(admin, linkedProducts),
      checkExternalLinks(articles, shopDomains),
    ]);
    const report = analyzeContentDecay({
      articles,
      metrics,
      products: productResult.products,
      brokenOutboundByArticle: external.brokenByArticle,
      externalLinksChecked: external.checked,
      externalLinksSkipped: external.skipped,
      schemaEnabled: config?.addBlogSchema !== false,
      inventoryDataAvailable: productResult.inventoryDataAvailable,
    });
    const analyzedAt = new Date();
    await prisma.contentDecayAnalysis.upsert({
      where: { shop: session.shop },
      update: { report: report as unknown as Prisma.InputJsonValue, analyzedAt },
      create: { shop: session.shop, report: report as unknown as Prisma.InputJsonValue, analyzedAt },
    });
    return json({ success: true, report, analyzedAt: analyzedAt.toISOString() });
  } catch (error) {
    console.error("Content decay analysis failed", error instanceof Error ? error.message : String(error));
    return json({ error: "Could not analyze content decay. Please try again." }, { status: 500 });
  }
};

export default function ContentDecayPage() {
  const initial = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const handled = useRef<unknown>(null);
  const response = fetcher.data as { success?: boolean; report?: ContentDecayReport; analyzedAt?: string; error?: string } | undefined;
  const report = response?.report || initial.report;
  const analyzedAt = response?.analyzedAt || initial.analyzedAt;
  const analyzing = fetcher.state !== "idle";
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!response || handled.current === response) return;
    handled.current = response;
    if (response.success) shopify.toast.show("Content decay report updated");
    if (response.error) shopify.toast.show(response.error, { isError: true });
  }, [response, shopify]);

  const visibleIssues = useMemo(() => report?.issues.filter((issue) => filter === "all" || issue.type === filter) || [], [filter, report]);
  const totalPages = Math.max(1, Math.ceil(visibleIssues.length / ISSUE_PAGE_SIZE));
  const pagedIssues = visibleIssues.slice((page - 1) * ISSUE_PAGE_SIZE, page * ISSUE_PAGE_SIZE);
  const run = () => fetcher.submit({ intent: "analyze" }, { method: "post" });

  useEffect(() => { setPage(1); }, [filter, report]);

  if (!initial.canContentDecay) return <AppPage title="Keywords & decay" subtitle="See which searches bring traffic, and which posts are losing it." fullWidth tabs={{ items: ANALYTICS_WORKSPACE_TABS, activeId: "keywords" }}><SearchConsoleCard data={initial.searchConsole} mode="keywords" planKey={initial.planKey} /><Card><EmptyState heading="Content decay monitoring is a Growth feature" action={{ content: "Upgrade to Growth", url: `/app/pricing?reason=content_decay&plan=${initial.planKey}` }} image={EMPTY_IMAGE}><p>Upgrade to monitor traffic decline, stale articles, unavailable products and broken outbound links across your Shopify blog.</p></EmptyState></Card></AppPage>;

  return <AppPage
    title="Keywords & decay"
    subtitle="See which searches bring traffic, and which posts are losing it or contain stale products, links and dates."
    fullWidth
    tabs={{ items: ANALYTICS_WORKSPACE_TABS, activeId: "keywords" }}
    primaryAction={{ content: report ? "Refresh analysis" : "Analyze content", onAction: run, loading: analyzing }}
  >
    <BlockStack gap="500">
      <SearchConsoleCard data={initial.searchConsole} mode="keywords" planKey={initial.planKey} />
      <Text as="h2" variant="headingLg">Content decay</Text>
      {response?.error && <Banner tone="critical"><p>{response.error}</p></Banner>}
      {!report ? <Card><EmptyState heading="Check your content health" action={{ content: "Analyze content", onAction: run, loading: analyzing }} image={EMPTY_IMAGE}><p>The analysis is read-only and saved per shop. It never changes an article automatically.</p></EmptyState></Card> : <>
        <StatTiles>
          <StatTile label="Articles checked" value={report.articlesAnalyzed} />
          <StatTile label="High priority" value={report.issues.filter((item) => item.severity === "high").length} tone={report.issues.some((item) => item.severity === "high") ? "bad" : "good"} />
          <StatTile label="Needs review" value={report.issues.length} tone={report.issues.length ? "warn" : "good"} />
          <StatTile label="Links checked" value={report.externalLinksChecked} tone="brand" />
        </StatTiles>
        {!report.searchDataAvailable && <Banner tone="info" title="Search performance checks are waiting"><p>Connect and sync Google Search Console in Settings → Integrations to detect click and CTR decline.</p></Banner>}
        {!report.schemaEnabled && <Banner tone="warning" title="Article schema is disabled"><p>Enable Blog schema in Settings before relying on structured data for Shopify articles. <Button size="micro" url="/app/settings">Open settings</Button></p></Banner>}
        {!report.inventoryDataAvailable && <Banner tone="info" title="Inventory-level checks are limited"><p>The current Shopify installation does not provide inventory quantities. Deleted and inactive products are still checked; out-of-stock checks will run only when inventory access is available.</p></Banner>}
        {report.externalLinksSkipped > 0 && <Banner tone="info"><p>{report.externalLinksSkipped} additional external links were skipped because each manual analysis checks at most {MAX_EXTERNAL_LINKS} unique article links.</p></Banner>}
        <Card padding="0">
          <Box padding="400"><InlineStack align="space-between" blockAlign="center"><BlockStack gap="100"><Text as="h2" variant="headingMd">Priority queue</Text><Text as="p" variant="bodySm" tone="subdued">Updated {formatDate(analyzedAt)} · Review high-priority rows first. No changes are published automatically.</Text></BlockStack><Box minWidth="230px"><Select label="Issue type" labelHidden value={filter} onChange={setFilter} options={filterOptions(report)} /></Box></InlineStack></Box>
          <Divider />
          {visibleIssues.length ? <IndexTable
            resourceName={{ singular: "issue", plural: "issues" }}
            itemCount={pagedIssues.length}
            selectable={false}
            headings={[{ title: "Article" }, { title: "Issue" }, { title: "Previous" }, { title: "Current" }, { title: "Recommended action" }, { title: "Priority" }, { title: "" }]}
            pagination={totalPages > 1 ? { hasPrevious: page > 1, onPrevious: () => setPage((current) => Math.max(1, current - 1)), hasNext: page < totalPages, onNext: () => setPage((current) => Math.min(totalPages, current + 1)), label: `Page ${page} of ${totalPages} · ${visibleIssues.length} issues` } : undefined}
          >
            {pagedIssues.map((issue, index) => <IssueRow key={issue.id} issue={issue} index={index} />)}
          </IndexTable> : <Box padding="500"><Text as="p" tone="subdued">No content decay issues match this filter.</Text></Box>}
        </Card>
      </>}
    </BlockStack>
  </AppPage>;
}


function IssueRow({ issue, index }: { issue: DecayIssue; index: number }) {
  const showDetail = issue.detail && issue.type !== "broken_outbound" && issue.type !== "unavailable_product";
  return <IndexTable.Row id={issue.id} position={index}>
    <IndexTable.Cell><BlockStack gap="050"><Text as="span" variant="bodySm" fontWeight="semibold">{issue.articleTitle}</Text>{showDetail && <Text as="span" variant="bodySm" tone="subdued" breakWord>{issue.detail}</Text>}</BlockStack></IndexTable.Cell>
    <IndexTable.Cell><Text as="span" variant="bodySm" fontWeight="semibold">{issue.message}</Text></IndexTable.Cell>
    <IndexTable.Cell><CompactValue value={issue.previousValue} isUrl={issue.type === "broken_outbound"} /></IndexTable.Cell>
    <IndexTable.Cell><Text as="span" variant="bodySm">{issue.currentValue}</Text></IndexTable.Cell>
    <IndexTable.Cell><Box maxWidth="280px"><Text as="span" variant="bodySm" breakWord>{issue.recommendation}</Text></Box></IndexTable.Cell>
    <IndexTable.Cell><Badge tone={issue.severity === "high" ? "critical" : issue.severity === "medium" ? "warning" : "info"}>{issue.severity === "high" ? "High" : issue.severity === "medium" ? "Medium" : "Low"}</Badge></IndexTable.Cell>
    <IndexTable.Cell><Button size="micro" url={articleEditorUrl(issue.articleId, true)}>AI refresh</Button></IndexTable.Cell>
  </IndexTable.Row>;
}

function CompactValue({ value, isUrl }: { value: string; isUrl: boolean }) {
  if (!isUrl) return <>{value}</>;
  return <Box maxWidth="240px"><Text as="span" variant="bodySm" truncate>{compactUrl(value)}</Text></Box>;
}

function filterOptions(report: ContentDecayReport) {
  const labels: Record<string, string> = { traffic_decline: "Traffic decline", ctr_decline: "CTR decline", stale_content: "Stale content", unavailable_product: "Unavailable products", broken_outbound: "Broken outbound links", outdated_year: "Outdated year" };
  const counts = new Map<string, number>();
  report.issues.forEach((issue) => counts.set(issue.type, (counts.get(issue.type) || 0) + 1));
  return [{ label: `All issues (${report.issues.length})`, value: "all" }, ...Object.entries(labels).filter(([type]) => counts.has(type)).map(([value, label]) => ({ label: `${label} (${counts.get(value)})`, value }))];
}

async function fetchArticles(admin: any): Promise<DecayArticle[]> {
  const articles: DecayArticle[] = [];
  let cursor: string | null = null;
  do {
    const response = await admin.graphql(`#graphql
      query DecayArticles($after: String) {
        articles(first: 100, after: $after) {
          nodes { id title handle body updatedAt publishedAt blog { handle } }
          pageInfo { hasNextPage endCursor }
        }
      }`, { variables: { after: cursor } });
    const result: any = await response.json();
    if (result.errors?.length) throw new Error(result.errors.map((item: any) => item.message).join("; "));
    const connection = result.data?.articles;
    for (const article of connection?.nodes || []) articles.push({ id: article.id, title: article.title || "Untitled post", handle: article.handle || "", blogHandle: article.blog?.handle || "", updatedAt: article.updatedAt, publishedAt: article.publishedAt, body: article.body || "" });
    cursor = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (cursor);
  return articles;
}

async function fetchProductStates(admin: any, links: Array<{ articleId: string; productId: string; productTitle: string }>): Promise<{ products: DecayProduct[]; inventoryDataAvailable: boolean }> {
  const uniqueIds = [...new Set(links.map((item) => item.productId).filter(Boolean))];
  const state = new Map<string, { exists: boolean; available: boolean }>();
  let inventoryDataAvailable = true;
  for (let index = 0; index < uniqueIds.length; index += 50) {
    const ids = uniqueIds.slice(index, index + 50);
    let result: any;
    try {
      const response = await admin.graphql(`#graphql
        query DecayProducts($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product { id status variants(first: 100) { nodes { inventoryPolicy inventoryQuantity } } }
          }
        }`, { variables: { ids } });
      result = await response.json();
      if (result.errors?.length) throw new Error(result.errors.map((item: any) => item.message).join("; "));
    } catch {
      inventoryDataAvailable = false;
      const fallbackResponse = await admin.graphql(`#graphql
        query DecayProductStatus($ids: [ID!]!) {
          nodes(ids: $ids) { ... on Product { id status } }
        }`, { variables: { ids } });
      result = await fallbackResponse.json();
    }
    if (result.errors?.length) throw new Error(result.errors.map((item: any) => item.message).join("; "));
    const returned = new Set<string>();
    for (const product of result.data?.nodes || []) if (product?.id) {
      returned.add(product.id);
      const variants = product.variants?.nodes || [];
      const available = product.status === "ACTIVE" && (!inventoryDataAvailable || variants.some((variant: any) => Number(variant.inventoryQuantity) > 0 || variant.inventoryPolicy === "CONTINUE"));
      state.set(product.id, { exists: true, available });
    }
    ids.filter((id) => !returned.has(id)).forEach((id) => state.set(id, { exists: false, available: false }));
  }
  return { products: links.map((link) => ({ ...link, ...(state.get(link.productId) || { exists: false, available: false }) })), inventoryDataAvailable };
}

async function checkExternalLinks(articles: DecayArticle[], shopDomains: string[]) {
  const internalHosts = new Set(shopDomains.map((domain) => domain.replace(/^https?:\/\//, "").split("/")[0].toLowerCase()));
  const candidates: Array<{ articleId: string; href: string }> = [];
  for (const article of articles) for (const match of article.body.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const href = match[1].replace(/&amp;/gi, "&").trim();
    try { const url = new URL(href); if (["http:", "https:"].includes(url.protocol) && !internalHosts.has(url.hostname.toLowerCase()) && isPublicHostname(url.hostname)) candidates.push({ articleId: article.id, href: url.href }); } catch { /* Relative links are internal. */ }
  }
  const unique = [...new Map(candidates.map((item) => [`${item.articleId}|${item.href}`, item])).values()];
  const selected = unique.slice(0, MAX_EXTERNAL_LINKS);
  const brokenByArticle = new Map<string, string[]>();
  for (let index = 0; index < selected.length; index += 10) {
    const results = await Promise.all(selected.slice(index, index + 10).map(async (item) => ({ item, ok: await isPublicUrlReachable(item.href, 3000) })));
    results.filter((result) => !result.ok).forEach(({ item }) => brokenByArticle.set(item.articleId, [...(brokenByArticle.get(item.articleId) || []), item.href]));
  }
  return { brokenByArticle, checked: selected.length, skipped: Math.max(0, unique.length - selected.length) };
}

function articleEditorUrl(articleId: string, refresh = false) { return `/app/blogs/${encodeURIComponent(articleId.split("/").pop() || articleId)}${refresh ? "?refresh=1" : ""}`; }
function compactUrl(value: string) { try { const url = new URL(value); const text = `${url.hostname}${url.pathname}`; return text.length > 58 ? `${text.slice(0, 55)}...` : text; } catch { return value.length > 58 ? `${value.slice(0, 55)}...` : value; } }
function formatDate(value: string | null) { return value ? new Date(value).toLocaleString() : "not yet"; }
