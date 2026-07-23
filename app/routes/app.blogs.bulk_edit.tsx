import crypto from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { Banner, BlockStack, Button, Card, IndexTable, InlineStack, Layout, Modal, Page, Text, TextField } from "@shopify/polaris";
import { useEffect, useMemo, useState } from "react";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import prisma from "../db.server";
import { generateAiSeoSuggestion, isNineRouterConfigured } from "../ai-seo.server";
import { getPublicNineRouterErrorMessage } from "../nine-router.server";

type ArticleData = { id: string; title: string; metaTitle: string; metaDescription: string; imageUrl: string; imageAlt: string; suggestedMetaTitle: string; suggestedMetaDescription: string; suggestedImageAlt: string };
type UpdateItem = { id: string; metaTitle: string; metaDescription: string; imageAlt: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const { limits, planKey } = await getActivePlanAndLimits(billing, session.shop);
  if (!limits.canBulkReview) return redirect(`/app/pricing?reason=bulk_edit&plan=${planKey}`);
  const ids = parseIds(new URL(request.url).searchParams.get("ids") || "");
  if (!ids.length) return redirect("/app/blogs");
  const response = await admin.graphql(`#graphql
    query BulkSeoArticles($ids: [ID!]!) {
      nodes(ids: $ids) { ... on Article { id title summary body image { url altText }
        seoTitle: metafield(namespace: "global", key: "title_tag") { value }
        seoDescription: metafield(namespace: "global", key: "description_tag") { value }
      } }
    }`, { variables: { ids } });
  const result: any = await response.json();
  if (result.errors?.length) throw new Response(result.errors[0].message, { status: 502 });
  const articles: ArticleData[] = (result.data?.nodes || []).filter(Boolean).map((node: any) => {
    const metaTitle = clean(node.seoTitle?.value);
    const metaDescription = clean(node.seoDescription?.value);
    return { id: node.id, title: clean(node.title), metaTitle, metaDescription, imageUrl: clean(node.image?.url), imageAlt: clean(node.image?.altText),
      suggestedMetaTitle: suggestTitle(node.title), suggestedMetaDescription: suggestDescription(node.summary, node.body, node.title), suggestedImageAlt: suggestImageAlt(node.title) };
  });
  const history = await prisma.seoBulkChange.findMany({ where: { shop: session.shop }, orderBy: { appliedAt: "desc" }, take: 10 });
  return json({ articles, aiEnabled: isNineRouterConfigured(), history: history.map((row) => ({ ...row, appliedAt: row.appliedAt.toISOString(), undoneAt: row.undoneAt?.toISOString() || null })) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const { limits, planKey } = await getActivePlanAndLimits(billing, session.shop);
  if (!limits.canBulkReview) return json({ error: "Bulk Review is a Growth plan feature.", planKey }, { status: 403 });
  const form = await request.formData();
  const intent = String(form.get("intent") || "apply");
  if (intent === "generate-ai") {
    if (!isNineRouterConfigured()) return json({ error: "9Router is not configured on the server." }, { status: 503 });
    const ids = parseIds(String(form.get("ids") || ""));
    if (!ids.length) return json({ error: "No valid articles were selected." }, { status: 400 });
    const response = await admin.graphql(`#graphql
      query AiSeoArticles($ids: [ID!]!) { nodes(ids: $ids) { ... on Article { id title summary body image { url } } } }
    `, { variables: { ids } });
    const result: any = await response.json();
    if (result.errors?.length) return json({ error: result.errors[0].message }, { status: 502 });
    const nodes = (result.data?.nodes || []).filter(Boolean);
    const suggestions: Awaited<ReturnType<typeof generateAiSeoSuggestion>>[] = [];
    const failures: string[] = [];
    for (let index = 0; index < nodes.length; index += 3) {
      const batch = nodes.slice(index, index + 3);
      const settled = await Promise.allSettled(batch.map((node: any) => generateAiSeoSuggestion({
        id: node.id,
        title: clean(node.title),
        summary: clean(node.summary),
        body: typeof node.body === "string" ? node.body : "",
        hasImage: Boolean(node.image?.url),
      })));
      settled.forEach((item, itemIndex) => {
        if (item.status === "fulfilled") suggestions.push(item.value);
        else failures.push(`${clean(batch[itemIndex]?.title) || "Article"}: ${getPublicNineRouterErrorMessage(item.reason, "AI generation failed. Please try again.")}`);
      });
    }
    if (!suggestions.length) return json({ error: failures[0] || "9Router could not generate suggestions." }, { status: 502 });
    return json({ success: true, suggestions, warning: failures.length ? `${failures.length} article(s) kept their existing suggestions because 9Router failed.` : "" });
  }
  if (intent === "undo") {
    const change = await prisma.seoBulkChange.findFirst({ where: { id: String(form.get("changeId") || ""), shop: session.shop, status: "applied" } });
    if (!change) return json({ error: "This change is unavailable or already undone." }, { status: 404 });
    const error = await setSeo(admin, change.articleId, change.beforeMetaTitle, change.beforeMetaDescription) || await setImageAlt(admin, change.articleId, change.imageUrl, change.beforeImageAlt);
    if (error) return json({ error }, { status: 400 });
    await prisma.$transaction([
      prisma.seoBulkChange.update({ where: { id: change.id }, data: { status: "undone", undoneAt: new Date() } }),
      prisma.articleSEO.upsert({ where: { shop_articleId: { shop: session.shop, articleId: change.articleId } }, update: { metaTitle: nullable(change.beforeMetaTitle), metaDescription: nullable(change.beforeMetaDescription) }, create: { shop: session.shop, articleId: change.articleId, articleTitle: change.articleTitle, metaTitle: nullable(change.beforeMetaTitle), metaDescription: nullable(change.beforeMetaDescription) } }),
    ]);
    return json({ success: true, undone: true });
  }
  const items = parsePayload(String(form.get("payload") || ""));
  const response = await admin.graphql(`#graphql
    query CurrentBulkSeo($ids: [ID!]!) { nodes(ids: $ids) { ... on Article { id title
      image { url altText }
      seoTitle: metafield(namespace: "global", key: "title_tag") { value }
      seoDescription: metafield(namespace: "global", key: "description_tag") { value }
    } } }`, { variables: { ids: items.map((item) => item.id) } });
  const currentResult: any = await response.json();
  if (currentResult.errors?.length) return json({ error: currentResult.errors[0].message }, { status: 502 });
  const current = new Map((currentResult.data?.nodes || []).filter(Boolean).map((node: any) => [node.id, node]));
  const batchId = crypto.randomUUID();
  let applied = 0;
  for (const item of items) {
    const article: any = current.get(item.id);
    if (!article) continue;
    const beforeTitle = clean(article.seoTitle?.value);
    const beforeDescription = clean(article.seoDescription?.value);
    const imageUrl = clean(article.image?.url);
    const beforeImageAlt = clean(article.image?.altText);
    if (beforeTitle === item.metaTitle && beforeDescription === item.metaDescription && beforeImageAlt === item.imageAlt) continue;
    const error = await setSeo(admin, item.id, item.metaTitle, item.metaDescription);
    if (error) return json({ error: `${article.title}: ${error}`, applied }, { status: 400 });
    if (imageUrl && beforeImageAlt !== item.imageAlt) {
      const imageError = await setImageAlt(admin, item.id, imageUrl, item.imageAlt);
      if (imageError) return json({ error: `${article.title}: ${imageError}`, applied }, { status: 400 });
    }
    await prisma.$transaction([
      prisma.seoBulkChange.create({ data: { batchId, shop: session.shop, articleId: item.id, articleTitle: clean(article.title), beforeMetaTitle: beforeTitle, beforeMetaDescription: beforeDescription, afterMetaTitle: item.metaTitle, afterMetaDescription: item.metaDescription, imageUrl, beforeImageAlt, afterImageAlt: imageUrl ? item.imageAlt : beforeImageAlt } }),
      prisma.articleSEO.upsert({ where: { shop_articleId: { shop: session.shop, articleId: item.id } }, update: { articleTitle: clean(article.title), metaTitle: nullable(item.metaTitle), metaDescription: nullable(item.metaDescription) }, create: { shop: session.shop, articleId: item.id, articleTitle: clean(article.title), metaTitle: nullable(item.metaTitle), metaDescription: nullable(item.metaDescription) } }),
    ]);
    applied++;
  }
  return json({ success: true, applied });
};

export default function BulkSeoEdit() {
  const { articles, aiEnabled, history } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  const aiFetcher = useFetcher<typeof action>();
  const [items, setItems] = useState(articles.map((article) => ({ ...article, metaTitle: article.metaTitle || article.suggestedMetaTitle, metaDescription: article.metaDescription || article.suggestedMetaDescription, imageAlt: article.imageAlt || (article.imageUrl ? article.suggestedImageAlt : "") })));
  const [preview, setPreview] = useState(false);
  const changed = useMemo(() => items.filter((item, i) => item.metaTitle !== articles[i]?.metaTitle || item.metaDescription !== articles[i]?.metaDescription || item.imageAlt !== articles[i]?.imageAlt), [articles, items]);
  useEffect(() => { if (fetcher.data && "success" in fetcher.data && fetcher.data.success) { setPreview(false); } }, [fetcher.data]);
  useEffect(() => {
    if (!aiFetcher.data || !("suggestions" in aiFetcher.data) || !Array.isArray(aiFetcher.data.suggestions)) return;
    const suggestions = new Map(aiFetcher.data.suggestions.map((item) => [item.id, item]));
    setItems((rows) => rows.map((row) => {
      const suggestion = suggestions.get(row.id);
      return suggestion ? { ...row, ...suggestion } : row;
    }));
  }, [aiFetcher.data]);
  const update = (id: string, field: "metaTitle" | "metaDescription" | "imageAlt", value: string) => setItems((rows) => rows.map((row) => row.id === id ? { ...row, [field]: value } : row));
  const apply = () => fetcher.submit({ intent: "apply", payload: JSON.stringify(changed.map(({ id, metaTitle, metaDescription, imageAlt }) => ({ id, metaTitle, metaDescription, imageAlt }))) }, { method: "post" });
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : "";
  const aiError = aiFetcher.data && "error" in aiFetcher.data ? aiFetcher.data.error : "";
  const aiWarning = aiFetcher.data && "warning" in aiFetcher.data ? aiFetcher.data.warning : "";
  return <Page backAction={{ content: "Blogs", onAction: () => navigate("/app/blogs") }} title="Bulk SEO Fix" subtitle={`${items.length} selected articles`} primaryAction={{ content: `Preview ${changed.length} changes`, onAction: () => setPreview(true), disabled: !changed.length }}>
    <Layout><Layout.Section><BlockStack gap="400">
      {error && <Banner tone="critical"><p>{error}</p></Banner>}
      {aiError && <Banner tone="critical" title="AI suggestions unavailable"><p>{aiError}</p></Banner>}
      {aiWarning && <Banner tone="warning"><p>{aiWarning}</p></Banner>}
      <Banner tone="info" title="Review before publishing"><p>Suggestions are created from existing article content. Nothing is written to Shopify until you confirm the preview.</p></Banner>
      <InlineStack align="end"><Button disabled={!aiEnabled} loading={aiFetcher.state !== "idle"} onClick={() => aiFetcher.submit({ intent: "generate-ai", ids: articles.map((article) => article.id).join(",") }, { method: "post" })}>{aiEnabled ? "Generate with AI" : "AI not configured"}</Button></InlineStack>
      <Card padding="0"><IndexTable resourceName={{ singular: "article", plural: "articles" }} itemCount={items.length} selectable={false} headings={[{ title: "Article" }, { title: "SEO title" }, { title: "Meta description" }, { title: "Featured image alt" }]}>
        {items.map((item, index) => <IndexTable.Row id={item.id} key={item.id} position={index}>
          <IndexTable.Cell><div style={{ width: 220 }}><Text as="span" fontWeight="semibold">{item.title}</Text></div></IndexTable.Cell>
          <IndexTable.Cell><div style={{ minWidth: 280 }}><TextField label="SEO title" labelHidden value={item.metaTitle} maxLength={70} showCharacterCount autoComplete="off" onChange={(value) => update(item.id, "metaTitle", value)} /></div></IndexTable.Cell>
          <IndexTable.Cell><div style={{ minWidth: 380 }}><TextField label="Meta description" labelHidden value={item.metaDescription} maxLength={160} showCharacterCount autoComplete="off" onChange={(value) => update(item.id, "metaDescription", value)} /></div></IndexTable.Cell>
          <IndexTable.Cell><div style={{ minWidth: 260 }}><TextField label="Featured image alt" labelHidden value={item.imageAlt} disabled={!item.imageUrl} maxLength={255} autoComplete="off" placeholder={item.imageUrl ? "Describe the image" : "No featured image"} onChange={(value) => update(item.id, "imageAlt", value)} /></div></IndexTable.Cell>
        </IndexTable.Row>)}
      </IndexTable></Card>
      {history.length > 0 && <Card><BlockStack gap="300"><Text as="h2" variant="headingMd">Recent changes</Text>{history.map((row) => <InlineStack key={row.id} align="space-between" blockAlign="center"><BlockStack gap="050"><Text as="span" fontWeight="semibold">{row.articleTitle}</Text><Text as="span" tone="subdued" variant="bodySm">{row.status === "undone" ? "Undone" : `Applied ${new Date(row.appliedAt).toLocaleString()}`}</Text></BlockStack><Button disabled={row.status !== "applied"} loading={fetcher.state !== "idle" && fetcher.formData?.get("changeId") === row.id} onClick={() => fetcher.submit({ intent: "undo", changeId: row.id }, { method: "post" })}>Undo</Button></InlineStack>)}</BlockStack></Card>}
    </BlockStack></Layout.Section></Layout>
    <Modal open={preview} onClose={() => setPreview(false)} title="Confirm SEO changes" primaryAction={{ content: `Apply to ${changed.length} articles`, onAction: apply, loading: fetcher.state !== "idle", disabled: !changed.length }} secondaryActions={[{ content: "Continue editing", onAction: () => setPreview(false) }]}>
      <Modal.Section><BlockStack gap="400">{changed.map((item) => { const before = articles.find((row) => row.id === item.id); return <BlockStack gap="150" key={item.id}><Text as="h3" fontWeight="semibold">{item.title}</Text>{before?.metaTitle !== item.metaTitle && <Text as="p" variant="bodySm" tone="subdued">Title: {before?.metaTitle || "(empty)"} → {item.metaTitle || "(empty)"}</Text>}{before?.metaDescription !== item.metaDescription && <Text as="p" variant="bodySm" tone="subdued">Description: {before?.metaDescription || "(empty)"} → {item.metaDescription || "(empty)"}</Text>}{before?.imageAlt !== item.imageAlt && <Text as="p" variant="bodySm" tone="subdued">Image alt: {before?.imageAlt || "(empty)"} → {item.imageAlt || "(empty)"}</Text>}</BlockStack>; })}</BlockStack></Modal.Section>
    </Modal>
  </Page>;
}

function parseIds(value: string) { return [...new Set(value.split(",").map((id) => id.trim()).filter(Boolean).map((id) => /^\d+$/.test(id) ? `gid://shopify/Article/${id}` : id).filter((id) => /^gid:\/\/shopify\/Article\/\d+$/.test(id)))].slice(0, 50); }
function parsePayload(value: string): UpdateItem[] { let parsed: unknown; try { parsed = JSON.parse(value); } catch { throw new Response("Invalid update payload", { status: 400 }); } if (!Array.isArray(parsed) || !parsed.length || parsed.length > 50 || parsed.some((item) => !item || typeof item.id !== "string" || !/^gid:\/\/shopify\/Article\/\d+$/.test(item.id) || typeof item.metaTitle !== "string" || item.metaTitle.length > 70 || typeof item.metaDescription !== "string" || item.metaDescription.length > 160 || typeof item.imageAlt !== "string" || item.imageAlt.length > 255)) throw new Response("Invalid update payload", { status: 400 }); return parsed.map((item) => ({ id: item.id, metaTitle: clean(item.metaTitle), metaDescription: clean(item.metaDescription), imageAlt: clean(item.imageAlt) })); }
async function setSeo(admin: any, ownerId: string, metaTitle: string, metaDescription: string) {
  const values = [{ key: "title_tag", value: metaTitle }, { key: "description_tag", value: metaDescription }];
  const metafields = values.filter((item) => item.value).map((item) => ({ ownerId, namespace: "global", key: item.key, type: "single_line_text_field", value: item.value }));
  const errors: string[] = [];
  if (metafields.length) {
    const response = await admin.graphql(`#graphql
      mutation BulkSetSeo($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { userErrors { field message } } }
    `, { variables: { metafields } });
    const result = await response.json();
    errors.push(...[...(result.errors || []), ...(result.data?.metafieldsSet?.userErrors || [])].map((error: any) => error.message));
  }
  const empty = values.filter((item) => !item.value).map((item) => ({ ownerId, namespace: "global", key: item.key }));
  if (empty.length) {
    const response = await admin.graphql(`#graphql
      mutation BulkDeleteSeo($metafields: [MetafieldIdentifierInput!]!) { metafieldsDelete(metafields: $metafields) { userErrors { field message } } }
    `, { variables: { metafields: empty } });
    const result = await response.json();
    errors.push(...[...(result.errors || []), ...(result.data?.metafieldsDelete?.userErrors || [])].map((error: any) => error.message));
  }
  return errors.join("; ");
}
function suggestTitle(value: unknown) { const title = clean(value); return title.length <= 60 ? title : `${title.slice(0, 57).replace(/[\s,:;-]+$/g, "")}…`; }
function suggestDescription(summary: unknown, body: unknown, title: unknown) { const source = clean(summary) || clean(String(body || "").replace(/<[^>]*>/g, " ")) || clean(title); if (source.length <= 155) return source; const shortened = source.slice(0, 155); const boundary = shortened.lastIndexOf(" "); return `${shortened.slice(0, boundary > 110 ? boundary : 152).replace(/[\s,;:-]+$/g, "")}…`; }
function suggestImageAlt(title: unknown) { return clean(title).replace(/\s*[-|–—]\s*[^-|–—]{1,40}$/u, "").slice(0, 125); }
async function setImageAlt(admin: any, id: string, imageUrl: string, altText: string) { if (!imageUrl) return ""; const response = await admin.graphql(`#graphql
  mutation BulkSetArticleImageAlt($id: ID!, $article: ArticleUpdateInput!) { articleUpdate(id: $id, article: $article) { userErrors { field message } } }
`, { variables: { id, article: { image: { url: imageUrl, altText } } } }); const result = await response.json(); return [...(result.errors || []), ...(result.data?.articleUpdate?.userErrors || [])].map((error: any) => error.message).join("; "); }
function clean(value: unknown) { return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : ""; }
function nullable(value: string) { return value || null; }
