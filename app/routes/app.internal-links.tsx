import crypto from "node:crypto";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useRevalidator } from "@remix-run/react";
import type { Prisma } from "@prisma/client";
import { Badge, Banner, BlockStack, Box, Button, Card, Divider, EmptyState, InlineGrid, InlineStack, Layout, Modal, Page, Tabs, Text } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { analyzeInternalLinks, hasInternalLinkTarget, insertApprovedLink, previewApprovedLink } from "../internal-linking";
import type { InternalLinkReport, LinkArticle, LinkSuggestion } from "../internal-linking";
import { generateAiInternalLinkSuggestions } from "../ai-internal-linking.server";
import { isNineRouterConfigured } from "../ai-seo.server";
import { getPublicNineRouterErrorMessage } from "../nine-router.server";
import prisma from "../db.server";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import { fetchShopDomains } from "../shopify-domains.server";
import {
  CONTENT_WORKSPACE_TABS,
  WorkspaceTabs,
} from "../components/WorkspaceTabs";

const EMPTY_IMAGE = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const { limits, planKey } = await getActivePlanAndLimits(billing, session.shop);
  if (!limits.canInternalLinking) {
    return json({ report: null, analyzedAt: null, canInternalLinking: false, planKey, aiEnabled: false, history: [] });
  }
  const saved = await prisma.internalLinkAnalysis.findUnique({ where: { shop: session.shop } });
  const savedReport = saved?.report as unknown as InternalLinkReport | undefined;
  const history = await prisma.internalLinkChange.findMany({
    where: { shop: session.shop },
    orderBy: { appliedAt: "desc" },
    take: 10,
  });
  return json({
    report: savedReport && savedReport.auditVersion >= 2 ? savedReport : null,
    analyzedAt: saved?.analyzedAt.toISOString() || null,
    canInternalLinking: true,
    planKey,
    aiEnabled: isNineRouterConfigured(),
    history: history.map((change) => ({
      id: change.id,
      articleId: change.articleId,
      articleTitle: change.articleTitle,
      suggestions: change.suggestions,
      status: change.status,
      appliedAt: change.appliedAt.toISOString(),
      undoneAt: change.undoneAt?.toISOString() || null,
    })),
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

  if (intent === "generate_ai") {
    if (!isNineRouterConfigured()) {
      return json({ error: "9Router is not configured on the server." }, { status: 503 });
    }
    try {
      const [articles, productHandles, shopDomains] = await Promise.all([
        fetchArticles(admin),
        fetchProductHandles(admin),
        fetchShopDomains(admin, session.shop),
      ]);
      const report = analyzeInternalLinks(articles, productHandles, shopDomains);
      if (!report.suggestions.length) {
        return json({ error: "No deterministic link candidates are available for AI review." }, { status: 400 });
      }
      const suggestions = await generateAiInternalLinkSuggestions({ articles, suggestions: report.suggestions });
      const aiReport: InternalLinkReport = { ...report, auditVersion: 3, suggestions };
      const analyzedAt = new Date();
      await prisma.internalLinkAnalysis.upsert({
        where: { shop: session.shop },
        update: { report: aiReport as unknown as Prisma.InputJsonValue, analyzedAt },
        create: { shop: session.shop, report: aiReport as unknown as Prisma.InputJsonValue, analyzedAt },
      });
      return json({ success: true, report: aiReport, analyzedAt: analyzedAt.toISOString(), aiGenerated: true });
    } catch (error) {
      const message = getPublicNineRouterErrorMessage(error, "AI could not review the internal link candidates. Please try again.");
      return json({ error: message });
    }
  }

  if (intent === "apply_batch") {
    let items: Array<{ id: string; anchorText: string }>;
    try {
      items = parseApplyPayload(String(formData.get("payload") || ""));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "The approved links are invalid." }, { status: 400 });
    }
    const saved = await prisma.internalLinkAnalysis.findUnique({ where: { shop: session.shop } });
    const report = saved?.report as unknown as InternalLinkReport | undefined;
    if (!report || report.auditVersion < 3) {
      return json({ error: "Generate fresh AI suggestions before applying links." }, { status: 409 });
    }
    const allowed = new Map(report.suggestions.map((suggestion) => [suggestion.id, suggestion]));
    const selected = items.map((item) => ({ item, suggestion: allowed.get(item.id) })).filter((entry) => entry.suggestion);
    if (!selected.length) return json({ error: "None of the selected AI suggestions is still available." }, { status: 409 });

    const grouped = new Map<string, typeof selected>();
    selected.forEach((entry) => {
      const sourceId = entry.suggestion!.sourceId;
      grouped.set(sourceId, [...(grouped.get(sourceId) || []), entry]);
    });

    const batchId = crypto.randomUUID();
    let appliedLinks = 0;
    let updatedArticles = 0;
    const failures: string[] = [];

    for (const [sourceId, entries] of grouped) {
      try {
        const source = await fetchArticle(admin, sourceId);
        if (!source) throw new Error("The source article no longer exists.");
        const targetIds = [...new Set(entries.map((entry) => entry.suggestion!.targetId))];
        const targets = new Map(
          (await Promise.all(targetIds.map((targetId) => fetchArticle(admin, targetId))))
            .filter((article): article is LinkArticle => Boolean(article))
            .map((article) => [article.id, article]),
        );
        let body = source.body;
        const appliedSuggestions: Array<{ id: string; targetId: string; targetTitle: string; targetUrl: string; anchorText: string }> = [];

        for (const { item, suggestion } of entries) {
          if (!suggestion) continue;
          const target = targets.get(suggestion.targetId);
          if (!target || target.id === source.id) continue;
          const targetUrl = `/blogs/${target.blogHandle}/${target.handle}`.toLowerCase();
          if (targetUrl !== suggestion.targetUrl.toLowerCase()) continue;
          if (hasInternalLinkTarget(body, targetUrl)) continue;
          const allowedAnchors = new Set([suggestion.anchorText, ...(suggestion.anchorOptions || [])].map(cleanAnchor));
          const anchorText = cleanAnchor(item.anchorText);
          if (!anchorText || !allowedAnchors.has(anchorText)) continue;
          const preview = previewApprovedLink(body, anchorText, targetUrl);
          if (!preview.insertedInContext) continue;
          body = preview.body;
          appliedSuggestions.push({
            id: suggestion.id,
            targetId: target.id,
            targetTitle: target.title,
            targetUrl,
            anchorText,
          });
        }

        if (!appliedSuggestions.length || body === source.body) {
          failures.push(`${source.title}: no safe context match remained.`);
          continue;
        }
        await updateArticleBody(admin, source.id, body);
        try {
          await prisma.internalLinkChange.create({
            data: {
              batchId,
              shop: session.shop,
              articleId: source.id,
              articleTitle: source.title,
              beforeBody: source.body,
              afterBody: body,
              suggestions: appliedSuggestions as unknown as Prisma.InputJsonValue,
            },
          });
        } catch (error) {
          await updateArticleBody(admin, source.id, source.body).catch((rollbackError) => {
            console.error("Internal link history failed and Shopify rollback also failed", { sourceId, rollbackError });
          });
          throw error;
        }
        updatedArticles += 1;
        appliedLinks += appliedSuggestions.length;
      } catch (error) {
        console.error("AI internal link batch apply failed", { sourceId, error });
        failures.push(error instanceof Error ? error.message : `Could not update ${sourceId}.`);
      }
    }

    if (!appliedLinks) return json({ error: failures[0] || "No safe internal links could be applied." }, { status: 409 });
    await prisma.internalLinkAnalysis.deleteMany({ where: { shop: session.shop } });
    return json({
      success: true,
      applied: appliedLinks,
      updatedArticles,
      warning: failures.length ? `${failures.length} article(s) were skipped because their content changed or no safe anchor remained.` : "",
    });
  }

  if (intent === "undo") {
    const changeId = String(formData.get("changeId") || "");
    const change = await prisma.internalLinkChange.findFirst({
      where: { id: changeId, shop: session.shop, status: "applied" },
    });
    if (!change) return json({ error: "This internal link change is unavailable or already undone." }, { status: 404 });
    try {
      const article = await fetchArticle(admin, change.articleId);
      if (!article) return json({ error: "The changed article no longer exists." }, { status: 404 });
      if (article.body !== change.afterBody) {
        return json({ error: "This article changed after the links were applied. Undo was stopped to protect the newer content." }, { status: 409 });
      }
      await updateArticleBody(admin, change.articleId, change.beforeBody);
      await prisma.internalLinkChange.update({
        where: { id: change.id },
        data: { status: "undone", undoneAt: new Date() },
      });
      await prisma.internalLinkAnalysis.deleteMany({ where: { shop: session.shop } });
      return json({ success: true, undone: true });
    } catch (error) {
      console.error("Internal link undo failed", error);
      return json({ error: error instanceof Error ? error.message : "Could not undo the internal link change." }, { status: 500 });
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
  const aiFetcher = useFetcher<typeof action>();
  const applyFetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const handledApply = useRef<unknown>(null);
  const handledAi = useRef<unknown>(null);
  const analysisData = analyzeFetcher.data as { report?: InternalLinkReport; analyzedAt?: string; error?: string } | undefined;
  const aiData = aiFetcher.data as { report?: InternalLinkReport; analyzedAt?: string; aiGenerated?: boolean; error?: string } | undefined;
  const applyData = applyFetcher.data as { applied?: number | boolean; updatedArticles?: number; undone?: boolean; warning?: string; error?: string } | undefined;
  const latestSnapshot = latestReportSnapshot([
    { report: initialData.report, analyzedAt: initialData.analyzedAt },
    { report: analysisData?.report, analyzedAt: analysisData?.analyzedAt },
    { report: aiData?.report, analyzedAt: aiData?.analyzedAt },
  ]);
  const report = latestSnapshot.report;
  const analyzedAt = latestSnapshot.analyzedAt;
  const [selectedTab, setSelectedTab] = useState(0);
  const [pendingSuggestion, setPendingSuggestion] = useState<LinkSuggestion | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchPreview, setBatchPreview] = useState(false);
  const [undoneChanges, setUndoneChanges] = useState<string[]>([]);
  const selectedSuggestions = useMemo(
    () => (report?.suggestions || []).filter((suggestion) => selectedIds.includes(suggestion.id)),
    [report, selectedIds],
  );

  useEffect(() => {
    if (!aiData || handledAi.current === aiData) return;
    handledAi.current = aiData;
    if (aiData.aiGenerated) {
      setSelectedIds([]);
      setSelectedTab(1);
      shopify.toast.show(`${aiData.report?.suggestions.length || 0} AI-reviewed internal link suggestions ready`);
    } else if (aiData.error) {
      shopify.toast.show(aiData.error, { isError: true });
    }
  }, [aiData, shopify]);

  useEffect(() => {
    if (!applyData || handledApply.current === applyData) return;
    handledApply.current = applyData;
    if (applyData.undone) {
      const changeId = String(applyFetcher.formData?.get("changeId") || "");
      if (changeId) setUndoneChanges((items) => [...new Set([...items, changeId])]);
      shopify.toast.show("Internal link change undone");
      revalidator.revalidate();
      analyzeFetcher.submit({ intent: "analyze" }, { method: "post" });
    } else if (applyData.applied) {
      setPendingSuggestion(null);
      setBatchPreview(false);
      setSelectedIds([]);
      const count = typeof applyData.applied === "number" ? applyData.applied : 1;
      shopify.toast.show(`${count} internal link${count === 1 ? "" : "s"} applied`);
      if (applyData.warning) shopify.toast.show(applyData.warning, { isError: true });
      revalidator.revalidate();
      analyzeFetcher.submit({ intent: "analyze" }, { method: "post" });
    } else if (applyData.error) {
      shopify.toast.show(applyData.error, { isError: true });
    }
  }, [analyzeFetcher, applyData, applyFetcher.formData, revalidator, shopify]);

  const analyzing = analyzeFetcher.state !== "idle";
  const generatingAi = aiFetcher.state !== "idle";
  const applying = applyFetcher.state !== "idle";
  const runAnalysis = () => analyzeFetcher.submit({ intent: "analyze" }, { method: "post" });
  const runAiReview = () => aiFetcher.submit({ intent: "generate_ai" }, { method: "post" });
  const openReview = (suggestion: LinkSuggestion) => {
    setPendingSuggestion(suggestion);
    setPendingAnchor(suggestion.anchorText);
  };
  const toggleSuggestion = (id: string) => {
    setSelectedIds((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  };
  const submitSuggestions = (suggestions: LinkSuggestion[], anchorOverride?: string) => {
    const payload = suggestions.map((suggestion) => ({
      id: suggestion.id,
      anchorText: suggestion.id === pendingSuggestion?.id && anchorOverride ? anchorOverride : suggestion.anchorText,
    }));
    applyFetcher.submit({ intent: "apply_batch", payload: JSON.stringify(payload) }, { method: "post" });
  };

  if (!initialData.canInternalLinking) {
    return (
      <Page>
        <TitleBar title="Internal Linking Assistant" />
        <BlockStack gap="500">
          <WorkspaceTabs tabs={CONTENT_WORKSPACE_TABS} activeId="links" />
          <Card>
            <EmptyState
              heading="Internal Linking Assistant is a Pro feature"
              action={{ content: "Upgrade to Pro", url: `/app/pricing?reason=internal_linking&plan=${initialData.planKey}` }}
              image={EMPTY_IMAGE}
            >
              <p>Upgrade to analyze related Shopify articles, broken destinations, repeated anchors and topic clusters, then insert approved links.</p>
            </EmptyState>
          </Card>
        </BlockStack>
      </Page>
    );
  }

  return (
    <Page fullWidth>
      <TitleBar title="AI Internal Link Copilot">
        <button variant="primary" disabled={analyzing || generatingAi} onClick={runAnalysis}>{analyzing ? "Analyzing..." : "Analyze links"}</button>
      </TitleBar>
      <BlockStack gap="500">
        <WorkspaceTabs tabs={CONTENT_WORKSPACE_TABS} activeId="links" />
        <InlineStack align="space-between" blockAlign="end">
          <BlockStack gap="100">
            <Text as="h1" variant="headingXl" fontWeight="bold">AI Internal Link Copilot</Text>
            <Text as="p" tone="subdued">Find related content, verify semantic relevance and exact anchors with AI, then review every change before applying it.</Text>
          </BlockStack>
          <InlineStack gap="200">
            {report && <Button disabled={!initialData.aiEnabled || analyzing} loading={generatingAi} onClick={runAiReview}>
              {initialData.aiEnabled ? "Review with AI" : "AI not configured"}
            </Button>}
            <Button variant="primary" loading={analyzing} disabled={generatingAi} onClick={runAnalysis}>{report ? "Refresh analysis" : "Analyze links"}</Button>
          </InlineStack>
        </InlineStack>

        {analysisData?.error && <Card><Text as="p" tone="critical">{analysisData.error}</Text></Card>}
        {aiData?.error && <Banner tone="critical" title="AI review unavailable"><p>{aiData.error}</p></Banner>}
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
          {selectedTab === 1 && <SuggestionsTable
            report={report}
            selectedIds={selectedIds}
            aiEnabled={initialData.aiEnabled}
            generatingAi={generatingAi}
            onGenerateAi={runAiReview}
            onToggle={toggleSuggestion}
            onReview={openReview}
            onPreviewSelected={() => setBatchPreview(true)}
          />}
          {selectedTab === 2 && <IssuesPanel report={report} />}
          {selectedTab === 3 && <ClustersPanel report={report} />}
          <ChangeHistory
            history={initialData.history}
            undoneChanges={undoneChanges}
            applying={applying}
            activeChangeId={String(applyFetcher.formData?.get("changeId") || "")}
            onUndo={(changeId) => applyFetcher.submit({ intent: "undo", changeId }, { method: "post" })}
          />
        </>}
      </BlockStack>
      <Modal
        open={Boolean(pendingSuggestion)}
        onClose={() => !applying && setPendingSuggestion(null)}
        title="Review internal link"
        primaryAction={{
          content: "Apply this link",
          loading: applying,
          disabled: !pendingSuggestion || !pendingAnchor,
          onAction: () => pendingSuggestion && submitSuggestions([pendingSuggestion], pendingAnchor),
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
            {pendingSuggestion.aiExplanation && <BlockStack gap="150">
              <Text as="p" variant="bodySm" tone="subdued">Why AI recommends this link</Text>
              <Text as="p">{pendingSuggestion.aiExplanation}</Text>
              <InlineStack gap="200">
                <Badge tone="info">{`Topic ${pendingSuggestion.score}%`}</Badge>
                <Badge tone={(pendingSuggestion.aiScore || 0) >= 70 ? "success" : "info"}>{`AI relevance ${pendingSuggestion.aiScore || 0}%`}</Badge>
              </InlineStack>
              {Boolean(pendingSuggestion.aiWarnings?.length) && <Banner tone="warning" title="Review this risk before applying">
                <p>{pendingSuggestion.aiWarnings!.map(warningLabel).join(" · ")}</p>
              </Banner>}
            </BlockStack>}
            <Divider />
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">Choose an exact anchor from the source article</Text>
              <InlineStack gap="200" wrap>
                {(pendingSuggestion.anchorOptions || [pendingSuggestion.anchorText]).map((anchor) => (
                  <Button key={anchor} size="micro" variant={pendingAnchor === anchor ? "primary" : "secondary"} onClick={() => setPendingAnchor(anchor)}>{anchor}</Button>
                ))}
              </InlineStack>
            </BlockStack>
            <Divider />
            <PreviewBlock before={previewForAnchor(pendingSuggestion, pendingAnchor).before} after={previewForAnchor(pendingSuggestion, pendingAnchor).after} />
          </BlockStack>}
        </Modal.Section>
      </Modal>
      <Modal
        open={batchPreview}
        onClose={() => !applying && setBatchPreview(false)}
        title={`Review ${selectedSuggestions.length} internal links`}
        primaryAction={{
          content: `Apply ${selectedSuggestions.length} links`,
          loading: applying,
          disabled: !selectedSuggestions.length,
          onAction: () => submitSuggestions(selectedSuggestions),
        }}
        secondaryActions={[{ content: "Continue reviewing", disabled: applying, onAction: () => setBatchPreview(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="500">
            <Banner tone="warning"><p>These links update Shopify articles. If an article changed after this review, stale or unsafe suggestions are skipped.</p></Banner>
            {selectedSuggestions.map((suggestion) => (
              <BlockStack gap="200" key={suggestion.id}>
                <Text as="h3" fontWeight="semibold">{suggestion.sourceTitle} → {suggestion.targetTitle}</Text>
                {suggestion.aiExplanation && <Text as="p" variant="bodySm">{suggestion.aiExplanation}</Text>}
                {Boolean(suggestion.aiWarnings?.length) && <Text as="p" variant="bodySm" tone="caution">{suggestion.aiWarnings!.map(warningLabel).join(" · ")}</Text>}
                <PreviewBlock before={suggestion.previewBefore || ""} after={suggestion.previewAfter || ""} />
                <Divider />
              </BlockStack>
            ))}
          </BlockStack>
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

function SuggestionsTable({
  report,
  selectedIds,
  aiEnabled,
  generatingAi,
  onGenerateAi,
  onToggle,
  onReview,
  onPreviewSelected,
}: {
  report: InternalLinkReport;
  selectedIds: string[];
  aiEnabled: boolean;
  generatingAi: boolean;
  onGenerateAi: () => void;
  onToggle: (id: string) => void;
  onReview: (suggestion: LinkSuggestion) => void;
  onPreviewSelected: () => void;
}) {
  const aiReviewed = report.auditVersion >= 3;
  const visible = report.suggestions.slice(0, 50);
  const selectable = visible.filter((suggestion) => Boolean(suggestion.aiExplanation && suggestion.insertedInContext));
  const allSelected = selectable.length > 0 && selectable.every((suggestion) => selectedIds.includes(suggestion.id));
  const toggleAll = () => selectable.forEach((suggestion) => {
    if (allSelected === selectedIds.includes(suggestion.id)) onToggle(suggestion.id);
  });

  return <Card padding="0">
    <Box padding="400">
      <InlineStack align="space-between" blockAlign="center" gap="300">
        <BlockStack gap="100">
          <InlineStack gap="200" blockAlign="center">
            <Text as="h2" variant="headingMd">{aiReviewed ? "AI-reviewed internal links" : "Deterministic link candidates"}</Text>
            <Badge tone={aiReviewed ? "success" : "info"}>{aiReviewed ? "AI reviewed" : "Needs AI review"}</Badge>
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued">
            {aiReviewed
              ? "Every selectable anchor was matched to exact source text. Review the explanation and before/after context before applying."
              : "Topic overlap creates a safe candidate list. Ask AI to check reader value, semantic relevance and exact anchor context."}
          </Text>
        </BlockStack>
        <InlineStack gap="200">
          {!aiReviewed && <Button disabled={!aiEnabled} loading={generatingAi} onClick={onGenerateAi}>{aiEnabled ? "Review with AI" : "AI not configured"}</Button>}
          {aiReviewed && <Button variant="primary" disabled={!selectedIds.length} onClick={onPreviewSelected}>{`Review selected (${selectedIds.length})`}</Button>}
        </InlineStack>
      </InlineStack>
    </Box>
    <Divider />
    {report.suggestions.length ? <div style={{ overflowX: "auto" }}><table style={tableStyle}>
      <thead><tr>
        {aiReviewed && <Header><input type="checkbox" aria-label="Select all AI suggestions" checked={allSelected} onChange={toggleAll} /></Header>}
        <Header>Link from</Header><Header>Link to</Header><Header>Suggested anchor</Header><Header>Relevance</Header><Header>Why it helps</Header><Header>Action</Header>
      </tr></thead>
      <tbody>{visible.map((suggestion) => {
        const canSelect = Boolean(suggestion.aiExplanation && suggestion.insertedInContext);
        return <tr key={suggestion.id} style={rowStyle}>
          {aiReviewed && <Cell><input type="checkbox" aria-label={`Select ${suggestion.sourceTitle} to ${suggestion.targetTitle}`} disabled={!canSelect} checked={selectedIds.includes(suggestion.id)} onChange={() => onToggle(suggestion.id)} /></Cell>}
          <Cell><strong>{suggestion.sourceTitle}</strong><br /><span style={{ color: "var(--p-color-text-secondary)", fontSize: 12 }}>Source article</span></Cell>
          <Cell>{suggestion.targetTitle}<br /><span style={{ color: "var(--p-color-text-secondary)", fontSize: 12 }}>{suggestion.targetUrl}</span></Cell>
          <Cell><code>{suggestion.anchorText}</code></Cell>
          <Cell><BlockStack gap="100"><Badge tone={suggestion.score >= 25 ? "success" : "info"}>{`Topic ${suggestion.score}%`}</Badge>{suggestion.aiScore !== undefined && <Badge tone={suggestion.aiScore >= 70 ? "success" : "info"}>{`AI ${suggestion.aiScore}%`}</Badge>}</BlockStack></Cell>
          <Cell><BlockStack gap="100"><Text as="p" variant="bodySm">{suggestion.aiExplanation || "Run AI review to validate semantic relevance and exact context."}</Text>{suggestion.aiWarnings?.map((warning) => <Badge key={warning} tone="warning">{warningLabel(warning)}</Badge>)}</BlockStack></Cell>
          <Cell><Button size="micro" disabled={!aiReviewed || !canSelect} onClick={() => onReview(suggestion)}>Review</Button></Cell>
        </tr>;
      })}</tbody>
    </table></div> : <Box padding="500"><Text as="p" tone="subdued">No new related-link suggestions were found.</Text></Box>}
  </Card>;
}

function PreviewBlock({ before, after }: { before: string; after: string }) {
  return <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
    <BlockStack gap="100">
      <Text as="p" variant="bodySm" tone="subdued">Before</Text>
      <Box background="bg-surface-secondary" padding="300" borderRadius="300"><Text as="p" variant="bodySm">{visiblePreview(before) || "(No preview available)"}</Text></Box>
    </BlockStack>
    <BlockStack gap="100">
      <Text as="p" variant="bodySm" tone="subdued">After</Text>
      <Box background="bg-surface-success" padding="300" borderRadius="300"><Text as="p" variant="bodySm">{visiblePreview(after) || "(No preview available)"}</Text></Box>
    </BlockStack>
  </InlineGrid>;
}

function ChangeHistory({
  history,
  undoneChanges,
  applying,
  activeChangeId,
  onUndo,
}: {
  history: Array<{ id: string; articleId: string; articleTitle: string; suggestions: unknown; status: string; appliedAt: string; undoneAt: string | null }>;
  undoneChanges: string[];
  applying: boolean;
  activeChangeId: string;
  onUndo: (changeId: string) => void;
}) {
  if (!history.length) return null;
  return <Card>
    <BlockStack gap="300">
      <Text as="h2" variant="headingMd">Recent AI internal link changes</Text>
      <Text as="p" variant="bodySm" tone="subdued">Undo is allowed only while the Shopify article still matches the version written by Copilot.</Text>
      {history.map((change) => {
        const undone = change.status !== "applied" || undoneChanges.includes(change.id);
        const count = Array.isArray(change.suggestions) ? change.suggestions.length : 0;
        return <InlineStack key={change.id} align="space-between" blockAlign="center" gap="300">
          <BlockStack gap="050">
            <Text as="p" fontWeight="semibold">{change.articleTitle}</Text>
            <Text as="p" variant="bodySm" tone="subdued">{undone ? "Undone" : `${count} link${count === 1 ? "" : "s"} applied ${formatAnalyzedAt(change.appliedAt)}`}</Text>
          </BlockStack>
          <InlineStack gap="200">
            <Button size="micro" url={articleEditorUrl(change.articleId)}>Open article</Button>
            <Button size="micro" disabled={undone || applying} loading={applying && activeChangeId === change.id} onClick={() => onUndo(change.id)}>Undo</Button>
          </InlineStack>
        </InlineStack>;
      })}
    </BlockStack>
  </Card>;
}

function previewForAnchor(suggestion: LinkSuggestion, anchorText: string) {
  return suggestion.anchorPreviews?.find((preview) => preview.anchorText === anchorText)
    || { before: suggestion.previewBefore || "", after: suggestion.previewAfter || "" };
}

function visiblePreview(value: string) {
  return value
    .replace(/<a\b[^>]*>/gi, "[")
    .replace(/<\/a>/gi, "]")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function warningLabel(value: string) {
  if (value === "possible_cannibalization") return "Possible keyword cannibalization";
  if (value === "anchor_overuse") return "Anchor may be overused";
  return "Anchor may be ambiguous";
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
function latestReportSnapshot(snapshots: Array<{ report?: InternalLinkReport | null; analyzedAt?: string | null }>) {
  const latest = snapshots
    .filter((snapshot): snapshot is { report: InternalLinkReport; analyzedAt: string | null | undefined } => Boolean(snapshot.report))
    .sort((left, right) => timestamp(right.analyzedAt) - timestamp(left.analyzedAt))[0];
  return latest ? { report: latest.report, analyzedAt: latest.analyzedAt || null } : { report: null, analyzedAt: null };
}
function timestamp(value?: string | null) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? parsed : 0; }

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

async function updateArticleBody(admin: any, id: string, body: string) {
  const response = await admin.graphql(`#graphql
    mutation UpdateInternalLinkArticle($id: ID!, $article: ArticleUpdateInput!) {
      articleUpdate(id: $id, article: $article) {
        article { id }
        userErrors { field message }
      }
    }
  `, { variables: { id, article: { body } } });
  const result: any = await response.json();
  const errors = [...(result.errors || []), ...(result.data?.articleUpdate?.userErrors || [])];
  if (errors.length) throw new Error(errors.map((item: any) => item.message).join("; "));
}

function parseApplyPayload(value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("The approved link payload is invalid.");
  }
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > 25) {
    throw new Error("Choose between 1 and 25 AI link suggestions.");
  }
  const items: Array<{ id: string; anchorText: string }> = [];
  const seen = new Set<string>();
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") throw new Error("The approved link payload is invalid.");
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim().slice(0, 500) : "";
    const anchorText = cleanAnchor(typeof item.anchorText === "string" ? item.anchorText : "");
    if (!id || !anchorText || seen.has(id)) throw new Error("Each approved link must have one valid suggestion and anchor.");
    items.push({ id, anchorText });
    seen.add(id);
  }
  return items;
}

function cleanAnchor(value: string) { return value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 120); }
