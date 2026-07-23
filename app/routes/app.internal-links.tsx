import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import type { Prisma } from "@prisma/client";
import { Badge, Banner, BlockStack, Box, Button, Card, Divider, EmptyState, InlineGrid, InlineStack, Layout, Modal, Page, Tabs, Text } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { analyzeInternalLinks, insertApprovedLink } from "../internal-linking";
import type { InternalLinkReport, LinkArticle, LinkSuggestion } from "../internal-linking";
import prisma from "../db.server";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import { fetchShopDomains } from "../shopify-domains.server";

const EMPTY_IMAGE = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const { limits, planKey } = await getActivePlanAndLimits(billing, session.shop);
  if (!limits.canInternalLinking) {
    return json({ report: null, analyzedAt: null, canInternalLinking: false, planKey });
  }
  const saved = await prisma.internalLinkAnalysis.findUnique({ where: { shop: session.shop } });
  const savedReport = saved?.report as unknown as InternalLinkReport | undefined;
  return json({
    report: savedReport?.auditVersion === 2 ? savedReport : null,
    analyzedAt: saved?.analyzedAt.toISOString() || null,
    canInternalLinking: true,
    planKey,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const { limits } = await getActivePlanAndLimits(billing, session.shop);
  if (!limits.canInternalLinking) {
    return json({ error: "Internal Linking Assistant is available on Pro and Growth plans." }, { status: 403 });
  }
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "analyze") {
    try {
      const [articles, productHandles, shopDomains] = await Promise.all([fetchArticles(admin), fetchProductHandles(admin), fetchShopDomains(admin, session.shop)]);
      const report = analyzeInternalLinks(articles, productHandles, shopDomains);
      const analyzedAt = new Date();
      await prisma.internalLinkAnalysis.upsert({
        where: { shop: session.shop },
        update: { report: report as unknown as Prisma.InputJsonValue, analyzedAt },
        create: { shop: session.shop, report: report as unknown as Prisma.InputJsonValue, analyzedAt },
      });
      return json({ success: true, report, analyzedAt: analyzedAt.toISOString() });
    } catch (error) {
      console.error("Internal linking analysis failed", error);
      return json({ error: "Could not analyze internal links. Please try again." }, { status: 500 });
    }
  }

  if (intent === "apply") {
    const sourceId = String(formData.get("sourceId") || "");
    const targetId = String(formData.get("targetId") || "");
    const anchorText = cleanAnchor(String(formData.get("anchorText") || ""));
    if (!sourceId || !targetId || !anchorText) return json({ error: "The approved link is incomplete." }, { status: 400 });
    try {
      const [source, target] = await Promise.all([fetchArticle(admin, sourceId), fetchArticle(admin, targetId)]);
      if (!source || !target || source.id === target.id) return json({ error: "The source or target article no longer exists." }, { status: 404 });
      const targetUrl = `/blogs/${target.blogHandle}/${target.handle}`;
      if (source.body.toLowerCase().includes(`href="${targetUrl.toLowerCase()}"`) || source.body.toLowerCase().includes(`href='${targetUrl.toLowerCase()}'`)) {
        return json({ error: "This article already links to the suggested destination." }, { status: 409 });
      }
      const inserted = insertApprovedLink(source.body, anchorText, targetUrl);
      const response = await admin.graphql(`#graphql
        mutation InsertApprovedInternalLink($id: ID!, $article: ArticleUpdateInput!) {
          articleUpdate(id: $id, article: $article) {
            article { id }
            userErrors { field message }
          }
        }`, { variables: { id: source.id, article: { body: inserted.body } } });
      const result: any = await response.json();
      const errors = result.data?.articleUpdate?.userErrors || result.errors || [];
      if (errors.length) throw new Error(errors.map((item: any) => item.message).join("; "));
      await prisma.internalLinkAnalysis.deleteMany({ where: { shop: session.shop } });
      return json({ success: true, applied: true, insertedInContext: inserted.insertedInContext });
    } catch (error) {
      console.error("Approved internal link insertion failed", error);
      return json({ error: error instanceof Error ? error.message : "Could not insert the approved link." }, { status: 500 });
    }
  }

  return json({ error: "Unsupported action." }, { status: 400 });
};

export default function InternalLinksPage() {
  const initialData = useLoaderData<typeof loader>();
  const analyzeFetcher = useFetcher<typeof action>();
  const applyFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const handledApply = useRef<unknown>(null);
  const analysisData = analyzeFetcher.data as { report?: InternalLinkReport; analyzedAt?: string; error?: string } | undefined;
  const applyData = applyFetcher.data as { applied?: boolean; insertedInContext?: boolean; error?: string } | undefined;
  const report = analysisData?.report || initialData.report;
  const analyzedAt = analysisData?.analyzedAt || initialData.analyzedAt;
  const [selectedTab, setSelectedTab] = useState(0);
  const [pendingSuggestion, setPendingSuggestion] = useState<LinkSuggestion | null>(null);

  useEffect(() => {
    if (!applyData || handledApply.current === applyData) return;
    handledApply.current = applyData;
    if (applyData.applied) {
      setPendingSuggestion(null);
      shopify.toast.show(applyData.insertedInContext ? "Internal link inserted in context" : "Internal link added to the end of the article");
      analyzeFetcher.submit({ intent: "analyze" }, { method: "post" });
    } else if (applyData.error) {
      shopify.toast.show(applyData.error, { isError: true });
    }
  }, [analyzeFetcher, applyData, shopify]);

  const analyzing = analyzeFetcher.state !== "idle";
  const applying = applyFetcher.state !== "idle";
  const runAnalysis = () => analyzeFetcher.submit({ intent: "analyze" }, { method: "post" });

  if (!initialData.canInternalLinking) {
    return (
      <Page>
        <TitleBar title="Internal Linking Assistant" />
        <Card>
          <EmptyState
            heading="Internal Linking Assistant is a Pro feature"
            action={{ content: "Upgrade to Pro", url: `/app/pricing?reason=internal_linking&plan=${initialData.planKey}` }}
            image={EMPTY_IMAGE}
          >
            <p>Upgrade to analyze related Shopify articles, broken destinations, repeated anchors and topic clusters, then insert approved links.</p>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  return (
    <Page fullWidth>
      <TitleBar title="Internal Linking Assistant">
        <button variant="primary" disabled={analyzing} onClick={runAnalysis}>{analyzing ? "Analyzing..." : "Analyze links"}</button>
      </TitleBar>
      <BlockStack gap="500">
        <InlineStack align="space-between" blockAlign="end">
          <BlockStack gap="100">
            <Text as="h1" variant="headingXl" fontWeight="bold">Internal Linking Assistant</Text>
            <Text as="p" tone="subdued">Find related content, broken destinations, repeated anchors and topic clusters before approving new links.</Text>
          </BlockStack>
          <Button variant="primary" loading={analyzing} onClick={runAnalysis}>{report ? "Refresh analysis" : "Analyze links"}</Button>
        </InlineStack>

        {analysisData?.error && <Card><Text as="p" tone="critical">{analysisData.error}</Text></Card>}
        {!report ? (
          <Card>
            <EmptyState heading="Analyze your Shopify content" action={{ content: "Analyze links", onAction: runAnalysis, loading: analyzing }} image={EMPTY_IMAGE}>
              <p>The analysis is read-only. Links are inserted only after you approve a suggestion.</p>
            </EmptyState>
          </Card>
        ) : <>
          <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
            <SummaryCard label="Articles analyzed" value={report.articles} tone="info" />
            <SummaryCard label="Internal links" value={report.internalLinks} tone="success" />
            <SummaryCard label="Orphan articles" value={report.orphanArticles.length} tone={report.orphanArticles.length ? "critical" : "success"} />
            <SummaryCard label="Broken links" value={report.brokenLinks.length} tone={report.brokenLinks.length ? "critical" : "success"} />
          </InlineGrid>
          <Card padding="0">
            <Tabs tabs={[
              { id: "overview", content: "Overview" },
              { id: "suggestions", content: `Suggestions (${report.suggestions.length})` },
              { id: "issues", content: `Issues (${report.orphanArticles.length + report.brokenLinks.length + report.repeatedAnchors.length})` },
              { id: "clusters", content: `Topic clusters (${report.clusters.length})` },
            ]} selected={selectedTab} onSelect={setSelectedTab} />
          </Card>

          {selectedTab === 0 && <Overview report={report} analyzedAt={analyzedAt} onSelectTab={setSelectedTab} />}
          {selectedTab === 1 && <SuggestionsTable report={report} onReview={setPendingSuggestion} />}
          {selectedTab === 2 && <IssuesPanel report={report} />}
          {selectedTab === 3 && <ClustersPanel report={report} />}
        </>}
      </BlockStack>
      <Modal
        open={Boolean(pendingSuggestion)}
        onClose={() => !applying && setPendingSuggestion(null)}
        title="Review internal link"
        primaryAction={{
          content: "Approve & insert",
          loading: applying,
          disabled: !pendingSuggestion,
          onAction: () => pendingSuggestion && applyFetcher.submit({ intent: "apply", sourceId: pendingSuggestion.sourceId, targetId: pendingSuggestion.targetId, anchorText: pendingSuggestion.anchorText }, { method: "post" }),
        }}
        secondaryActions={[{ content: "Cancel", disabled: applying, onAction: () => setPendingSuggestion(null) }]}
      >
        <Modal.Section>
          {pendingSuggestion && <BlockStack gap="400">
            <Banner tone="warning"><p>This updates the Shopify article. Confirm that the destination adds useful context for the reader.</p></Banner>
            <InlineGrid columns={2} gap="400">
              <BlockStack gap="100"><Text as="p" variant="bodySm" tone="subdued">Link from</Text><Text as="p" fontWeight="semibold">{pendingSuggestion.sourceTitle}</Text><Button size="micro" url={articleEditorUrl(pendingSuggestion.sourceId)}>Open source</Button></BlockStack>
              <BlockStack gap="100"><Text as="p" variant="bodySm" tone="subdued">Link to</Text><Text as="p" fontWeight="semibold">{pendingSuggestion.targetTitle}</Text><Button size="micro" url={articleEditorUrl(pendingSuggestion.targetId)}>Open destination</Button></BlockStack>
            </InlineGrid>
            <Divider />
            <BlockStack gap="100"><Text as="p" variant="bodySm" tone="subdued">Anchor text to insert</Text><Box background="bg-surface-secondary" padding="300" borderRadius="300"><Text as="p" fontWeight="semibold">{pendingSuggestion.anchorText}</Text></Box><Text as="p" variant="bodySm" tone="subdued">The first matching phrase is linked. If it is not present, a “Related” link is appended to the article.</Text></BlockStack>
          </BlockStack>}
        </Modal.Section>
      </Modal>
    </Page>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "info" | "success" | "critical" }) {
  const status = label === "Articles analyzed" || label === "Internal links" ? "Measured" : value ? "Needs review" : "Clear";
  return <Card><BlockStack gap="150"><Text as="p" variant="bodySm" tone="subdued">{label}</Text><InlineStack align="space-between" blockAlign="center"><Text as="p" variant="heading2xl" fontWeight="bold">{value}</Text><Badge tone={tone}>{status}</Badge></InlineStack></BlockStack></Card>;
}

function Overview({ report, analyzedAt, onSelectTab }: { report: InternalLinkReport; analyzedAt: string | null; onSelectTab: (tab: number) => void }) {
  return <Layout>
    <Layout.Section>
      <TableSection title="Priority queue" description="Work from top to bottom. Suggestions are never published without confirmation.">
        <table style={tableStyle}><thead><tr><Header>Category</Header><Header>What it means</Header><Header>Count</Header><Header>Status</Header><Header>Action</Header></tr></thead><tbody>
          <OverviewRow label="Broken destinations" detail="Links to deleted Shopify articles or products" count={report.brokenLinks.length} tone={report.brokenLinks.length ? "critical" : "success"} action="Review issues" onAction={() => onSelectTab(2)} />
          <OverviewRow label="Orphan articles" detail="Articles with no inbound contextual link" count={report.orphanArticles.length} tone={report.orphanArticles.length ? "warning" : "success"} action="Review issues" onAction={() => onSelectTab(2)} />
          <OverviewRow label="Link suggestions" detail="Related source and destination pairs awaiting approval" count={report.suggestions.length} tone="info" action="Review suggestions" onAction={() => onSelectTab(1)} />
          <OverviewRow label="Topic clusters" detail="Pillar and supporting article groups" count={report.clusters.length} tone="info" action="View clusters" onAction={() => onSelectTab(3)} />
        </tbody></table>
      </TableSection>
    </Layout.Section>
    <Layout.Section variant="oneThird">
      <BlockStack gap="400">
        <Card><BlockStack gap="200"><InlineStack align="space-between"><Text as="h2" variant="headingMd">Saved report</Text><Badge tone="success">Available</Badge></InlineStack><Text as="p" variant="bodySm" tone="subdued">Updated {formatAnalyzedAt(analyzedAt)}</Text><Text as="p" variant="bodySm" tone="subdued">This report stays available when you leave or reload the page.</Text></BlockStack></Card>
        <Card><BlockStack gap="200"><Text as="h2" variant="headingMd">Safe workflow</Text><Text as="p" variant="bodySm">1. Review the source and destination</Text><Text as="p" variant="bodySm">2. Check the suggested anchor</Text><Text as="p" variant="bodySm">3. Confirm in the review dialog</Text></BlockStack></Card>
      </BlockStack>
    </Layout.Section>
  </Layout>;
}

function OverviewRow({ label, detail, count, tone, action, onAction }: { label: string; detail: string; count: number; tone: "critical" | "warning" | "success" | "info"; action: string; onAction: () => void }) {
  return <tr style={rowStyle}><Cell><strong>{label}</strong></Cell><Cell>{detail}</Cell><Cell><strong>{count}</strong></Cell><Cell><Badge tone={tone}>{count ? "Review" : "Clear"}</Badge></Cell><Cell><Button size="micro" disabled={!count} onClick={onAction}>{action}</Button></Cell></tr>;
}

function SuggestionsTable({ report, onReview }: { report: InternalLinkReport; onReview: (suggestion: LinkSuggestion) => void }) {
  return <Card padding="0">
    <Box padding="400"><BlockStack gap="100"><Text as="h2" variant="headingMd">Suggested internal links</Text><Text as="p" variant="bodySm" tone="subdued">Relevance measures topic overlap. Approve only when the destination genuinely helps the reader; the link is never inserted automatically.</Text></BlockStack></Box>
    <Divider />
    {report.suggestions.length ? <div style={{ overflowX: "auto" }}><table style={tableStyle}>
      <thead><tr><Header>Link from</Header><Header>Link to</Header><Header>Suggested anchor</Header><Header>Topic match</Header><Header>Action</Header></tr></thead>
      <tbody>{report.suggestions.slice(0, 50).map((suggestion) => <tr key={suggestion.id} style={rowStyle}>
        <Cell><strong>{suggestion.sourceTitle}</strong><br /><span style={{ color: "var(--p-color-text-secondary)", fontSize: 12 }}>Source article</span></Cell>
        <Cell>{suggestion.targetTitle}<br /><span style={{ color: "var(--p-color-text-secondary)", fontSize: 12 }}>Destination article</span></Cell>
        <Cell><code>{suggestion.anchorText}</code></Cell>
        <Cell><Badge tone={suggestion.score >= 25 ? "success" : "info"}>{`${suggestion.score}%`}</Badge></Cell>
        <Cell><Button size="micro" onClick={() => onReview(suggestion)}>Review</Button></Cell>
      </tr>)}</tbody>
    </table></div> : <Box padding="500"><Text as="p" tone="subdued">No new related-link suggestions were found.</Text></Box>}
  </Card>;
}

function IssuesPanel({ report }: { report: InternalLinkReport }) {
  return <BlockStack gap="400">
    <TableSection title={`Broken destinations (${report.brokenLinks.length})`} description="Links pointing to Shopify articles or products that no longer exist.">
      {report.brokenLinks.length ? <table style={tableStyle}><thead><tr><Header>Source article</Header><Header>Broken URL</Header><Header>Destination type</Header><Header>Action</Header></tr></thead><tbody>{report.brokenLinks.slice(0, 50).map((item) => <tr key={`${item.sourceId}:${item.href}`} style={rowStyle}><Cell><strong>{item.sourceTitle}</strong></Cell><Cell><code style={{ wordBreak: "break-all" }}>{item.href}</code></Cell><Cell><Badge tone="critical">{item.kind === "article" ? "Article" : "Product"}</Badge></Cell><Cell><Button size="micro" url={articleEditorUrl(item.sourceId)}>Open source</Button></Cell></tr>)}</tbody></table> : <EmptyTable text="No broken article or product destinations found." />}
      <TableLimit shown={Math.min(50, report.brokenLinks.length)} total={report.brokenLinks.length} />
    </TableSection>
    <TableSection title={`Orphan articles (${report.orphanArticles.length})`} description="Published articles with no contextual inbound link from another article.">
      {report.orphanArticles.length ? <table style={tableStyle}><thead><tr><Header>Article</Header><Header>Problem</Header><Header>Recommended action</Header><Header>Action</Header></tr></thead><tbody>{report.orphanArticles.slice(0, 50).map((item) => <tr key={item.id} style={rowStyle}><Cell><strong>{item.title}</strong></Cell><Cell><Badge tone="warning">No inbound link</Badge></Cell><Cell>Add a relevant link from a related article</Cell><Cell><Button size="micro" url={articleEditorUrl(item.id)}>Open article</Button></Cell></tr>)}</tbody></table> : <EmptyTable text="Every article has at least one inbound contextual link." />}
      <TableLimit shown={Math.min(50, report.orphanArticles.length)} total={report.orphanArticles.length} />
    </TableSection>
    <TableSection title={`Repeated anchors (${report.repeatedAnchors.length})`} description="Anchor text reused for different destinations can make link context unclear.">
      {report.repeatedAnchors.length ? <table style={tableStyle}><thead><tr><Header>Anchor text</Header><Header>Total uses</Header><Header>Different destinations</Header><Header>Status</Header></tr></thead><tbody>{report.repeatedAnchors.map((item) => <tr key={item.anchor} style={rowStyle}><Cell><code>{item.anchor}</code></Cell><Cell>{item.uses}</Cell><Cell>{item.destinations}</Cell><Cell><Badge tone="warning">Diversify</Badge></Cell></tr>)}</tbody></table> : <EmptyTable text="No overused anchor text found." />}
    </TableSection>
  </BlockStack>;
}

function ClustersPanel({ report }: { report: InternalLinkReport }) {
  return <BlockStack gap="400">
    <Banner tone="info" title="Pillar → supporting articles"><p>A pillar is a broad, substantial article. Supporting articles cover narrower related questions and should link naturally to the pillar where useful.</p></Banner>
    <TableSection title={`Topic cluster map (${report.clusters.length})`} description="Use this map to review whether supporting articles link naturally to their pillar page.">
      {report.clusters.length ? <table style={tableStyle}><thead><tr><Header>Pillar page</Header><Header>Supporting articles</Header><Header>Count</Header><Header>Action</Header></tr></thead><tbody>{report.clusters.map((cluster) => <tr key={cluster.pillar.id} style={rowStyle}><Cell><Badge tone="info">Pillar</Badge><br /><strong>{cluster.pillar.title}</strong></Cell><Cell><BlockStack gap="100">{cluster.supporting.map((item) => <Text key={item.id} as="p" variant="bodySm">• {item.title}</Text>)}</BlockStack></Cell><Cell><strong>{cluster.supporting.length}</strong></Cell><Cell><Button size="micro" url={articleEditorUrl(cluster.pillar.id)}>Open pillar</Button></Cell></tr>)}</tbody></table> : <EmptyTable text="Not enough related content to build a topic cluster." />}
    </TableSection>
  </BlockStack>;
}

function TableSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <Card padding="0"><Box padding="400"><BlockStack gap="100"><Text as="h2" variant="headingMd">{title}</Text><Text as="p" variant="bodySm" tone="subdued">{description}</Text></BlockStack></Box><Divider /><div style={{ overflowX: "auto" }}>{children}</div></Card>;
}
function EmptyTable({ text }: { text: string }) { return <Box padding="500"><Text as="p" tone="subdued">{text}</Text></Box>; }
function TableLimit({ shown, total }: { shown: number; total: number }) { return total > shown ? <Box padding="300" borderBlockStartWidth="025" borderColor="border-secondary"><Text as="p" variant="bodySm" tone="subdued">Showing {shown} of {total} rows.</Text></Box> : null; }
function Header({ children }: { children: React.ReactNode }) { return <th style={{ padding: "12px 16px", textAlign: "left", whiteSpace: "nowrap", color: "var(--p-color-text-secondary)", fontSize: 12 }}>{children}</th>; }
function Cell({ children }: { children: React.ReactNode }) { return <td style={{ padding: "12px 16px", minWidth: 130, verticalAlign: "middle" }}>{children}</td>; }
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const rowStyle: React.CSSProperties = { borderTop: "1px solid var(--p-color-border-secondary)" };
function formatAnalyzedAt(value: string | null) { return value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not available"; }
function articleEditorUrl(id: string) { return `/app/blogs/${encodeURIComponent(id.split("/").pop() || id)}`; }

async function fetchArticles(admin: any): Promise<LinkArticle[]> {
  const articles: LinkArticle[] = [];
  let cursor: string | null = null;
  do {
    const response = await admin.graphql(`#graphql
      query InternalLinkArticles($after: String) {
        articles(first: 100, after: $after) {
          nodes { id title handle body blog { handle } }
          pageInfo { hasNextPage endCursor }
        }
      }`, { variables: { after: cursor } });
    const result: any = await response.json();
    if (result.errors?.length) throw new Error(result.errors.map((item: any) => item.message).join("; "));
    const connection = result.data?.articles;
    for (const article of connection?.nodes || []) articles.push({ id: article.id, title: article.title || "Untitled article", handle: article.handle || "", blogHandle: article.blog?.handle || "", body: article.body || "" });
    cursor = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (cursor);
  return articles.filter((article) => article.handle && article.blogHandle);
}

async function fetchProductHandles(admin: any): Promise<string[]> {
  const handles: string[] = [];
  let cursor: string | null = null;
  do {
    const response = await admin.graphql(`#graphql
      query InternalLinkProducts($after: String) {
        products(first: 250, after: $after) { nodes { handle } pageInfo { hasNextPage endCursor } }
      }`, { variables: { after: cursor } });
    const result: any = await response.json();
    if (result.errors?.length) throw new Error(result.errors.map((item: any) => item.message).join("; "));
    const connection = result.data?.products;
    handles.push(...(connection?.nodes || []).map((product: any) => String(product.handle || "").toLowerCase()).filter(Boolean));
    cursor = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (cursor);
  return handles;
}

async function fetchArticle(admin: any, id: string): Promise<LinkArticle | null> {
  const response = await admin.graphql(`#graphql
    query InternalLinkArticle($id: ID!) {
      node(id: $id) { ... on Article { id title handle body blog { handle } } }
    }`, { variables: { id } });
  const result: any = await response.json();
  const article = result.data?.node;
  return article?.id ? { id: article.id, title: article.title || "Untitled article", handle: article.handle || "", blogHandle: article.blog?.handle || "", body: article.body || "" } : null;
}
function cleanAnchor(value: string) { return value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 120); }
