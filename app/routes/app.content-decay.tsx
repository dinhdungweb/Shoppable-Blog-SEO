import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import type { Prisma } from "@prisma/client";
import { Badge, Banner, BlockStack, Box, Button, Card, Divider, EmptyState, InlineGrid, InlineStack, Page, Select, Text } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { analyzeContentDecay } from "../content-decay";
import type { ContentDecayReport, DecayArticle, DecayIssue, DecayProduct } from "../content-decay";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { fetchShopDomains } from "../shopify-domains.server";

const EMPTY_IMAGE = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";
const MAX_EXTERNAL_LINKS = 30;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const saved = await prisma.contentDecayAnalysis.findUnique({ where: { shop: session.shop } });
  const report = saved?.report as unknown as ContentDecayReport | undefined;
  return json({ report: report?.version === 1 ? report : null, analyzedAt: saved?.analyzedAt.toISOString() || null });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
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

  useEffect(() => {
    if (!response || handled.current === response) return;
    handled.current = response;
    if (response.success) shopify.toast.show("Content decay report updated");
    if (response.error) shopify.toast.show(response.error, { isError: true });
  }, [response, shopify]);

  const visibleIssues = useMemo(() => report?.issues.filter((issue) => filter === "all" || issue.type === filter) || [], [filter, report]);
  const run = () => fetcher.submit({ intent: "analyze" }, { method: "post" });

  return <Page fullWidth>
    <TitleBar title="Content Decay Monitor"><button variant="primary" disabled={analyzing} onClick={run}>{analyzing ? "Analyzing..." : "Analyze content"}</button></TitleBar>
    <BlockStack gap="500">
      <InlineStack align="space-between" blockAlign="end">
        <BlockStack gap="100"><Text as="h1" variant="headingXl" fontWeight="bold">Content Decay Monitor</Text><Text as="p" tone="subdued">Find Shopify articles losing search performance or containing stale products, links and dates.</Text></BlockStack>
        <Button variant="primary" loading={analyzing} onClick={run}>{report ? "Refresh analysis" : "Analyze content"}</Button>
      </InlineStack>
      {response?.error && <Banner tone="critical"><p>{response.error}</p></Banner>}
      {!report ? <Card><EmptyState heading="Check your content health" action={{ content: "Analyze content", onAction: run, loading: analyzing }} image={EMPTY_IMAGE}><p>The analysis is read-only and saved per shop. It never changes an article automatically.</p></EmptyState></Card> : <>
        <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
          <SummaryCard label="Articles checked" value={report.articlesAnalyzed} tone="info" />
          <SummaryCard label="High priority" value={report.issues.filter((item) => item.severity === "high").length} tone="critical" />
          <SummaryCard label="Needs review" value={report.issues.length} tone={report.issues.length ? "warning" : "success"} />
          <SummaryCard label="Links checked" value={report.externalLinksChecked} tone="info" />
        </InlineGrid>
        {!report.searchDataAvailable && <Banner tone="info" title="Search performance checks are waiting"><p>Connect and sync Google Search Console in SEO Optimizer to detect click and CTR decline.</p></Banner>}
        {!report.schemaEnabled && <Banner tone="warning" title="Article schema is disabled"><p>Enable Blog schema in Settings before relying on structured data for Shopify articles. <Button size="micro" url="/app/settings">Open settings</Button></p></Banner>}
        {!report.inventoryDataAvailable && <Banner tone="info" title="Inventory-level checks are limited"><p>The current Shopify installation does not provide inventory quantities. Deleted and inactive products are still checked; out-of-stock checks will run only when inventory access is available.</p></Banner>}
        {report.externalLinksSkipped > 0 && <Banner tone="info"><p>{report.externalLinksSkipped} additional external links were skipped because each manual analysis checks at most {MAX_EXTERNAL_LINKS} unique article links.</p></Banner>}
        <Card padding="0">
          <Box padding="400"><InlineStack align="space-between" blockAlign="center"><BlockStack gap="100"><Text as="h2" variant="headingMd">Priority queue</Text><Text as="p" variant="bodySm" tone="subdued">Updated {formatDate(analyzedAt)} · Review high-priority rows first. No changes are published automatically.</Text></BlockStack><div style={{ minWidth: 230 }}><Select label="Issue type" labelHidden value={filter} onChange={setFilter} options={filterOptions(report)} /></div></InlineStack></Box>
          <Divider />
          {visibleIssues.length ? <div style={{ overflowX: "auto" }}><table style={tableStyle}><thead><tr><Header>Article</Header><Header>Issue</Header><Header>Previous</Header><Header>Current</Header><Header>Recommended action</Header><Header>Priority</Header><Header>Action</Header></tr></thead><tbody>{visibleIssues.slice(0, 100).map((issue) => <IssueRow key={issue.id} issue={issue} />)}</tbody></table></div> : <Box padding="500"><Text as="p" tone="subdued">No content decay issues match this filter.</Text></Box>}
          {visibleIssues.length > 100 && <Box padding="300"><Text as="p" variant="bodySm" tone="subdued">Showing 100 of {visibleIssues.length} issues.</Text></Box>}
        </Card>
      </>}
    </BlockStack>
  </Page>;
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "info" | "critical" | "warning" | "success" }) {
  return <Card><BlockStack gap="150"><Text as="p" variant="bodySm" tone="subdued">{label}</Text><InlineStack align="space-between" blockAlign="center"><Text as="p" variant="heading2xl" fontWeight="bold">{value}</Text><Badge tone={tone}>{value ? "Measured" : "Clear"}</Badge></InlineStack></BlockStack></Card>;
}

function IssueRow({ issue }: { issue: DecayIssue }) {
  const showDetail = issue.detail && issue.type !== "broken_outbound" && issue.type !== "unavailable_product";
  return <tr style={rowStyle}><Cell><strong>{issue.articleTitle}</strong>{showDetail && <><br /><span style={subduedStyle}>{issue.detail}</span></>}</Cell><Cell><strong>{issue.message}</strong></Cell><Cell><CompactValue value={issue.previousValue} isUrl={issue.type === "broken_outbound"} /></Cell><Cell>{issue.currentValue}</Cell><Cell>{issue.recommendation}</Cell><Cell><Badge tone={issue.severity === "high" ? "critical" : issue.severity === "medium" ? "warning" : "info"}>{issue.severity === "high" ? "High" : issue.severity === "medium" ? "Medium" : "Low"}</Badge></Cell><Cell><Button size="micro" url={articleEditorUrl(issue.articleId)}>Review</Button></Cell></tr>;
}

function CompactValue({ value, isUrl }: { value: string; isUrl: boolean }) {
  if (!isUrl) return <>{value}</>;
  return <span title={value} style={{ display: "block", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{compactUrl(value)}</span>;
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
    try { const url = new URL(href); if (["http:", "https:"].includes(url.protocol) && !internalHosts.has(url.hostname.toLowerCase()) && isPublicHost(url.hostname)) candidates.push({ articleId: article.id, href: url.href }); } catch { /* Relative links are internal. */ }
  }
  const unique = [...new Map(candidates.map((item) => [`${item.articleId}|${item.href}`, item])).values()];
  const selected = unique.slice(0, MAX_EXTERNAL_LINKS);
  const brokenByArticle = new Map<string, string[]>();
  for (let index = 0; index < selected.length; index += 10) {
    const results = await Promise.all(selected.slice(index, index + 10).map(async (item) => ({ item, ok: await isReachable(item.href) })));
    results.filter((result) => !result.ok).forEach(({ item }) => brokenByArticle.set(item.articleId, [...(brokenByArticle.get(item.articleId) || []), item.href]));
  }
  return { brokenByArticle, checked: selected.length, skipped: Math.max(0, unique.length - selected.length) };
}

async function isReachable(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    let response = await safeExternalFetch(url, "HEAD", controller.signal);
    if (response.status === 405 || response.status === 403) response = await safeExternalFetch(url, "GET", controller.signal);
    return response.status < 400 || [401, 403, 429].includes(response.status);
  } catch { return false; }
  finally { clearTimeout(timer); }
}

async function safeExternalFetch(initialUrl: string, method: "HEAD" | "GET", signal: AbortSignal) {
  let currentUrl = initialUrl;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const parsed = new URL(currentUrl);
    if (!["http:", "https:"].includes(parsed.protocol) || !isPublicHost(parsed.hostname)) throw new Error("Unsafe external URL");
    const response = await fetch(parsed, { method, redirect: "manual", signal, headers: { "user-agent": "ShoppableBlogSEO/1.0", ...(method === "GET" ? { range: "bytes=0-0" } : {}) } });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    currentUrl = new URL(location, parsed).href;
  }
  throw new Error("Too many redirects");
}

function isPublicHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) return false;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return false;
  return true;
}

function articleEditorUrl(articleId: string) { return `/app/blogs/${encodeURIComponent(articleId.split("/").pop() || articleId)}`; }
function compactUrl(value: string) { try { const url = new URL(value); const text = `${url.hostname}${url.pathname}`; return text.length > 58 ? `${text.slice(0, 55)}...` : text; } catch { return value.length > 58 ? `${value.slice(0, 55)}...` : value; } }
function formatDate(value: string | null) { return value ? new Date(value).toLocaleString() : "not yet"; }
function Header({ children }: { children: React.ReactNode }) { return <th style={{ padding: "12px 16px", textAlign: "left", whiteSpace: "nowrap", color: "var(--p-color-text-secondary)", fontSize: 12 }}>{children}</th>; }
function Cell({ children }: { children: React.ReactNode }) { return <td style={{ padding: "12px 16px", minWidth: 130, maxWidth: 280, verticalAlign: "middle", overflowWrap: "anywhere" }}>{children}</td>; }
const tableStyle: React.CSSProperties = { width: "100%", minWidth: 1080, tableLayout: "fixed", borderCollapse: "collapse" };
const rowStyle: React.CSSProperties = { borderTop: "1px solid var(--p-color-border-secondary)" };
const subduedStyle: React.CSSProperties = { color: "var(--p-color-text-secondary)", fontSize: 12, wordBreak: "break-all" };
