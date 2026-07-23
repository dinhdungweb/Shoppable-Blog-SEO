import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate, useRevalidator } from "@remix-run/react";
import { Prisma } from "@prisma/client";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  EmptyState,
  FormLayout,
  InlineGrid,
  InlineStack,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";

import {
  CONTENT_BRIEF_SECTIONS,
  contentBriefDraftInstruction,
  generateAiContentBrief,
  type AiContentBrief,
  type ContentBriefSection,
} from "../ai-content-brief.server";
import { generateAiBlogDraft } from "../ai-blog.server";
import { isNineRouterConfigured } from "../ai-seo.server";
import {
  buildContentBriefContext,
  type ContentBriefArticle,
  type ContentBriefContext,
  type ContentBriefProduct,
} from "../content-brief-context";
import prisma from "../db.server";
import { getPublicNineRouterErrorMessage } from "../nine-router.server";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";

const EMPTY_IMAGE = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";
type SerializedBrief = {
  id: string;
  title: string;
  seedKeyword: string;
  sourceArticleId: string;
  sourceArticleTitle: string;
  status: string;
  brief: AiContentBrief;
  hasDraft: boolean;
  createdAt: string;
  updatedAt: string;
};

type ActionResponse = {
  success?: boolean;
  error?: string;
  brief?: SerializedBrief;
  deletedId?: string;
  editorUrl?: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const { limits, planKey } = await getActivePlanAndLimits(billing, session.shop);
  const canUse = limits.canInternalLinking;
  if (!canUse) {
    return json({
      canUse,
      planKey,
      aiEnabled: false,
      searchConsoleConnected: false,
      articles: [] as Array<{ id: string; title: string }>,
      briefs: [] as SerializedBrief[],
    });
  }

  const [saved, articles, searchConnection] = await Promise.all([
    prisma.contentBrief.findMany({
      where: { shop: session.shop },
      orderBy: { updatedAt: "desc" },
      take: 30,
    }),
    fetchArticleChoices(admin),
    prisma.searchConsoleConnection.findUnique({
      where: { shop: session.shop },
      select: { selectedSiteUrl: true, lastSyncedAt: true },
    }),
  ]);

  return json({
    canUse,
    planKey,
    aiEnabled: isNineRouterConfigured(),
    searchConsoleConnected: Boolean(searchConnection?.selectedSiteUrl && searchConnection.lastSyncedAt),
    articles,
    briefs: saved.map(serializeBrief),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const { limits } = await getActivePlanAndLimits(billing, session.shop);
  if (!limits.canInternalLinking) {
    return json({ error: "AI Content Brief is available on Pro and Growth plans." }, { status: 403 });
  }

  const formData = await request.formData();
  const intent = clean(formData.get("intent"), 50);

  if (intent === "generate") {
    if (!isNineRouterConfigured()) return json({ error: "9Router is not configured on the server." }, { status: 503 });
    const title = clean(formData.get("title"), 255);
    const seedKeyword = clean(formData.get("seedKeyword"), 200);
    const audience = clean(formData.get("audience"), 500);
    const objective = clean(formData.get("objective"), 500);
    const sourceArticleId = clean(formData.get("sourceArticleId"), 255);
    if (!title && !seedKeyword) return json({ error: "Add a topic or seed keyword." }, { status: 400 });

    try {
      const context = await loadBriefContext(admin, session.shop, `${title} ${seedKeyword}`, sourceArticleId);
      const source = context.articles.find((article) => article.id === sourceArticleId);
      const brief = await generateAiContentBrief({
        title,
        seedKeyword,
        audience,
        objective,
        sourceArticleId,
        context,
      });
      const saved = await prisma.contentBrief.create({
        data: {
          shop: session.shop,
          title: brief.title,
          seedKeyword: brief.primaryKeyword || seedKeyword,
          sourceArticleId,
          sourceArticleTitle: source?.title || "",
          brief: brief as unknown as Prisma.InputJsonValue,
        },
      });
      return json({ success: true, brief: serializeBrief(saved) });
    } catch (error) {
      console.error("AI content brief generation failed", error instanceof Error ? error.message : String(error));
      return json({ error: getPublicNineRouterErrorMessage(error, "AI could not create the content brief. Please try again.") });
    }
  }

  if (intent === "regenerate_section") {
    if (!isNineRouterConfigured()) return json({ error: "9Router is not configured on the server." }, { status: 503 });
    const id = clean(formData.get("id"), 100);
    const section = clean(formData.get("section"), 50) as ContentBriefSection;
    if (!CONTENT_BRIEF_SECTIONS.includes(section)) return json({ error: "Choose a valid brief section." }, { status: 400 });
    const saved = await prisma.contentBrief.findFirst({ where: { id, shop: session.shop } });
    if (!saved) return json({ error: "This content brief no longer exists." }, { status: 404 });
    const current = saved.brief as unknown as AiContentBrief;

    try {
      const context = await loadBriefContext(
        admin,
        session.shop,
        `${current.title} ${current.primaryKeyword}`,
        saved.sourceArticleId,
      );
      const regenerated = await generateAiContentBrief({
        title: current.title,
        seedKeyword: current.primaryKeyword,
        audience: current.audience,
        objective: current.objective,
        sourceArticleId: saved.sourceArticleId,
        context,
        existingBrief: current,
        regenerateSection: section,
      });
      const brief = mergeBriefSection(current, regenerated, section);
      const updated = await prisma.contentBrief.update({
        where: { id: saved.id },
        data: {
          title: brief.title,
          seedKeyword: brief.primaryKeyword,
          brief: brief as unknown as Prisma.InputJsonValue,
          draft: Prisma.DbNull,
          status: "ready",
        },
      });
      return json({ success: true, brief: serializeBrief(updated) });
    } catch (error) {
      console.error("AI content brief section regeneration failed", error instanceof Error ? error.message : String(error));
      return json({ error: getPublicNineRouterErrorMessage(error, "AI could not regenerate this brief section. Please try again.") });
    }
  }

  if (intent === "generate_draft") {
    if (!isNineRouterConfigured()) return json({ error: "9Router is not configured on the server." }, { status: 503 });
    const id = clean(formData.get("id"), 100);
    const saved = await prisma.contentBrief.findFirst({ where: { id, shop: session.shop } });
    if (!saved) return json({ error: "This content brief no longer exists." }, { status: 404 });
    const brief = saved.brief as unknown as AiContentBrief;

    try {
      const draft = await generateAiBlogDraft({
        mode: "draft",
        title: brief.title,
        body: "",
        excerpt: "",
        primaryKeyword: brief.primaryKeyword,
        secondaryKeywords: brief.secondaryKeywords,
        instruction: contentBriefDraftInstruction(brief),
      });
      const updated = await prisma.contentBrief.update({
        where: { id: saved.id },
        data: {
          draft: draft as unknown as Prisma.InputJsonValue,
          status: "draft_ready",
        },
      });
      return json({
        success: true,
        brief: serializeBrief(updated),
        editorUrl: `/app/blogs/new?brief=${encodeURIComponent(saved.id)}`,
      });
    } catch (error) {
      console.error("Content brief draft generation failed", error instanceof Error ? error.message : String(error));
      return json({ error: getPublicNineRouterErrorMessage(error, "AI could not generate the article draft. Please try again.") });
    }
  }

  if (intent === "delete") {
    const id = clean(formData.get("id"), 100);
    const deleted = await prisma.contentBrief.deleteMany({ where: { id, shop: session.shop } });
    if (!deleted.count) return json({ error: "This content brief no longer exists." }, { status: 404 });
    return json({ success: true, deletedId: id });
  }

  return json({ error: "Unsupported action." }, { status: 400 });
};

export default function ContentBriefsPage() {
  const initial = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionResponse>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const handled = useRef<unknown>(null);
  const response = fetcher.data;
  const [topic, setTopic] = useState("");
  const [seedKeyword, setSeedKeyword] = useState("");
  const [audience, setAudience] = useState("");
  const [objective, setObjective] = useState("");
  const [sourceArticleId, setSourceArticleId] = useState("");
  const [selectedId, setSelectedId] = useState(initial.briefs[0]?.id || "");
  const [latestBrief, setLatestBrief] = useState<SerializedBrief | null>(null);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!response || handled.current === response) return;
    handled.current = response;
    if (response.error) shopify.toast.show(response.error, { isError: true });
    if (response.brief) {
      setLatestBrief(response.brief);
      setSelectedId(response.brief.id);
      shopify.toast.show(response.editorUrl ? "Draft created from the content brief" : "Content brief saved");
    }
    if (response.deletedId) {
      setLatestBrief(null);
      setDeletedIds((current) => [...current, response.deletedId!]);
      setSelectedId((current) => current === response.deletedId ? "" : current);
      revalidator.revalidate();
      shopify.toast.show("Content brief deleted");
    }
    if (response.editorUrl) navigate(response.editorUrl);
  }, [navigate, response, revalidator, shopify]);

  const briefs = useMemo(() => {
    const remaining = initial.briefs.filter((item) => !deletedIds.includes(item.id));
    if (!latestBrief || deletedIds.includes(latestBrief.id)) return remaining;
    return [latestBrief, ...remaining.filter((item) => item.id !== latestBrief.id)];
  }, [deletedIds, initial.briefs, latestBrief]);
  const selected = briefs.find((item) => item.id === selectedId) || briefs[0] || null;
  const busy = fetcher.state !== "idle";
  const activeIntent = String(fetcher.formData?.get("intent") || "");
  const activeSection = String(fetcher.formData?.get("section") || "");

  if (!initial.canUse) {
    return <Page><TitleBar title="AI Content Brief" /><Card><EmptyState heading="AI Content Brief is a Pro feature" action={{ content: "Upgrade plan", url: `/app/pricing?reason=content_brief&plan=${initial.planKey}` }} image={EMPTY_IMAGE}><p>Build keyword clusters, outlines, internal-link plans and product-placement ideas before drafting an article.</p></EmptyState></Card></Page>;
  }

  const generate = () => fetcher.submit(
    { intent: "generate", title: topic, seedKeyword, audience, objective, sourceArticleId },
    { method: "post" },
  );
  const submitBriefAction = (intent: string, extra: Record<string, string> = {}) => {
    if (!selected) return;
    fetcher.submit({ intent, id: selected.id, ...extra }, { method: "post" });
  };

  return <Page fullWidth>
    <TitleBar title="AI Content Brief & Keyword Cluster" />
    <BlockStack gap="500">
      <InlineStack align="space-between" blockAlign="end" gap="400">
        <BlockStack gap="100">
          <Text as="h1" variant="headingXl" fontWeight="bold">Plan before you publish</Text>
          <Text as="p" tone="subdued">Turn a topic into an evidence-backed keyword cluster, outline, linking plan and editable article draft.</Text>
        </BlockStack>
        {selected && <Button variant="primary" loading={busy && activeIntent === "generate_draft"} disabled={busy || !initial.aiEnabled} onClick={() => submitBriefAction("generate_draft")}>Generate article draft</Button>}
      </InlineStack>

      {!initial.aiEnabled && <Banner tone="critical" title="9Router is not configured"><p>Add the 9Router base URL, API key and model to the server environment before generating briefs.</p></Banner>}
      {!initial.searchConsoleConnected && <Banner tone="info" title="Keyword evidence is limited"><p>Connect and sync Google Search Console in SEO Optimizer. Briefs still work, but will not include store-specific query metrics until data is available.</p></Banner>}
      {response?.error && <Banner tone="critical"><p>{response.error}</p></Banner>}

      <InlineGrid columns={{ xs: 1, lg: "1fr 2fr" }} gap="500">
        <BlockStack gap="400">
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100"><Text as="h2" variant="headingMd">Create a new brief</Text><Text as="p" tone="subdued">Shopify articles, products and synced Search Console rows are used as the source set. AI-supplied resource IDs are verified before saving.</Text></BlockStack>
              <FormLayout>
                <TextField label="Topic or working title" value={topic} onChange={setTopic} autoComplete="off" placeholder="Example: How to choose a running shoe size" />
                <TextField label="Seed keyword" value={seedKeyword} onChange={setSeedKeyword} autoComplete="off" placeholder="running shoe sizing" />
                <TextField label="Audience (optional)" value={audience} onChange={setAudience} autoComplete="off" multiline={2} />
                <TextField label="Business/content objective (optional)" value={objective} onChange={setObjective} autoComplete="off" multiline={2} />
                <Select label="Use an existing article as context (optional)" value={sourceArticleId} onChange={setSourceArticleId} options={[{ label: "No source article", value: "" }, ...initial.articles.map((article) => ({ label: article.title, value: article.id }))]} />
                <Button variant="primary" fullWidth loading={busy && activeIntent === "generate"} disabled={busy || !initial.aiEnabled || (!topic.trim() && !seedKeyword.trim())} onClick={generate}>Generate content brief</Button>
              </FormLayout>
            </BlockStack>
          </Card>

          <Card padding="0">
            <Box padding="400"><Text as="h2" variant="headingMd">Saved briefs</Text></Box>
            <Divider />
            {briefs.length ? <BlockStack gap="0">{briefs.map((item) => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} style={briefButtonStyle(item.id === selected?.id)}><span><strong>{item.title}</strong><small>{item.seedKeyword || "No primary keyword"} · {formatDate(item.updatedAt)}</small></span><Badge tone={item.hasDraft ? "success" : "info"}>{item.hasDraft ? "Draft ready" : "Brief"}</Badge></button>)}</BlockStack> : <Box padding="500"><Text as="p" tone="subdued">No saved briefs yet.</Text></Box>}
          </Card>
        </BlockStack>

        {!selected ? <Card><EmptyState heading="Create your first content brief" action={{ content: "Generate brief", onAction: generate, disabled: !initial.aiEnabled || (!topic.trim() && !seedKeyword.trim()) }} image={EMPTY_IMAGE}><p>Start with a topic or seed keyword. Nothing is published automatically.</p></EmptyState></Card> : <BriefWorkspace brief={selected} busy={busy} activeSection={activeSection} regenerate={(section) => submitBriefAction("regenerate_section", { section })} generateDraft={() => submitBriefAction("generate_draft")} remove={() => { if (window.confirm("Delete this saved content brief? This cannot be undone.")) submitBriefAction("delete"); }} />}
      </InlineGrid>
    </BlockStack>
  </Page>;
}

function BriefWorkspace({ brief: saved, busy, activeSection, regenerate, generateDraft, remove }: {
  brief: SerializedBrief;
  busy: boolean;
  activeSection: string;
  regenerate: (section: ContentBriefSection) => void;
  generateDraft: () => void;
  remove: () => void;
}) {
  const brief = saved.brief;
  return <BlockStack gap="400">
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start" gap="300">
          <BlockStack gap="100"><Text as="h2" variant="headingLg">{brief.title}</Text><InlineStack gap="200"><Badge tone="success">{brief.searchIntent}</Badge><Badge tone="info">{brief.primaryKeyword || "Keyword pending"}</Badge>{saved.sourceArticleTitle && <Badge>{`Source: ${saved.sourceArticleTitle}`}</Badge>}</InlineStack></BlockStack>
          <InlineStack gap="200"><Button size="micro" loading={busy && activeSection === "strategy"} disabled={busy} onClick={() => regenerate("strategy")}>Regenerate strategy</Button><Button disabled={busy} tone="critical" onClick={remove}>Delete</Button><Button variant="primary" loading={busy && !activeSection} disabled={busy} onClick={generateDraft}>{saved.hasDraft ? "Regenerate draft" : "Generate draft"}</Button></InlineStack>
        </InlineStack>
        <Divider />
        <InlineGrid columns={{ xs: 1, md: 3 }} gap="300">
          <BriefFact label="Audience" value={brief.audience || "Not specified"} />
          <BriefFact label="Objective" value={brief.objective || "Not specified"} />
          <BriefFact label="Content angle" value={brief.contentAngle || "Not specified"} />
        </InlineGrid>
      </BlockStack>
    </Card>

    <BriefSection title="Keyword cluster" section="keywords" busy={busy} activeSection={activeSection} regenerate={regenerate}>
      <BlockStack gap="300"><BriefFact label="Primary keyword" value={brief.primaryKeyword || "Not specified"} /><TagList label="Secondary keywords" values={brief.secondaryKeywords} /><TagList label="Entities and subtopics" values={brief.entities} /></BlockStack>
      {brief.sourceQueries.length > 0 && <Box paddingBlockStart="300"><BlockStack gap="200"><Text as="h3" variant="headingSm">Search Console evidence</Text>{brief.sourceQueries.map((row) => <Box key={row.query} background="bg-surface-secondary" padding="300" borderRadius="200"><InlineStack align="space-between" gap="300"><BlockStack gap="050"><Text as="p" fontWeight="semibold">{row.query}</Text><Text as="p" variant="bodySm" tone="subdued">{row.rationale}</Text></BlockStack><Text as="span" variant="bodySm">{Math.round(row.impressions)} impressions · {Math.round(row.clicks)} clicks · position {row.position.toFixed(1)}</Text></InlineStack></Box>)}</BlockStack></Box>}
    </BriefSection>

    <BriefSection title="Recommended outline" section="outline" busy={busy} activeSection={activeSection} regenerate={regenerate}>
      <BlockStack gap="200">{brief.outline.map((item, index) => <Box key={`${item.level}-${index}`} paddingInlineStart={item.level === "h3" ? "600" : "0"}><InlineStack gap="300" wrap={false}><Badge tone={item.level === "h2" ? "info" : undefined}>{item.level.toUpperCase()}</Badge><BlockStack gap="050"><Text as="p" fontWeight="semibold">{item.heading}</Text>{item.purpose && <Text as="p" variant="bodySm" tone="subdued">{item.purpose}</Text>}</BlockStack></InlineStack></Box>)}</BlockStack>
    </BriefSection>

    <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
      <BriefSection title="Questions to answer" section="questions" busy={busy} activeSection={activeSection} regenerate={regenerate}><NumberedList items={brief.questions} empty="No priority questions were identified." /></BriefSection>
      <BriefSection title="Cannibalization review" section="risks" busy={busy} activeSection={activeSection} regenerate={regenerate}>{brief.cannibalizationRisks.length ? <BlockStack gap="300">{brief.cannibalizationRisks.map((risk) => <Box key={risk.articleId} background="bg-surface-warning" padding="300" borderRadius="200"><BlockStack gap="100"><Text as="p" fontWeight="semibold">{risk.articleTitle}</Text><Text as="p" variant="bodySm">{risk.reason}</Text><Text as="p" variant="bodySm" fontWeight="semibold">Action: {risk.action}</Text></BlockStack></Box>)}</BlockStack> : <Text as="p" tone="subdued">No related saved article was flagged as a strong cannibalization risk.</Text>}</BriefSection>
    </InlineGrid>

    <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
      <BriefSection title="Internal link plan" section="internalLinks" busy={busy} activeSection={activeSection} regenerate={regenerate}>{brief.internalLinks.length ? <BlockStack gap="300">{brief.internalLinks.map((link) => <ResourceIdea key={link.articleId} title={link.articleTitle} url={link.targetUrl} detail={`Anchor idea: ${link.anchorIdea || "Choose in context"}`} reason={link.reason} />)}</BlockStack> : <Text as="p" tone="subdued">No verified related article was relevant enough to recommend.</Text>}</BriefSection>
      <BriefSection title="Product placement plan" section="products" busy={busy} activeSection={activeSection} regenerate={regenerate}>{brief.productPlacements.length ? <BlockStack gap="300">{brief.productPlacements.map((product) => <ResourceIdea key={product.productId} title={product.productTitle} url={product.productUrl} detail={`Place near: ${product.section}`} reason={product.reason} />)}</BlockStack> : <Text as="p" tone="subdued">No verified catalog product was relevant enough to place.</Text>}</BriefSection>
    </InlineGrid>
  </BlockStack>;
}

function BriefSection({ title, section, busy, activeSection, regenerate, children }: {
  title: string;
  section: ContentBriefSection;
  busy: boolean;
  activeSection: string;
  regenerate: (section: ContentBriefSection) => void;
  children: React.ReactNode;
}) {
  return <Card><BlockStack gap="300"><InlineStack align="space-between" blockAlign="center"><Text as="h2" variant="headingMd">{title}</Text><Button size="micro" loading={busy && activeSection === section} disabled={busy} onClick={() => regenerate(section)}>Regenerate section</Button></InlineStack><Divider />{children}</BlockStack></Card>;
}

function BriefFact({ label, value }: { label: string; value: string }) {
  return <BlockStack gap="050"><Text as="p" variant="bodySm" tone="subdued">{label}</Text><Text as="p">{value}</Text></BlockStack>;
}

function TagList({ label, values }: { label: string; values: string[] }) {
  return <BlockStack gap="100"><Text as="p" variant="bodySm" tone="subdued">{label}</Text><InlineStack gap="150">{values.length ? values.map((value) => <Badge key={value}>{value}</Badge>) : <Text as="span" tone="subdued">None identified</Text>}</InlineStack></BlockStack>;
}

function NumberedList({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <Text as="p" tone="subdued">{empty}</Text>;
  return <ol style={{ margin: 0, paddingLeft: 22 }}>{items.map((item) => <li key={item} style={{ marginBottom: 8 }}>{item}</li>)}</ol>;
}

function ResourceIdea({ title, url, detail, reason }: { title: string; url: string; detail: string; reason: string }) {
  return <Box background="bg-surface-secondary" padding="300" borderRadius="200"><BlockStack gap="100"><InlineStack align="space-between" gap="200"><Text as="p" fontWeight="semibold">{title}</Text><Badge>{url}</Badge></InlineStack><Text as="p" variant="bodySm">{detail}</Text><Text as="p" variant="bodySm" tone="subdued">{reason}</Text></BlockStack></Box>;
}

function mergeBriefSection(current: AiContentBrief, next: AiContentBrief, section: ContentBriefSection): AiContentBrief {
  if (section === "strategy") return { ...current, title: next.title, searchIntent: next.searchIntent, audience: next.audience, objective: next.objective, contentAngle: next.contentAngle };
  if (section === "keywords") return { ...current, primaryKeyword: next.primaryKeyword, secondaryKeywords: next.secondaryKeywords, entities: next.entities, sourceQueries: next.sourceQueries };
  if (section === "outline") return { ...current, outline: next.outline };
  if (section === "questions") return { ...current, questions: next.questions };
  if (section === "internalLinks") return { ...current, internalLinks: next.internalLinks };
  if (section === "products") return { ...current, productPlacements: next.productPlacements };
  return { ...current, cannibalizationRisks: next.cannibalizationRisks };
}

async function loadBriefContext(admin: any, shop: string, seed: string, sourceArticleId: string): Promise<ContentBriefContext> {
  const [articles, products, seoRows, searchConnection] = await Promise.all([
    fetchAllArticles(admin),
    fetchAllProducts(admin),
    prisma.articleSEO.findMany({ where: { shop }, select: { articleId: true, focusKeyword: true } }),
    prisma.searchConsoleConnection.findUnique({ where: { shop }, select: { selectedSiteUrl: true } }),
  ]);
  const focusKeywords = new Map(seoRows.map((row) => [row.articleId, row.focusKeyword || ""]));
  const metrics = searchConnection?.selectedSiteUrl ? await prisma.searchConsoleMetric.findMany({
    where: {
      shop,
      siteUrl: searchConnection.selectedSiteUrl,
      windowDays: 28,
      period: "current",
      query: { not: "" },
    },
    select: { pageUrl: true, query: true, clicks: true, impressions: true, ctr: true, position: true },
    orderBy: { impressions: "desc" },
    take: 500,
  }) : [];
  return buildContentBriefContext(seed, sourceArticleId, {
    articles: articles.map((article) => ({ ...article, focusKeyword: focusKeywords.get(article.id) || "" })),
    products,
    queries: metrics,
  });
}

async function fetchAllArticles(admin: any): Promise<Omit<ContentBriefArticle, "focusKeyword">[]> {
  const articles: Omit<ContentBriefArticle, "focusKeyword">[] = [];
  let cursor: string | null = null;
  do {
    const response = await admin.graphql(`#graphql
      query ContentBriefArticles($after: String) {
        articles(first: 100, after: $after) {
          nodes { id title handle body blog { handle } }
          pageInfo { hasNextPage endCursor }
        }
      }`, { variables: { after: cursor } });
    const result: any = await response.json();
    if (result.errors?.length) throw new Error(result.errors.map((item: any) => item.message).join("; "));
    for (const article of result.data?.articles?.nodes || []) articles.push({
      id: article.id,
      title: article.title || "Untitled post",
      handle: article.handle || "",
      blogHandle: article.blog?.handle || "",
      body: article.body || "",
    });
    cursor = result.data?.articles?.pageInfo?.hasNextPage ? result.data.articles.pageInfo.endCursor : null;
  } while (cursor && articles.length < 500);
  return articles;
}

async function fetchAllProducts(admin: any): Promise<ContentBriefProduct[]> {
  const products: ContentBriefProduct[] = [];
  let cursor: string | null = null;
  do {
    const response = await admin.graphql(`#graphql
      query ContentBriefProducts($after: String) {
        products(first: 100, after: $after, query: "status:active") {
          nodes { id title handle descriptionHtml productType vendor }
          pageInfo { hasNextPage endCursor }
        }
      }`, { variables: { after: cursor } });
    const result: any = await response.json();
    if (result.errors?.length) throw new Error(result.errors.map((item: any) => item.message).join("; "));
    for (const product of result.data?.products?.nodes || []) products.push({
      id: product.id,
      title: product.title || "Untitled product",
      handle: product.handle || "",
      description: product.descriptionHtml || "",
      productType: product.productType || "",
      vendor: product.vendor || "",
    });
    cursor = result.data?.products?.pageInfo?.hasNextPage ? result.data.products.pageInfo.endCursor : null;
  } while (cursor && products.length < 500);
  return products;
}

async function fetchArticleChoices(admin: any): Promise<Array<{ id: string; title: string }>> {
  const response = await admin.graphql(`#graphql
    query ContentBriefArticleChoices {
      articles(first: 100, sortKey: UPDATED_AT, reverse: true) { nodes { id title } }
    }`);
  const result: any = await response.json();
  if (result.errors?.length) return [];
  return (result.data?.articles?.nodes || []).map((article: any) => ({ id: article.id, title: article.title || "Untitled post" }));
}

function serializeBrief(row: {
  id: string;
  title: string;
  seedKeyword: string;
  sourceArticleId: string;
  sourceArticleTitle: string;
  status: string;
  brief: unknown;
  draft: unknown;
  createdAt: Date;
  updatedAt: Date;
}): SerializedBrief {
  return {
    id: row.id,
    title: row.title,
    seedKeyword: row.seedKeyword,
    sourceArticleId: row.sourceArticleId,
    sourceArticleTitle: row.sourceArticleTitle,
    status: row.status,
    brief: row.brief as AiContentBrief,
    hasDraft: Boolean(row.draft),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function clean(value: FormDataEntryValue | null, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function briefButtonStyle(active: boolean): React.CSSProperties {
  return {
    appearance: "none",
    border: 0,
    borderBottom: "1px solid var(--p-color-border-secondary)",
    background: active ? "var(--p-color-bg-surface-secondary-active)" : "transparent",
    color: "inherit",
    cursor: "pointer",
    display: "flex",
    gap: 12,
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    textAlign: "left",
    width: "100%",
  };
}
