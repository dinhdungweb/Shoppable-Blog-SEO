import { useEffect, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import { Badge, BlockStack, Box, Button, Card, Divider, EmptyState, InlineGrid, InlineStack, Layout, Page, Text } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { analyzeInternalLinks, insertApprovedLink } from "../internal-linking";
import type { InternalLinkReport, LinkArticle } from "../internal-linking";
import { authenticate } from "../shopify.server";

const EMPTY_IMAGE = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({ ready: true });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "analyze") {
    try {
      const [articles, productHandles] = await Promise.all([fetchArticles(admin), fetchProductHandles(admin)]);
      return json({ success: true, report: analyzeInternalLinks(articles, productHandles) });
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
      return json({ success: true, applied: true, insertedInContext: inserted.insertedInContext });
    } catch (error) {
      console.error("Approved internal link insertion failed", error);
      return json({ error: error instanceof Error ? error.message : "Could not insert the approved link." }, { status: 500 });
    }
  }

  return json({ error: "Unsupported action." }, { status: 400 });
};

export default function InternalLinksPage() {
  const analyzeFetcher = useFetcher<typeof action>();
  const applyFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const handledApply = useRef<unknown>(null);
  const analysisData = analyzeFetcher.data as { report?: InternalLinkReport; error?: string } | undefined;
  const applyData = applyFetcher.data as { applied?: boolean; insertedInContext?: boolean; error?: string } | undefined;
  const report = analysisData?.report;

  useEffect(() => {
    if (!applyData || handledApply.current === applyData) return;
    handledApply.current = applyData;
    if (applyData.applied) {
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

          <Layout>
            <Layout.Section>
              <BlockStack gap="400">
                <Card padding="0">
                  <Box padding="400"><BlockStack gap="100"><Text as="h2" variant="headingMd">Suggested internal links</Text><Text as="p" variant="bodySm" tone="subdued">Review each source, destination and anchor before inserting.</Text></BlockStack></Box>
                  <Divider />
                  {report.suggestions.length ? <div style={{ overflowX: "auto" }}><table style={tableStyle}>
                    <thead><tr><Header>Source article</Header><Header>Suggested destination</Header><Header>Anchor text</Header><Header>Relevance</Header><Header>Approval</Header></tr></thead>
                    <tbody>{report.suggestions.slice(0, 50).map((suggestion) => <tr key={suggestion.id} style={rowStyle}>
                      <Cell><strong>{suggestion.sourceTitle}</strong></Cell>
                      <Cell>{suggestion.targetTitle}</Cell>
                      <Cell><code>{suggestion.anchorText}</code></Cell>
                      <Cell><Badge tone={suggestion.score >= 25 ? "success" : "info"}>{`${suggestion.score}%`}</Badge></Cell>
                      <Cell><Button size="micro" variant="primary" loading={applying && applyFetcher.formData?.get("sourceId") === suggestion.sourceId} disabled={applying} onClick={() => applyFetcher.submit({ intent: "apply", sourceId: suggestion.sourceId, targetId: suggestion.targetId, anchorText: suggestion.anchorText }, { method: "post" })}>Approve & insert</Button></Cell>
                    </tr>)}</tbody>
                  </table></div> : <Box padding="500"><Text as="p" tone="subdued">No new related-link suggestions were found.</Text></Box>}
                </Card>

                <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                  <IssueList title="Orphan articles" empty="Every article has an inbound contextual link." items={report.orphanArticles.map((item) => item.title)} />
                  <IssueList title="Broken destinations" empty="No deleted article or product links found." items={report.brokenLinks.map((item) => `${item.sourceTitle} → ${item.href} (${item.kind})`)} />
                </InlineGrid>
              </BlockStack>
            </Layout.Section>

            <Layout.Section variant="oneThird">
              <BlockStack gap="400">
                <Card><BlockStack gap="300"><Text as="h2" variant="headingMd">Repeated anchor text</Text>{report.repeatedAnchors.length ? report.repeatedAnchors.slice(0, 10).map((item) => <InlineStack key={item.anchor} align="space-between" wrap={false}><Text as="span" variant="bodySm">{item.anchor}</Text><Badge tone="warning">{`${item.uses} uses / ${item.destinations} URLs`}</Badge></InlineStack>) : <Text as="p" tone="subdued">No overused anchors found.</Text>}</BlockStack></Card>
                <Card><BlockStack gap="400"><Text as="h2" variant="headingMd">Topic clusters</Text>{report.clusters.length ? report.clusters.map((cluster) => <BlockStack key={cluster.pillar.id} gap="150"><Text as="h3" variant="headingSm">Pillar: {cluster.pillar.title}</Text>{cluster.supporting.map((item) => <Text key={item.id} as="p" variant="bodySm" tone="subdued">↳ {item.title}</Text>)}</BlockStack>) : <Text as="p" tone="subdued">Not enough related content to build a cluster.</Text>}</BlockStack></Card>
              </BlockStack>
            </Layout.Section>
          </Layout>
        </>}
      </BlockStack>
    </Page>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "info" | "success" | "critical" }) {
  return <Card><BlockStack gap="150"><Text as="p" variant="bodySm" tone="subdued">{label}</Text><InlineStack align="space-between" blockAlign="center"><Text as="p" variant="heading2xl" fontWeight="bold">{value}</Text><Badge tone={tone}>{value ? "Review" : "Clear"}</Badge></InlineStack></BlockStack></Card>;
}
function IssueList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return <Card><BlockStack gap="300"><Text as="h2" variant="headingMd">{title}</Text>{items.length ? items.slice(0, 20).map((item, index) => <BlockStack key={`${item}:${index}`} gap="200">{index > 0 && <Divider />}<Text as="p" variant="bodySm">{item}</Text></BlockStack>) : <Text as="p" tone="subdued">{empty}</Text>}</BlockStack></Card>;
}
function Header({ children }: { children: React.ReactNode }) { return <th style={{ padding: "12px 16px", textAlign: "left", whiteSpace: "nowrap", color: "var(--p-color-text-secondary)", fontSize: 12 }}>{children}</th>; }
function Cell({ children }: { children: React.ReactNode }) { return <td style={{ padding: "12px 16px", minWidth: 130, verticalAlign: "middle" }}>{children}</td>; }
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const rowStyle: React.CSSProperties = { borderTop: "1px solid var(--p-color-border-secondary)" };

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
