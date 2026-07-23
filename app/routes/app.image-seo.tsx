import crypto from "node:crypto";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useRevalidator } from "@remix-run/react";
import type { Prisma } from "@prisma/client";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  EmptyState,
  IndexTable,
  InlineGrid,
  InlineStack,
  Modal,
  Page,
  Select,
  Text,
  TextField,
  Thumbnail,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";

import { generateAiImageAltSuggestions, type AiImageAltSuggestion } from "../ai-image-seo.server";
import { isNineRouterConfigured } from "../ai-seo.server";
import prisma from "../db.server";
import {
  applyInlineAltChanges,
  scanImagePortfolio,
  validateProposedAlt,
  type ImageSeoArticle,
  type ImageSeoCandidate,
  type ImageSeoIssue,
} from "../image-seo";
import { getPublicNineRouterErrorMessage } from "../nine-router.server";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import {
  SEO_WORKSPACE_TABS,
  WorkspaceTabs,
} from "../components/WorkspaceTabs";

const EMPTY_IMAGE = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";
const PAGE_SIZE = 20;
const MAX_ACTION_IMAGES = 100;
const ISSUE_LABELS: Record<ImageSeoIssue, string> = {
  missing_alt: "Missing alt",
  stuffed_alt: "Keyword stuffing",
  decorative_alt: "Decorative alt",
};

type ImageBatchArticleSnapshot = {
  articleId: string;
  articleTitle: string;
  beforeBody: string;
  afterBody: string;
  featuredImageUrl: string;
  beforeFeaturedAlt: string;
  afterFeaturedAlt: string;
  items: Array<{
    id: string;
    kind: "featured" | "inline";
    index: number;
    src: string;
    beforeAlt: string;
    afterAlt: string;
    decorative: boolean;
  }>;
};

type ApplyItem = {
  id: string;
  articleId: string;
  kind: "featured" | "inline";
  index: number;
  src: string;
  currentAlt: string;
  proposedAlt: string;
  decorative: boolean;
  bodyHash: string;
};

type ActionData = {
  success?: boolean;
  error?: string;
  warning?: string;
  suggestions?: AiImageAltSuggestion[];
  candidates?: ImageSeoCandidate[];
  applied?: number;
  articles?: number;
  batchId?: string;
  undone?: boolean;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const { limits, planKey } = await getActivePlanAndLimits(billing, session.shop);
  if (!limits.canBulkReview) {
    return json({
      canUse: false,
      planKey,
      aiEnabled: false,
      candidates: [] as ImageSeoCandidate[],
      articlesScanned: 0,
      imagesScanned: 0,
      truncated: false,
      history: [] as Array<{ id: string; batchId: string; imageCount: number; articleCount: number; status: string; appliedAt: string; undoneAt: string | null }>,
    });
  }

  const [{ articles, truncated }, history] = await Promise.all([
    fetchImageArticles(admin),
    prisma.imageSeoChange.findMany({
      where: { shop: session.shop },
      orderBy: { appliedAt: "desc" },
      take: 10,
      select: { id: true, batchId: true, imageCount: true, articleCount: true, status: true, appliedAt: true, undoneAt: true },
    }),
  ]);
  const candidates = scanImagePortfolio(articles);
  return json({
    canUse: true,
    planKey,
    aiEnabled: isNineRouterConfigured(),
    candidates,
    articlesScanned: articles.length,
    imagesScanned: articles.reduce((total, article) => total + (article.featuredImageUrl ? 1 : 0) + (article.body.match(/<img\b/gi)?.length || 0), 0),
    truncated,
    history: history.map((row) => ({ ...row, appliedAt: row.appliedAt.toISOString(), undoneAt: row.undoneAt?.toISOString() || null })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const { limits } = await getActivePlanAndLimits(billing, session.shop);
  if (!limits.canBulkReview) return json({ error: "AI Image SEO is available on the Growth plan." }, { status: 403 });
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "generate") {
    if (!isNineRouterConfigured()) return json({ error: "9Router is not configured on the server." }, { status: 503 });
    let selection: Array<{ id: string; articleId: string }>;
    try {
      selection = parseSelection(String(form.get("selection") || ""));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "The image selection is invalid." }, { status: 400 });
    }
    try {
      const articles = await fetchImageArticlesByIds(admin, [...new Set(selection.map((item) => item.articleId))]);
      const fresh = scanImagePortfolio(articles);
      const allowed = new Map(fresh.map((candidate) => [candidate.id, candidate]));
      const candidates = selection.flatMap((item) => {
        const candidate = allowed.get(item.id);
        return candidate?.articleId === item.articleId ? [candidate] : [];
      });
      if (!candidates.length) return json({ error: "The selected images no longer have a supported alt-text issue." }, { status: 409 });

      const suggestions: AiImageAltSuggestion[] = [];
      const failures: string[] = [];
      for (let index = 0; index < candidates.length; index += 15) {
        const batch = candidates.slice(index, index + 15);
        try {
          suggestions.push(...await generateAiImageAltSuggestions({ candidates: batch }));
        } catch (error) {
          failures.push(getPublicNineRouterErrorMessage(error, "AI could not generate suggestions for one image batch."));
        }
      }
      if (!suggestions.length) return json({ error: failures[0] || "AI returned no usable image alt suggestions." });
      return json({
        success: true,
        suggestions,
        candidates,
        warning: failures.length ? `${failures.length} AI batch(es) failed; successful suggestions are still available for review.` : "",
      });
    } catch (error) {
      console.error("AI image SEO generation failed", error instanceof Error ? error.message : String(error));
      return json({ error: getPublicNineRouterErrorMessage(error, "AI Image SEO could not generate suggestions. Please try again.") });
    }
  }

  if (intent === "apply") {
    let items: ApplyItem[];
    try {
      items = parseApplyItems(String(form.get("payload") || ""));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "The reviewed image changes are invalid." }, { status: 400 });
    }
    try {
      const articles = await fetchImageArticlesByIds(admin, [...new Set(items.map((item) => item.articleId))]);
      const articleMap = new Map(articles.map((article) => [article.id, article]));
      const candidateMap = new Map(scanImagePortfolio(articles).map((candidate) => [candidate.id, candidate]));
      const grouped = new Map<string, Array<{ item: ApplyItem; candidate: ImageSeoCandidate; afterAlt: string }>>();

      for (const item of items) {
        const candidate = candidateMap.get(item.id);
        if (!candidate || candidate.articleId !== item.articleId || candidate.kind !== item.kind || candidate.index !== item.index
          || candidate.src !== item.src || candidate.currentAlt !== item.currentAlt || candidate.decorative !== item.decorative
          || candidate.bodyHash !== item.bodyHash) {
          throw new Error("One or more images changed after AI generated the review. Refresh the report and try again.");
        }
        const afterAlt = validateProposedAlt(item.proposedAlt, candidate.decorative);
        if (afterAlt === candidate.currentAlt) continue;
        grouped.set(item.articleId, [...(grouped.get(item.articleId) || []), { item, candidate, afterAlt }]);
      }
      if (!grouped.size) return json({ error: "No reviewed alt-text changes remain to apply." }, { status: 400 });

      const snapshots: ImageBatchArticleSnapshot[] = [];
      for (const [articleId, group] of grouped) {
        const article = articleMap.get(articleId);
        if (!article) throw new Error("A selected Shopify article no longer exists.");
        const inline = group.filter((entry) => entry.candidate.kind === "inline");
        const featured = group.find((entry) => entry.candidate.kind === "featured");
        const afterBody = inline.length ? applyInlineAltChanges(article.body, inline[0].candidate.bodyHash, inline.map((entry) => ({
          id: entry.candidate.id,
          index: entry.candidate.index,
          src: entry.candidate.src,
          beforeAlt: entry.candidate.currentAlt,
          afterAlt: entry.afterAlt,
          decorative: entry.candidate.decorative,
        }))) : article.body;
        snapshots.push({
          articleId,
          articleTitle: article.title,
          beforeBody: article.body,
          afterBody,
          featuredImageUrl: article.featuredImageUrl,
          beforeFeaturedAlt: article.featuredImageAlt,
          afterFeaturedAlt: featured?.afterAlt ?? article.featuredImageAlt,
          items: group.map((entry) => ({
            id: entry.candidate.id,
            kind: entry.candidate.kind,
            index: entry.candidate.index,
            src: entry.candidate.src,
            beforeAlt: entry.candidate.currentAlt,
            afterAlt: entry.afterAlt,
            decorative: entry.candidate.decorative,
          })),
        });
      }

      const applied: ImageBatchArticleSnapshot[] = [];
      try {
        for (const snapshot of snapshots) {
          const result = await writeArticleImageState(admin, snapshot, "after");
          snapshot.afterBody = result.body;
          snapshot.afterFeaturedAlt = result.featuredImageAlt;
          applied.push(snapshot);
        }
      } catch (error) {
        await compensateImageWrites(admin, applied, "before");
        throw error;
      }

      const batchId = crypto.randomUUID();
      try {
        await prisma.$transaction([
          prisma.imageSeoChange.create({
            data: {
              batchId,
              shop: session.shop,
              changes: snapshots as unknown as Prisma.InputJsonValue,
              articleCount: snapshots.length,
              imageCount: snapshots.reduce((total, snapshot) => total + snapshot.items.length, 0),
            },
          }),
          ...snapshots.filter((snapshot) => snapshot.beforeFeaturedAlt !== snapshot.afterFeaturedAlt).map((snapshot) =>
            prisma.articleSEO.updateMany({
              where: { shop: session.shop, articleId: snapshot.articleId },
              data: { imageAlt: snapshot.afterFeaturedAlt, contentHash: null },
            }),
          ),
        ]);
      } catch (error) {
        await compensateImageWrites(admin, applied, "before");
        throw error;
      }
      return json({
        success: true,
        applied: snapshots.reduce((total, snapshot) => total + snapshot.items.length, 0),
        articles: snapshots.length,
        batchId,
      });
    } catch (error) {
      console.error("AI image SEO apply failed", error instanceof Error ? error.message : String(error));
      return json({ error: error instanceof Error ? error.message : "Image alt changes could not be applied." }, { status: 409 });
    }
  }

  if (intent === "undo") {
    const change = await prisma.imageSeoChange.findFirst({
      where: { id: String(form.get("changeId") || ""), shop: session.shop, status: "applied" },
    });
    if (!change) return json({ error: "This image SEO batch is unavailable or already undone." }, { status: 404 });
    let snapshots: ImageBatchArticleSnapshot[];
    try {
      snapshots = parseStoredSnapshots(change.changes);
      const articles = await fetchImageArticlesByIds(admin, snapshots.map((snapshot) => snapshot.articleId));
      const articleMap = new Map(articles.map((article) => [article.id, article]));
      for (const snapshot of snapshots) {
        const current = articleMap.get(snapshot.articleId);
        if (!current) throw new Error(`${snapshot.articleTitle} no longer exists in Shopify.`);
        if (snapshot.beforeBody !== snapshot.afterBody && current.body !== snapshot.afterBody) {
          throw new Error(`${snapshot.articleTitle} changed after this batch was applied. Undo stopped to protect the newer content.`);
        }
        if (snapshot.beforeFeaturedAlt !== snapshot.afterFeaturedAlt
          && (current.featuredImageUrl !== snapshot.featuredImageUrl || current.featuredImageAlt !== snapshot.afterFeaturedAlt)) {
          throw new Error(`${snapshot.articleTitle}'s featured image changed after this batch was applied. Undo stopped to protect the newer image.`);
        }
      }

      const reverted: ImageBatchArticleSnapshot[] = [];
      try {
        for (const snapshot of snapshots) {
          await writeArticleImageState(admin, snapshot, "before");
          reverted.push(snapshot);
        }
      } catch (error) {
        await compensateImageWrites(admin, reverted, "after");
        throw error;
      }
      try {
        await prisma.$transaction([
          prisma.imageSeoChange.update({ where: { id: change.id }, data: { status: "undone", undoneAt: new Date() } }),
          ...snapshots.filter((snapshot) => snapshot.beforeFeaturedAlt !== snapshot.afterFeaturedAlt).map((snapshot) =>
            prisma.articleSEO.updateMany({
              where: { shop: session.shop, articleId: snapshot.articleId },
              data: { imageAlt: snapshot.beforeFeaturedAlt, contentHash: null },
            }),
          ),
        ]);
      } catch (error) {
        await compensateImageWrites(admin, reverted, "after");
        throw error;
      }
      return json({ success: true, undone: true });
    } catch (error) {
      console.error("AI image SEO undo failed", error instanceof Error ? error.message : String(error));
      return json({ error: error instanceof Error ? error.message : "The image SEO batch could not be undone." }, { status: 409 });
    }
  }

  return json({ error: "Unsupported action." }, { status: 400 });
};

export default function ImageSeoPage() {
  const initial = useLoaderData<typeof loader>();
  const aiFetcher = useFetcher<ActionData>();
  const changeFetcher = useFetcher<ActionData>();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const handledAi = useRef<unknown>(null);
  const handledChange = useRef<unknown>(null);
  const [candidates, setCandidates] = useState<ImageSeoCandidate[]>(initial.candidates);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Record<string, AiImageAltSuggestion>>({});
  const [proposedAlts, setProposedAlts] = useState<Record<string, string>>({});
  const [issueFilter, setIssueFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    setCandidates(initial.candidates);
  }, [initial.candidates]);

  useEffect(() => {
    const data = aiFetcher.data;
    if (!data || handledAi.current === data) return;
    handledAi.current = data;
    if (data.error) shopify.toast.show(data.error, { isError: true });
    if (data.warning) shopify.toast.show(data.warning);
    if (data.candidates) {
      const fresh = new Map(data.candidates.map((candidate) => [candidate.id, candidate]));
      setCandidates((rows) => rows.map((row) => fresh.get(row.id) || row));
    }
    if (data.suggestions) {
      setSuggestions((current) => ({ ...current, ...Object.fromEntries(data.suggestions!.map((suggestion) => [suggestion.id, suggestion])) }));
      setProposedAlts((current) => ({ ...current, ...Object.fromEntries(data.suggestions!.map((suggestion) => [suggestion.id, suggestion.altText])) }));
      shopify.toast.show(`${data.suggestions.length} image alt suggestion(s) ready for review`);
    }
  }, [aiFetcher.data, shopify]);

  useEffect(() => {
    const data = changeFetcher.data;
    if (!data || handledChange.current === data) return;
    handledChange.current = data;
    if (data.error) {
      shopify.toast.show(data.error, { isError: true });
      return;
    }
    if (data.success) {
      setPreviewOpen(false);
      setSelectedIds([]);
      setSuggestions({});
      setProposedAlts({});
      revalidator.revalidate();
      shopify.toast.show(data.undone ? "Image SEO batch undone" : `${data.applied || 0} image alt change(s) applied`);
    }
  }, [changeFetcher.data, revalidator, shopify]);

  const filtered = useMemo(() => candidates.filter((candidate) => {
    const search = query.trim().toLowerCase();
    return (issueFilter === "all" || candidate.issues.includes(issueFilter as ImageSeoIssue))
      && (kindFilter === "all" || candidate.kind === kindFilter)
      && (!search || `${candidate.articleTitle} ${candidate.src} ${candidate.currentAlt}`.toLowerCase().includes(search));
  }), [candidates, issueFilter, kindFilter, query]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selected = new Set(selectedIds);
  const reviewed = candidates.filter((candidate) => selected.has(candidate.id)
    && suggestions[candidate.id]
    && proposedAlts[candidate.id] !== undefined
    && proposedAlts[candidate.id] !== candidate.currentAlt);

  useEffect(() => { setPage(1); }, [issueFilter, kindFilter, query]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  if (!initial.canUse) {
    return <Page><TitleBar title="AI Image SEO" /><BlockStack gap="500"><WorkspaceTabs tabs={SEO_WORKSPACE_TABS} activeId="images" /><Card><EmptyState heading="AI Image SEO is a Growth feature" action={{ content: "Upgrade to Growth", url: `/app/pricing?reason=image_seo&plan=${initial.planKey}` }} image={EMPTY_IMAGE}><p>Review featured and inline image alt text across multiple Shopify articles, then apply selected changes with batch Undo.</p></EmptyState></Card></BlockStack></Page>;
  }

  const toggle = (id: string, checked: boolean) => setSelectedIds((current) => checked ? [...new Set([...current, id])] : current.filter((value) => value !== id));
  const selectPage = () => setSelectedIds((current) => [...new Set([...current, ...visible.map((candidate) => candidate.id)])]);
  const generate = () => {
    const selection = candidates.filter((candidate) => selected.has(candidate.id)).slice(0, 50).map(({ id, articleId }) => ({ id, articleId }));
    aiFetcher.submit({ intent: "generate", selection: JSON.stringify(selection) }, { method: "post" });
  };
  const apply = () => {
    const payload: ApplyItem[] = reviewed.map((candidate) => ({
      id: candidate.id,
      articleId: candidate.articleId,
      kind: candidate.kind,
      index: candidate.index,
      src: candidate.src,
      currentAlt: candidate.currentAlt,
      proposedAlt: proposedAlts[candidate.id],
      decorative: candidate.decorative,
      bodyHash: candidate.bodyHash,
    }));
    changeFetcher.submit({ intent: "apply", payload: JSON.stringify(payload) }, { method: "post" });
  };
  const issueCounts = {
    missing_alt: candidates.filter((candidate) => candidate.issues.includes("missing_alt")).length,
    stuffed_alt: candidates.filter((candidate) => candidate.issues.includes("stuffed_alt")).length,
    decorative_alt: candidates.filter((candidate) => candidate.issues.includes("decorative_alt")).length,
  };

  return <Page fullWidth>
    <TitleBar title="AI Image SEO" />
    <BlockStack gap="500">
      <WorkspaceTabs tabs={SEO_WORKSPACE_TABS} activeId="images" />
      <InlineStack align="space-between" blockAlign="end" gap="400">
        <BlockStack gap="100"><Text as="h1" variant="headingXl" fontWeight="bold">Bulk image alt review</Text><Text as="p" tone="subdued">Generate context-aware alt suggestions for featured and inline images. Image files, URLs, dimensions and all non-alt HTML remain unchanged.</Text></BlockStack>
        <InlineStack gap="200"><Button disabled={!selectedIds.length} onClick={() => setSelectedIds([])}>Clear selection</Button><Button variant="primary" loading={aiFetcher.state !== "idle"} disabled={!initial.aiEnabled || !selectedIds.length || aiFetcher.state !== "idle"} onClick={generate}>{`Generate AI for selected (${Math.min(selectedIds.length, 50)})`}</Button></InlineStack>
      </InlineStack>

      {!initial.aiEnabled && <Banner tone="critical" title="9Router is not configured"><p>Add the 9Router environment variables before generating image alt suggestions.</p></Banner>}
      {initial.truncated && <Banner tone="warning"><p>This review is limited to the 500 most recently returned Shopify articles. Narrow the store scope before reviewing additional articles.</p></Banner>}
      {aiFetcher.data?.error && <Banner tone="critical"><p>{aiFetcher.data.error}</p></Banner>}
      {changeFetcher.data?.error && <Banner tone="critical"><p>{changeFetcher.data.error}</p></Banner>}

      <InlineGrid columns={{ xs: 2, md: 5 }} gap="300">
        <Summary label="Articles scanned" value={initial.articlesScanned} tone="info" />
        <Summary label="Images scanned" value={initial.imagesScanned} tone="info" />
        <Summary label="Missing alt" value={issueCounts.missing_alt} tone="warning" />
        <Summary label="Stuffed alt" value={issueCounts.stuffed_alt} tone="critical" />
        <Summary label="Decorative alt" value={issueCounts.decorative_alt} tone="warning" />
      </InlineGrid>

      {!candidates.length ? <Card><EmptyState heading="No supported alt-text issues found" image={EMPTY_IMAGE}><p>Featured and inline images currently pass the missing, keyword-stuffing and decorative-alt checks.</p></EmptyState></Card> : <Card padding="0">
        <Box padding="400">
          <InlineGrid columns={{ xs: 1, md: 3 }} gap="300">
            <TextField label="Search images" labelHidden value={query} onChange={setQuery} autoComplete="off" placeholder="Search article, URL or alt text" />
            <Select label="Issue" labelHidden value={issueFilter} onChange={setIssueFilter} options={[
              { label: `All issues (${candidates.length})`, value: "all" },
              { label: `Missing alt (${issueCounts.missing_alt})`, value: "missing_alt" },
              { label: `Keyword stuffing (${issueCounts.stuffed_alt})`, value: "stuffed_alt" },
              { label: `Decorative alt (${issueCounts.decorative_alt})`, value: "decorative_alt" },
            ]} />
            <Select label="Image type" labelHidden value={kindFilter} onChange={setKindFilter} options={[
              { label: "Featured and inline", value: "all" },
              { label: "Featured images", value: "featured" },
              { label: "Inline images", value: "inline" },
            ]} />
          </InlineGrid>
          <Box paddingBlockStart="300"><InlineStack align="space-between"><Text as="span" variant="bodySm" tone="subdued">{filtered.length} issue image(s) · {selectedIds.length} selected · AI actions process at most 50 at a time</Text><Button size="micro" onClick={selectPage}>Select this page</Button></InlineStack></Box>
        </Box>
        <Divider />
        <div style={{ overflowX: "auto" }}>
          <IndexTable resourceName={{ singular: "image", plural: "images" }} itemCount={visible.length} selectable={false} headings={[
            { title: "" }, { title: "Image" }, { title: "Article and issue" }, { title: "Current alt" }, { title: "AI suggestion" },
          ]}>
            {visible.map((candidate, position) => {
              const suggestion = suggestions[candidate.id];
              return <IndexTable.Row id={candidate.id} key={candidate.id} position={position}>
                <IndexTable.Cell><Checkbox label={`Select ${candidate.articleTitle}`} labelHidden checked={selected.has(candidate.id)} onChange={(checked) => toggle(candidate.id, checked)} /></IndexTable.Cell>
                <IndexTable.Cell><Thumbnail source={thumbnailSource(candidate.src)} alt={candidate.currentAlt || candidate.articleTitle} size="small" /></IndexTable.Cell>
                <IndexTable.Cell><div style={{ minWidth: 240, maxWidth: 320 }}><BlockStack gap="100"><Text as="span" fontWeight="semibold">{candidate.articleTitle}</Text><InlineStack gap="100"><Badge tone={candidate.kind === "featured" ? "info" : undefined}>{candidate.kind === "featured" ? "Featured" : `Inline ${candidate.index + 1}`}</Badge>{candidate.issues.map((issue) => <Badge key={issue} tone={issue === "stuffed_alt" ? "critical" : "warning"}>{ISSUE_LABELS[issue]}</Badge>)}</InlineStack><Text as="span" variant="bodySm" tone="subdued">{compactSource(candidate.src)}</Text></BlockStack></div></IndexTable.Cell>
                <IndexTable.Cell><div style={{ minWidth: 230, maxWidth: 300 }}><Text as="span" variant="bodySm">{candidate.currentAlt || <em>(empty)</em>}</Text></div></IndexTable.Cell>
                <IndexTable.Cell><div style={{ minWidth: 330 }}>{suggestion ? <BlockStack gap="100"><TextField label="Proposed alt text" labelHidden value={proposedAlts[candidate.id] ?? suggestion.altText} onChange={(value) => setProposedAlts((current) => ({ ...current, [candidate.id]: value }))} maxLength={160} showCharacterCount autoComplete="off" placeholder={candidate.decorative ? "Leave empty for decorative image" : "Describe the image purpose"} /><Text as="span" variant="bodySm" tone="subdued">{suggestion.reason}</Text></BlockStack> : <Text as="span" tone="subdued">Select this image and generate an AI suggestion.</Text>}</div></IndexTable.Cell>
              </IndexTable.Row>;
            })}
          </IndexTable>
        </div>
        <Divider />
        <Box padding="300"><InlineStack align="space-between" blockAlign="center"><Text as="span" variant="bodySm" tone="subdued">Page {page} of {totalPages}</Text><InlineStack gap="200"><Button size="micro" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button><Button size="micro" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</Button></InlineStack></InlineStack></Box>
      </Card>}

      {reviewed.length > 0 && <Card><InlineStack align="space-between" blockAlign="center"><BlockStack gap="050"><Text as="h2" variant="headingMd">{reviewed.length} reviewed change(s) ready</Text><Text as="p" variant="bodySm" tone="subdued">Preview the exact before/after alt values. Shopify is updated only after confirmation.</Text></BlockStack><Button variant="primary" onClick={() => setPreviewOpen(true)}>Preview selected changes</Button></InlineStack></Card>}

      {initial.history.length > 0 && <Card><BlockStack gap="300"><Text as="h2" variant="headingMd">Batch history</Text>{initial.history.map((row) => <InlineStack key={row.id} align="space-between" blockAlign="center"><BlockStack gap="050"><Text as="span" fontWeight="semibold">{row.imageCount} image(s) across {row.articleCount} article(s)</Text><Text as="span" variant="bodySm" tone="subdued">{row.status === "undone" ? "Undone" : `Applied ${new Date(row.appliedAt).toLocaleString()}`}</Text></BlockStack><Button disabled={row.status !== "applied" || changeFetcher.state !== "idle"} loading={changeFetcher.state !== "idle" && changeFetcher.formData?.get("changeId") === row.id} onClick={() => changeFetcher.submit({ intent: "undo", changeId: row.id }, { method: "post" })}>Undo batch</Button></InlineStack>)}</BlockStack></Card>}
    </BlockStack>

    <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title="Confirm image alt changes" primaryAction={{ content: `Apply ${reviewed.length} changes`, onAction: apply, loading: changeFetcher.state !== "idle", disabled: !reviewed.length }} secondaryActions={[{ content: "Continue reviewing", onAction: () => setPreviewOpen(false) }]}>
      <Modal.Section><BlockStack gap="400">{reviewed.map((candidate) => <BlockStack key={candidate.id} gap="150"><InlineStack gap="300" wrap={false}><Thumbnail source={thumbnailSource(candidate.src)} alt={candidate.currentAlt || candidate.articleTitle} size="small" /><BlockStack gap="050"><Text as="h3" fontWeight="semibold">{candidate.articleTitle}</Text><Text as="p" variant="bodySm" tone="subdued">{candidate.kind === "featured" ? "Featured image" : `Inline image ${candidate.index + 1}`}</Text></BlockStack></InlineStack><Box background="bg-surface-secondary" padding="300" borderRadius="200"><BlockStack gap="100"><Text as="p" variant="bodySm"><strong>Before:</strong> {candidate.currentAlt || "(empty)"}</Text><Text as="p" variant="bodySm"><strong>After:</strong> {proposedAlts[candidate.id] || "(empty decorative alt)"}</Text></BlockStack></Box></BlockStack>)}</BlockStack></Modal.Section>
    </Modal>
  </Page>;
}

function Summary({ label, value, tone }: { label: string; value: number; tone: "info" | "warning" | "critical" }) {
  return <Card><BlockStack gap="100"><Text as="p" variant="bodySm" tone="subdued">{label}</Text><InlineStack align="space-between" blockAlign="center"><Text as="p" variant="heading2xl" fontWeight="bold">{value}</Text><Badge tone={tone}>{value ? "Measured" : "Clear"}</Badge></InlineStack></BlockStack></Card>;
}

async function fetchImageArticles(admin: any): Promise<{ articles: ImageSeoArticle[]; truncated: boolean }> {
  const articles: ImageSeoArticle[] = [];
  let cursor: string | null = null;
  let truncated = false;
  do {
    const response = await admin.graphql(`#graphql
      query ImageSeoArticles($after: String) {
        articles(first: 100, after: $after, sortKey: UPDATED_AT, reverse: true) {
          nodes { id title summary body image { url altText } }
          pageInfo { hasNextPage endCursor }
        }
      }`, { variables: { after: cursor } });
    const result: any = await response.json();
    if (result.errors?.length) throw new Error(result.errors.map((error: any) => error.message).join("; "));
    for (const node of result.data?.articles?.nodes || []) articles.push(toImageSeoArticle(node));
    const pageInfo = result.data?.articles?.pageInfo;
    cursor = pageInfo?.hasNextPage ? pageInfo.endCursor : null;
    if (articles.length >= 500 && cursor) {
      truncated = true;
      cursor = null;
    }
  } while (cursor);
  return { articles, truncated };
}

async function fetchImageArticlesByIds(admin: any, ids: string[]): Promise<ImageSeoArticle[]> {
  if (!ids.length || ids.length > 100 || ids.some((id) => !/^gid:\/\/shopify\/Article\/\d+$/.test(id))) throw new Error("The selected article IDs are invalid.");
  const articles: ImageSeoArticle[] = [];
  for (let index = 0; index < ids.length; index += 50) {
    const response = await admin.graphql(`#graphql
      query ImageSeoArticlesById($ids: [ID!]!) {
        nodes(ids: $ids) { ... on Article { id title summary body image { url altText } } }
      }`, { variables: { ids: ids.slice(index, index + 50) } });
    const result: any = await response.json();
    if (result.errors?.length) throw new Error(result.errors.map((error: any) => error.message).join("; "));
    for (const node of result.data?.nodes || []) if (node?.id) articles.push(toImageSeoArticle(node));
  }
  return articles;
}

function toImageSeoArticle(node: any): ImageSeoArticle {
  return {
    id: String(node.id || ""),
    title: clean(node.title) || "Untitled article",
    summary: clean(node.summary),
    body: typeof node.body === "string" ? node.body : "",
    featuredImageUrl: String(node.image?.url || ""),
    featuredImageAlt: String(node.image?.altText || ""),
  };
}

async function writeArticleImageState(admin: any, snapshot: ImageBatchArticleSnapshot, direction: "before" | "after") {
  const body = direction === "before" ? snapshot.beforeBody : snapshot.afterBody;
  const featuredImageAlt = direction === "before" ? snapshot.beforeFeaturedAlt : snapshot.afterFeaturedAlt;
  const bodyChanged = snapshot.beforeBody !== snapshot.afterBody;
  const featuredChanged = snapshot.beforeFeaturedAlt !== snapshot.afterFeaturedAlt;
  const article: Record<string, unknown> = {};
  if (bodyChanged) article.body = body;
  if (featuredChanged) article.image = { url: snapshot.featuredImageUrl, altText: featuredImageAlt };
  if (!Object.keys(article).length) return { body, featuredImageAlt };
  const response = await admin.graphql(`#graphql
    mutation ApplyImageSeo($id: ID!, $article: ArticleUpdateInput!) {
      articleUpdate(id: $id, article: $article) {
        article { id body image { url altText } }
        userErrors { field message }
      }
    }`, { variables: { id: snapshot.articleId, article } });
  const result: any = await response.json();
  const errors = [...(result.errors || []), ...(result.data?.articleUpdate?.userErrors || [])];
  if (errors.length) throw new Error(`${snapshot.articleTitle}: ${errors.map((error: any) => error.message).join("; ")}`);
  const updated = result.data?.articleUpdate?.article;
  if (!updated) throw new Error(`${snapshot.articleTitle}: Shopify returned no updated article.`);
  return {
    body: bodyChanged ? String(updated.body ?? body) : body,
    featuredImageAlt: featuredChanged ? String(updated.image?.altText ?? featuredImageAlt) : featuredImageAlt,
  };
}

async function compensateImageWrites(admin: any, snapshots: ImageBatchArticleSnapshot[], direction: "before" | "after") {
  for (const snapshot of [...snapshots].reverse()) {
    try {
      await writeArticleImageState(admin, snapshot, direction);
    } catch (error) {
      console.error("Image SEO compensation failed", snapshot.articleId, error instanceof Error ? error.message : String(error));
    }
  }
}

function parseSelection(value: string) {
  const parsed = parseJsonArray(value);
  if (!parsed.length || parsed.length > 50) throw new Error("Select between 1 and 50 images for each AI request.");
  const rows = parsed.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("The image selection is invalid.");
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.articleId !== "string" || !/^gid:\/\/shopify\/Article\/\d+$/.test(row.articleId)) throw new Error("The image selection is invalid.");
    return { id: row.id.slice(0, 600), articleId: row.articleId };
  });
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error("Duplicate images are not allowed.");
  return rows;
}

function parseApplyItems(value: string): ApplyItem[] {
  const parsed = parseJsonArray(value);
  if (!parsed.length || parsed.length > MAX_ACTION_IMAGES) throw new Error(`Choose between 1 and ${MAX_ACTION_IMAGES} reviewed image changes.`);
  const items = parsed.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("The reviewed image payload is invalid.");
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.articleId !== "string" || !/^gid:\/\/shopify\/Article\/\d+$/.test(item.articleId)
      || !["featured", "inline"].includes(String(item.kind)) || !Number.isInteger(item.index) || Number(item.index) < 0
      || typeof item.src !== "string" || item.src.length > 4_000 || typeof item.currentAlt !== "string" || item.currentAlt.length > 300
      || typeof item.proposedAlt !== "string" || item.proposedAlt.length > 300 || typeof item.decorative !== "boolean"
      || typeof item.bodyHash !== "string" || !/^[a-f0-9]{64}$/.test(item.bodyHash)) {
      throw new Error("The reviewed image payload is invalid.");
    }
    return {
      id: item.id.slice(0, 600),
      articleId: item.articleId,
      kind: item.kind as "featured" | "inline",
      index: Number(item.index),
      src: item.src,
      currentAlt: item.currentAlt,
      proposedAlt: item.proposedAlt,
      decorative: item.decorative,
      bodyHash: item.bodyHash,
    };
  });
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("Duplicate image changes are not allowed.");
  return items;
}

function parseStoredSnapshots(value: unknown): ImageBatchArticleSnapshot[] {
  if (!Array.isArray(value) || !value.length) throw new Error("The saved image SEO history is invalid.");
  return value as unknown as ImageBatchArticleSnapshot[];
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function thumbnailSource(src: string) {
  return /^https?:\/\//i.test(src) ? src : ImageIcon;
}

function compactSource(src: string) {
  if (!src) return "No image source";
  try {
    const url = new URL(src);
    const value = `${url.hostname}${url.pathname}`;
    return value.length > 65 ? `${value.slice(0, 62)}...` : value;
  } catch {
    return src.length > 65 ? `${src.slice(0, 62)}...` : src;
  }
}

function clean(value: unknown) {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "";
}
