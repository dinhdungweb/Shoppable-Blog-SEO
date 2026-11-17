import crypto from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { Badge, Banner, BlockStack, Button, Card, IndexTable, InlineStack, Layout, Modal, Page, Text, TextField } from "@shopify/polaris";
import { useEffect, useMemo, useState } from "react";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import { OPTIMIZE_WORKSPACE_TABS, WorkspaceTabs } from "../components/WorkspaceTabs";
import { isNineRouterConfigured } from "../ai-seo.server";
import { generateAiCatalogDraft } from "../ai-catalog.server";
import { isAiQuotaExceededError, runWithAiUsage } from "../ai-usage.server";
import { enterAiWritingRules, getPublicNineRouterErrorMessage } from "../nine-router.server";
import { loadShopAiWritingRules } from "../ai-writing-rules.server";
import { SEO_DESCRIPTION_FALLBACK_LENGTH, stripTags } from "../catalog-save";
import { CATALOG_BULK_ISSUES, bulkProblems, clean, initialBulkValues, parseBulkPayload, parseCatalogIds, planBulkChange } from "../catalog-bulk";
import { fetchBulkCatalogNodes, refreshCatalogAudit, setCatalogImageAlt, setCatalogSeo } from "../catalog-bulk.server";

const AI_BATCH = 3;

async function requireAccess(request: Request) {
  const context = await authenticate.admin(request);
  const plan = await getActivePlanAndLimits(context.billing, context.session.shop);
  return { ...context, ...plan, allowed: plan.limits.canBulkReview && plan.limits.canCatalogSeo };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, planKey, allowed } = await requireAccess(request);
  if (!allowed) return redirect(`/app/pricing?reason=bulk_edit&plan=${planKey}`);
  const ids = parseCatalogIds(new URL(request.url).searchParams.get("ids") || "");
  if (!ids.length) return redirect("/app/optimize/catalog");
  const [nodes, saved, history] = await Promise.all([
    fetchBulkCatalogNodes(admin, ids),
    prisma.resourceSEO.findMany({ where: { shop: session.shop, resourceId: { in: ids } }, select: { resourceId: true, issues: true, focusKeyword: true } }),
    prisma.catalogBulkChange.findMany({ where: { shop: session.shop }, orderBy: { appliedAt: "desc" }, take: 10 }),
  ]);
  const savedById = new Map(saved.map((row) => [row.resourceId, row]));
  const resources = nodes.map((node) => {
    const issueTypes = parseIssueTypes(savedById.get(node.id)?.issues);
    return {
      id: node.id,
      type: node.type,
      title: node.title,
      imageUrl: node.imageUrl,
      // The automatic description Shopify shows; enough to compare edits without sending full descriptions.
      fallbackDescription: stripTags(node.descriptionHtml).slice(0, SEO_DESCRIPTION_FALLBACK_LENGTH).trim(),
      seoTitle: node.seoTitle,
      seoDescription: node.seoDescription,
      imageAlt: node.imageAlt,
      problems: bulkProblems(issueTypes),
      initial: initialBulkValues({ ...node, issueTypes }),
    };
  });
  return json({
    resources,
    missing: ids.length - resources.length,
    aiEnabled: isNineRouterConfigured(),
    history: history.map((row) => ({ id: row.id, title: row.title, status: row.status, appliedAt: row.appliedAt.toISOString() })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, limits, allowed } = await requireAccess(request);
  if (!allowed) return json({ error: "Bulk catalog editing is a Growth plan feature." }, { status: 403 });
  const form = await request.formData();
  const intent = String(form.get("intent") || "apply");

  if (intent === "generate-ai") {
    if (!isNineRouterConfigured()) return json({ error: "AI is not configured on the server." }, { status: 503 });
    // Apply Settings → SEO & AI rules to every AI generation in this request.
    enterAiWritingRules(await loadShopAiWritingRules(session.shop));
    const ids = parseCatalogIds(String(form.get("ids") || ""));
    if (!ids.length) return json({ error: "Nothing was selected." }, { status: 400 });
    const nodes = await fetchBulkCatalogNodes(admin, ids);
    const saved = await prisma.resourceSEO.findMany({ where: { shop: session.shop, resourceId: { in: ids } }, select: { resourceId: true, focusKeyword: true } });
    const keywords = new Map(saved.map((row) => [row.resourceId, row.focusKeyword]));
    const suggestions: Array<{ id: string; seoTitle: string; seoDescription: string; imageAlt: string }> = [];
    const failures: string[] = [];
    let quotaError = "";
    for (let index = 0; index < nodes.length && !quotaError; index += AI_BATCH) {
      const batch = nodes.slice(index, index + AI_BATCH);
      const settled = await Promise.allSettled(batch.map((node) => runWithAiUsage(
        { shop: session.shop, limit: limits.aiRequestsPerMonth },
        () => generateAiCatalogDraft({
          type: node.type,
          mode: "listing",
          title: node.title,
          descriptionHtml: node.descriptionHtml,
          seoTitle: node.seoTitle,
          seoDescription: node.seoDescription,
          focusKeyword: keywords.get(node.id) || "",
          instruction: "",
          imageAlt: node.imageAlt,
          hasImage: Boolean(node.imageUrl),
          vendor: node.vendor,
          productType: node.productType,
          tags: node.tags,
        }),
      )));
      for (const [itemIndex, item] of settled.entries()) {
        const node = batch[itemIndex];
        if (item.status === "fulfilled") {
          const draft = item.value.result;
          suggestions.push({
            id: node.id,
            seoTitle: clean(draft.seoTitle).slice(0, 70),
            seoDescription: clean(draft.seoDescription).slice(0, 165),
            imageAlt: node.imageUrl ? clean(draft.imageAlt).slice(0, 255) : "",
          });
        } else if (isAiQuotaExceededError(item.reason)) {
          quotaError = `${item.reason.message} Upgrade for a higher monthly AI allowance.`;
        } else {
          failures.push(`${node.title || "Item"}: ${getPublicNineRouterErrorMessage(item.reason, "AI generation failed.")}`);
        }
      }
    }
    if (!suggestions.length) return json({ error: quotaError || failures[0] || "AI could not generate suggestions." }, { status: quotaError ? 429 : 502 });
    const skipped = nodes.length - suggestions.length;
    return json({ success: true, suggestions, warning: skipped ? `${skipped} item(s) kept their current values${quotaError ? " because the monthly AI limit was reached" : " because AI failed"}.` : "" });
  }

  if (intent === "undo") {
    const change = await prisma.catalogBulkChange.findFirst({ where: { id: String(form.get("changeId") || ""), shop: session.shop, status: "applied" } });
    if (!change) return json({ error: "This change is unavailable or already undone." }, { status: 404 });
    const [node] = await fetchBulkCatalogNodes(admin, [change.resourceId]);
    if (!node) return json({ error: "This product or collection no longer exists." }, { status: 404 });
    const seoChanged = change.beforeSeoTitle !== change.afterSeoTitle || change.beforeSeoDescription !== change.afterSeoDescription;
    if (seoChanged) {
      const error = await setCatalogSeo(admin, node, change.beforeSeoTitle, change.beforeSeoDescription);
      if (error) return json({ error }, { status: 400 });
    }
    if (change.beforeImageAlt !== change.afterImageAlt && node.imageUrl) {
      const error = await setCatalogImageAlt(admin, node, change.beforeImageAlt);
      if (error) return json({ error }, { status: 400 });
    }
    await prisma.catalogBulkChange.update({ where: { id: change.id }, data: { status: "undone", undoneAt: new Date() } });
    const [restored] = await fetchBulkCatalogNodes(admin, [change.resourceId]);
    if (restored) await refreshCatalogAudit(session.shop, restored, seoChanged).catch((error) => console.error("Catalog audit refresh failed", error));
    return json({ success: true, undone: true });
  }

  const items = parseBulkPayload(String(form.get("payload") || ""));
  if (!items) return json({ error: "The changes could not be read. Reload the page and try again." }, { status: 400 });
  const nodes = new Map((await fetchBulkCatalogNodes(admin, items.map((item) => item.id))).map((node) => [node.id, node]));
  const batchId = crypto.randomUUID();
  let applied = 0;
  for (const item of items) {
    const node = nodes.get(item.id);
    if (!node) continue;
    const plan = planBulkChange(node, item);
    if (!plan.changed) continue;
    if (plan.seoChanged) {
      const error = await setCatalogSeo(admin, node, plan.seoTitle, plan.seoDescription);
      if (error) return json({ error: `${node.title}: ${error}`, applied }, { status: 400 });
    }
    if (plan.altChanged) {
      const error = await setCatalogImageAlt(admin, node, plan.imageAlt);
      if (error) return json({ error: `${node.title}: ${error}`, applied }, { status: 400 });
    }
    await prisma.catalogBulkChange.create({
      data: {
        batchId,
        shop: session.shop,
        resourceType: node.type,
        resourceId: node.id,
        title: node.title,
        beforeSeoTitle: node.seoTitle,
        beforeSeoDescription: node.seoDescription,
        afterSeoTitle: plan.seoChanged ? plan.seoTitle : node.seoTitle,
        afterSeoDescription: plan.seoChanged ? plan.seoDescription : node.seoDescription,
        mediaId: node.mediaId,
        imageUrl: node.imageUrl,
        beforeImageAlt: node.imageAlt,
        afterImageAlt: plan.altChanged ? plan.imageAlt : node.imageAlt,
      },
    });
    const updated = {
      ...node,
      seoTitle: plan.seoChanged ? plan.seoTitle : node.seoTitle,
      seoDescription: plan.seoChanged ? plan.seoDescription : node.seoDescription,
      imageAlt: plan.altChanged ? plan.imageAlt : node.imageAlt,
    };
    await refreshCatalogAudit(session.shop, updated, plan.seoChanged).catch((error) => console.error("Catalog audit refresh failed", error));
    applied++;
  }
  return json({ success: true, applied });
};

function parseIssueTypes(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map((issue) => String(issue?.type || "")) : [];
  } catch {
    return [];
  }
}

type Field = "seoTitle" | "seoDescription" | "imageAlt";

export default function CatalogBulkReview() {
  const { resources, missing, aiEnabled, history } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const aiFetcher = useFetcher<typeof action>();
  const [values, setValues] = useState<Record<string, Record<Field, string>>>(() => Object.fromEntries(resources.map((row) => [row.id, row.initial])));
  const [preview, setPreview] = useState(false);

  const plans = useMemo(() => resources.map((row) => ({
    row,
    edit: values[row.id],
    plan: planBulkChange({ ...row, descriptionHtml: row.fallbackDescription }, values[row.id]),
  })), [resources, values]);
  const changed = plans.filter((entry) => entry.plan.changed);

  useEffect(() => {
    const data = fetcher.data;
    if (fetcher.state !== "idle" || !data) return;
    if ("applied" in data && data.success) {
      setPreview(false);
      shopify.toast.show(`${data.applied} item${data.applied === 1 ? "" : "s"} updated`);
    } else if ("undone" in data && data.undone) {
      shopify.toast.show("Change undone");
    }
  }, [fetcher.state, fetcher.data, shopify]);

  useEffect(() => {
    const data = aiFetcher.data;
    if (!data || !("suggestions" in data) || !Array.isArray(data.suggestions)) return;
    setValues((current) => {
      const next = { ...current };
      for (const suggestion of data.suggestions) {
        const before = next[suggestion.id];
        if (!before) continue;
        next[suggestion.id] = {
          seoTitle: suggestion.seoTitle || before.seoTitle,
          seoDescription: suggestion.seoDescription || before.seoDescription,
          imageAlt: suggestion.imageAlt || before.imageAlt,
        };
      }
      return next;
    });
  }, [aiFetcher.data]);

  const update = (id: string, field: Field, value: string) => setValues((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
  const apply = () => fetcher.submit({ intent: "apply", payload: JSON.stringify(changed.map(({ row, edit }) => ({ id: row.id, ...edit }))) }, { method: "post" });
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : "";
  const aiError = aiFetcher.data && "error" in aiFetcher.data ? aiFetcher.data.error : "";
  const aiWarning = aiFetcher.data && "warning" in aiFetcher.data ? aiFetcher.data.warning : "";

  return (
    <Page
      backAction={{ content: "Products & collections", onAction: () => navigate("/app/optimize/catalog") }}
      title="Review search listings"
      subtitle={`${resources.length} selected · Step 2 of 2: generate, review and apply`}
      primaryAction={{ content: `Preview ${changed.length} change${changed.length === 1 ? "" : "s"}`, onAction: () => setPreview(true), disabled: !changed.length }}
    >
      <TitleBar title="Bulk Optimize" />
      <Layout><Layout.Section><BlockStack gap="400">
        <WorkspaceTabs tabs={OPTIMIZE_WORKSPACE_TABS} activeId="catalog" />
        {error && <Banner tone="critical"><p>{error}</p></Banner>}
        {aiError && <Banner tone="critical" title="AI suggestions unavailable"><p>{aiError}</p></Banner>}
        {aiWarning && <Banner tone="warning"><p>{aiWarning}</p></Banner>}
        {missing > 0 && <Banner tone="warning"><p>{missing} selected item(s) no longer exist in Shopify and were skipped.</p></Banner>}
        <Banner tone="info" title="Review before publishing">
          <p>Fields with problems start with a simple suggestion; use AI for better wording. Values equal to the title or description are saved as automatic, so they keep following future edits. Nothing changes in Shopify until you confirm the preview. Each AI suggestion uses one AI generation.</p>
        </Banner>
        <InlineStack align="end">
          <Button disabled={!aiEnabled} loading={aiFetcher.state !== "idle"} onClick={() => aiFetcher.submit({ intent: "generate-ai", ids: resources.map((row) => row.id).join(",") }, { method: "post" })}>
            {aiEnabled ? `Generate with AI (${resources.length})` : "AI not configured"}
          </Button>
        </InlineStack>
        <Card padding="0">
          <IndexTable resourceName={{ singular: "item", plural: "items" }} itemCount={resources.length} selectable={false} headings={[{ title: "Item" }, { title: "SEO title" }, { title: "Meta description" }, { title: "Image alt" }]}>
            {plans.map(({ row, edit, plan }, index) => (
              <IndexTable.Row id={row.id} key={row.id} position={index}>
                <IndexTable.Cell>
                  <div style={{ width: 220, whiteSpace: "normal" }}>
                    <BlockStack gap="100">
                      <Text as="span" fontWeight="semibold">{row.title}</Text>
                      <InlineStack gap="100" wrap>
                        <Badge>{row.type === "collection" ? "Collection" : "Product"}</Badge>
                        {row.problems.map((problem) => <Badge key={problem} tone="warning">{CATALOG_BULK_ISSUES[problem].label}</Badge>)}
                        {plan.changed && <Badge tone="info">Edited</Badge>}
                      </InlineStack>
                    </BlockStack>
                  </div>
                </IndexTable.Cell>
                <IndexTable.Cell><div style={{ minWidth: 260 }}><TextField label="SEO title" labelHidden value={edit.seoTitle} maxLength={70} showCharacterCount autoComplete="off" onChange={(value) => update(row.id, "seoTitle", value)} /></div></IndexTable.Cell>
                <IndexTable.Cell><div style={{ minWidth: 360 }}><TextField label="Meta description" labelHidden value={edit.seoDescription} maxLength={165} showCharacterCount multiline={2} autoComplete="off" onChange={(value) => update(row.id, "seoDescription", value)} /></div></IndexTable.Cell>
                <IndexTable.Cell><div style={{ minWidth: 240 }}><TextField label="Image alt" labelHidden value={edit.imageAlt} disabled={!row.imageUrl} maxLength={255} autoComplete="off" placeholder={row.imageUrl ? "Describe the image" : "No image"} onChange={(value) => update(row.id, "imageAlt", value)} /></div></IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>
        {history.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Recent changes</Text>
                <Button variant="plain" url="/app/optimize/history">View all history</Button>
              </InlineStack>
              {history.map((row) => (
                <InlineStack key={row.id} align="space-between" blockAlign="center">
                  <BlockStack gap="050">
                    <Text as="span" fontWeight="semibold">{row.title}</Text>
                    <Text as="span" tone="subdued" variant="bodySm">{row.status === "undone" ? "Undone" : `Applied ${new Date(row.appliedAt).toLocaleString()}`}</Text>
                  </BlockStack>
                  <Button disabled={row.status !== "applied"} loading={fetcher.state !== "idle" && fetcher.formData?.get("changeId") === row.id} onClick={() => fetcher.submit({ intent: "undo", changeId: row.id }, { method: "post" })}>Undo</Button>
                </InlineStack>
              ))}
            </BlockStack>
          </Card>
        )}
      </BlockStack></Layout.Section></Layout>
      <Modal
        open={preview}
        onClose={() => setPreview(false)}
        title="Confirm search listing changes"
        primaryAction={{ content: `Apply to ${changed.length} item${changed.length === 1 ? "" : "s"}`, onAction: apply, loading: fetcher.state !== "idle", disabled: !changed.length }}
        secondaryActions={[{ content: "Continue editing", onAction: () => setPreview(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {changed.map(({ row, plan }) => (
              <BlockStack gap="150" key={row.id}>
                <Text as="h3" fontWeight="semibold">{row.title}</Text>
                {plan.seoTitle !== row.seoTitle && <Text as="p" variant="bodySm" tone="subdued">SEO title: {row.seoTitle || "(automatic)"} → {plan.seoTitle || "(automatic)"}</Text>}
                {plan.seoDescription !== row.seoDescription && <Text as="p" variant="bodySm" tone="subdued">Meta description: {row.seoDescription || "(automatic)"} → {plan.seoDescription || "(automatic)"}</Text>}
                {plan.altChanged && <Text as="p" variant="bodySm" tone="subdued">Image alt: {row.imageAlt || "(empty)"} → {plan.imageAlt || "(empty)"}</Text>}
              </BlockStack>
            ))}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
