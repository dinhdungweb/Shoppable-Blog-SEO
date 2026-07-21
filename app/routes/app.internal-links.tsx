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
import { authenticate } from "../shopify.server";
import { fetchShopDomains } from "../shopify-domains.server";

const EMPTY_IMAGE = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const saved = await prisma.internalLinkAnalysis.findUnique({ where: { shop: session.shop } });
  const savedReport = saved?.report as unknown as InternalLinkReport | undefined;
  return json({
    report: savedReport?.auditVersion === 2 ? savedReport : null,
    analyzedAt: saved?.analyzedAt.toISOString() || null,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
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
            <Box paddingInline="400" paddingBlockStart="200">
              <Tabs tabs={[
                { id: "overview", content: "Overview" },
                { id: "suggestions", content: `Suggestions (${report.suggestions.length})` },
                { id: "issues", content: `Issues (${report.orphanArticles.length + report.brokenLinks.length + report.repeatedAnchors.length})` },
                { id: "clusters", content: `Topic clusters (${report.clusters.length})` },
              ]} selected={selectedTab} onSelect={setSelectedTab} />
            </Box>
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
              <BlockStack gap="100"><Text as="p" variant="bodySm" tone="subdued">Link from</Text><Text as="p" fontWeight="semibold">{pendingSuggestion.sourceTitle}</Text><Button size="micro" url={articleEditorUrl(pendingSuggestion.sourceId)} target="_blank">Open source</Button></BlockStack>
              <BlockStack gap="100"><Text as="p" variant="bodySm" tone="subdued">Link to</Text><Text as="p" fontWeight="semibold">{pendingSuggestion.targetTitle}</Text><Button size="micro" url={articleEditorUrl(pendingSuggestion.targetId)} target="_blank">Open destination</Button></BlockStack>
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
      <Card><BlockStack gap="400">
        <BlockStack gap="100"><Text as="h2" variant="headingMd">Priority queue</Text><Text as="p" variant="bodySm" tone="subdued">Work from top to bottom. Suggestions are never published without confirmation.</Text></BlockStack>
        <PriorityRow label="Broken destinations" detail="Links pointing to deleted Shopify articles or products" count={report.brokenLinks.length} tone={report.brokenLinks.length ? "critical" : "success"} action="Review issues" onAction={() => onSelectTab(2)} />
        <Divider />
        <PriorityRow label="Orphan articles" detail="Articles with no contextual inbound link from another post" count={report.orphanArticles.length} tone={report.orphanArticles.length ? "warning" : "success"} action="Review issues" onAction={() => onSelectTab(2)} />
        <Divider />
        <PriorityRow label="Link suggestions" detail="Related source and destination pairs waiting for review" count={report.suggestions.length} tone="info" action="Review suggestions" onAction={() => onSelectTab(1)} />
      </BlockStack></Card>
    </Layout.Section>
    <Layout.Section variant="oneThird">
      <BlockStack gap="400">
        <Card><BlockStack gap="200"><InlineStack align="space-between"><Text as="h2" variant="headingMd">Saved report</Text><Badge tone="success">Available</Badge></InlineStack><Text as="p" variant="bodySm" tone="subdued">Updated {formatAnalyzedAt(analyzedAt)}</Text><Text as="p" variant="bodySm" tone="subdued">This report stays available when you leave or reload the page.</Text></BlockStack></Card>
        <Card><BlockStack gap="200"><Text as="h2" variant="headingMd">Safe workflow</Text><Text as="p" variant="bodySm">1. Review the source and destination</Text><Text as="p" variant="bodySm">2. Check the suggested anchor</Text><Text as="p" variant="bodySm">3. Confirm in the review dialog</Text></BlockStack></Card>
      </BlockStack>
    </Layout.Section>
  </Layout>;
}

function PriorityRow({ label, detail, count, tone, action, onAction }: { label: string; detail: string; count: number; tone: "critical" | "warning" | "success" | "info"; action: string; onAction: () => void }) {
  return <InlineStack align="space-between" blockAlign="center" wrap={false} gap="300"><InlineStack gap="300" blockAlign="center" wrap={false}><Box minWidth="48px"><Text as="p" variant="headingLg" fontWeight="bold">{count}</Text></Box><BlockStack gap="050"><Text as="p" fontWeight="semibold">{label}</Text><Text as="p" variant="bodySm" tone="subdued">{detail}</Text></BlockStack></InlineStack><InlineStack gap="200" blockAlign="center" wrap={false}><Badge tone={tone}>{count ? "Review" : "Clear"}</Badge><Button size="micro" disabled={!count} onClick={onAction}>{action}</Button></InlineStack></InlineStack>;
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
    <Banner tone={report.brokenLinks.length ? "critical" : "success"} title={report.brokenLinks.length ? "Fix broken destinations first" : "No broken destinations"}>
      <p>Broken links send readers and crawlers to deleted article or product pages. Orphan articles need at least one useful inbound contextual link.</p>
    </Banner>
    <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
      <IssueList title={`Orphan articles (${report.orphanArticles.length})`} empty="Every article has an inbound contextual link." items={report.orphanArticles.map((item) => item.title)} />
      <IssueList title={`Broken destinations (${report.brokenLinks.length})`} empty="No deleted article or product links found." items={report.brokenLinks.map((item) => `${item.sourceTitle} → ${item.href} (${item.kind})`)} />
    </InlineGrid>
    <Card><BlockStack gap="300"><Text as="h2" variant="headingMd">Repeated anchors ({report.repeatedAnchors.length})</Text><Text as="p" variant="bodySm" tone="subdued">Generic anchor text used for different destinations can make link context unclear.</Text>{report.repeatedAnchors.length ? report.repeatedAnchors.slice(0, 20).map((item) => <InlineStack key={item.anchor} align="space-between" wrap={false}><Text as="span" variant="bodySm">{item.anchor}</Text><Badge tone="warning">{`${item.uses} uses / ${item.destinations} URLs`}</Badge></InlineStack>) : <Text as="p" tone="subdued">No overused anchors found.</Text>}</BlockStack></Card>
  </BlockStack>;
}

function ClustersPanel({ report }: { report: InternalLinkReport }) {
  return <BlockStack gap="400">
    <Banner tone="info" title="Pillar → supporting articles"><p>A pillar is a broad, substantial article. Supporting articles cover narrower related questions and should link naturally to the pillar where useful.</p></Banner>
    {report.clusters.length ? <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">{report.clusters.map((cluster) => <Card key={cluster.pillar.id}><BlockStack gap="300"><BlockStack gap="100"><Badge tone="info">Pillar page</Badge><Text as="h2" variant="headingMd">{cluster.pillar.title}</Text></BlockStack><Divider />{cluster.supporting.map((item) => <Text key={item.id} as="p" variant="bodySm">↳ {item.title}</Text>)}</BlockStack></Card>)}</InlineGrid> : <Card><Text as="p" tone="subdued">Not enough related content to build a topic cluster.</Text></Card>}
  </BlockStack>;
}

function IssueList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return <Card><BlockStack gap="300"><Text as="h2" variant="headingMd">{title}</Text>{items.length ? items.slice(0, 20).map((item, index) => <BlockStack key={`${item}:${index}`} gap="200">{index > 0 && <Divider />}<Text as="p" variant="bodySm">{item}</Text></BlockStack>) : <Text as="p" tone="subdued">{empty}</Text>}</BlockStack></Card>;
}
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
