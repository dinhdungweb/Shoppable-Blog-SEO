import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, isRouteErrorResponse, useActionData, useLoaderData, useNavigation, useRouteError, useSearchParams } from "@remix-run/react";
import { Badge, Banner, BlockStack, Button, Card, Divider, Icon, InlineGrid, InlineStack, Layout, Page, Text, TextField } from "@shopify/polaris";
import { AlertTriangleIcon, CheckCircleIcon, CollectionIcon, ImageIcon, ProductIcon, SearchIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { auditCatalogResource, type CatalogResourceInput, type CatalogResourceType, type CatalogSeoIssue } from "../catalog-seo";
import catalogSeoStyles from "../styles/catalog-seo.css?url";

export const links = () => [{ rel: "stylesheet", href: catalogSeoStyles }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const type = resourceType(params.resourceType);
  const gid = shopifyGid(type, params.resourceId);
  const payload = await queryShopify(admin, type === "product" ? PRODUCT_QUERY : COLLECTION_QUERY, { id: gid });
  const node = type === "product" ? payload.data?.product : payload.data?.collection;
  if (!node) throw new Response("Resource not found", { status: 404 });
  const resource = normalizeResource(node, type);
  const saved = await prisma.resourceSEO.findUnique({ where: { shop_resourceType_resourceId: { shop: session.shop, resourceType: type, resourceId: gid } } });
  const details = type === "product"
    ? { status: String(node.status || ""), vendor: String(node.vendor || ""), productType: String(node.productType || ""), tags: Array.isArray(node.tags) ? node.tags : [], collectionKind: "", itemCount: 0 }
    : { status: "", vendor: "", productType: "", tags: [], collectionKind: node.ruleSet ? "Automated" : "Manual", itemCount: Number(node.productsCount?.count || 0) };
  return json({ resource, details, audit: auditCatalogResource(resource), savedAt: saved?.lastAnalyzedAt?.toISOString() || null, adminUrl: `https://${session.shop}/admin/${type === "product" ? "products" : "collections"}/${params.resourceId}` });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const type = resourceType(params.resourceType);
  const gid = shopifyGid(type, params.resourceId);
  const form = await request.formData();
  const title = field(form, "title", 255);
  const handle = field(form, "handle", 255);
  const descriptionHtml = field(form, "descriptionHtml", 100_000);
  const seoTitle = field(form, "seoTitle", 255);
  const seoDescription = field(form, "seoDescription", 500);
  if (!title) return json({ error: "Title is required." }, { status: 400 });
  const variableKey = type === "product" ? "product" : "collection";
  const response = await admin.graphql(type === "product" ? PRODUCT_UPDATE : COLLECTION_UPDATE, { variables: { [variableKey]: { id: gid, title, handle, descriptionHtml, seo: { title: seoTitle || null, description: seoDescription || null } } } });
  const payload: any = await response.json();
  const result = type === "product" ? payload.data?.productUpdate : payload.data?.collectionUpdate;
  const errors = [...(payload.errors || []), ...(result?.userErrors || [])].map((item: any) => item.message).filter(Boolean);
  if (errors.length) return json({ error: errors.join("; ") }, { status: 400 });
  const updated = normalizeResource(type === "product" ? result?.product : result?.collection, type);
  const audit = auditCatalogResource(updated);
  await prisma.resourceSEO.upsert({ where: { shop_resourceType_resourceId: { shop: session.shop, resourceType: type, resourceId: gid } }, create: seoRecord(session.shop, audit), update: seoRecord(session.shop, audit) });
  return redirect(`/app/catalog-seo/${type}/${params.resourceId}?saved=1`);
}

export default function CatalogResourceEditor() {
  const { resource, details, savedAt, adminUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const [title, setTitle] = useState(resource.title);
  const [descriptionHtml, setDescriptionHtml] = useState(resource.descriptionHtml);
  const [seoTitle, setSeoTitle] = useState(resource.seoTitle);
  const [seoDescription, setSeoDescription] = useState(resource.seoDescription);
  const [handle, setHandle] = useState(resource.handle);
  const currentAudit = useMemo(() => auditCatalogResource({ ...resource, title, descriptionHtml, seoTitle, seoDescription, handle }), [resource, title, descriptionHtml, seoTitle, seoDescription, handle]);
  const typeLabel = resource.type === "product" ? "Product" : "Collection";
  const dirty = title !== resource.title || descriptionHtml !== resource.descriptionHtml || seoTitle !== resource.seoTitle || seoDescription !== resource.seoDescription || handle !== resource.handle;
  const wordCount = stripHtml(descriptionHtml).split(/\s+/).filter(Boolean).length;
  const displaySeoTitle = seoTitle.trim() || title.trim() || `Untitled ${typeLabel.toLowerCase()}`;
  const displaySeoDescription = seoDescription.trim() || stripHtml(descriptionHtml).slice(0, 165) || `Add a description for this ${typeLabel.toLowerCase()}.`;
  const reset = () => { setTitle(resource.title); setDescriptionHtml(resource.descriptionHtml); setSeoTitle(resource.seoTitle); setSeoDescription(resource.seoDescription); setHandle(resource.handle); };
  const groups = checklistGroups(currentAudit.issues, resource);
  return <Page fullWidth backAction={{ content: `${typeLabel} SEO`, url: `/app/catalog-seo?type=${resource.type}` }}>
    <TitleBar title={`Edit ${typeLabel.toLowerCase()}`}><button variant="primary" type="submit" form="catalog-resource-form" disabled={!dirty}>Save changes</button></TitleBar>
    <Form method="post" id="catalog-resource-form"><BlockStack gap="500">
      <input type="hidden" name="descriptionHtml" value={descriptionHtml} />
      <InlineStack align="space-between" blockAlign="center" gap="300"><BlockStack gap="100"><InlineStack gap="200" blockAlign="center"><Text as="h1" variant="headingXl" fontWeight="bold">{title || resource.title}</Text><Badge tone={resource.type === "product" && details.status === "ACTIVE" ? "success" : "info"}>{resource.type === "product" ? details.status || typeLabel : typeLabel}</Badge></InlineStack><Text as="p" tone="subdued">Improve storefront content, search appearance and image signals without leaving the app.</Text></BlockStack><InlineStack gap="200"><Button url={adminUrl} target="_blank">Open in Shopify</Button><Button variant="primary" submit loading={navigation.state === "submitting"} disabled={!dirty}>Save changes</Button></InlineStack></InlineStack>
      {actionData?.error && <Banner tone="critical" title="Changes were not saved"><p>{actionData.error}</p></Banner>}
      {searchParams.get("saved") === "1" && <Banner tone="success" title={`${typeLabel} updated`}><p>The Shopify content and saved SEO report are now up to date.</p></Banner>}
      <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
        <EditorMetric label="SEO score" value={`${currentAudit.score}/100`} icon={CheckCircleIcon} tone={scoreTone(currentAudit.score)} />
        <EditorMetric label="Open issues" value={String(currentAudit.issues.length)} icon={AlertTriangleIcon} tone={currentAudit.issues.length ? "warning" : "success"} />
        <EditorMetric label="Description" value={`${wordCount} words`} icon={SearchIcon} tone={wordCount >= (resource.type === "product" ? 40 : 30) ? "success" : "warning"} />
        <EditorMetric label={resource.type === "product" ? "Resource" : "Products"} value={resource.type === "product" ? "Product" : String(details.itemCount)} icon={resource.type === "product" ? ProductIcon : CollectionIcon} tone="info" />
      </InlineGrid>
      <Layout><Layout.Section><BlockStack gap="400">
        <Card><BlockStack gap="400"><InlineStack align="space-between" blockAlign="center"><BlockStack gap="100"><Text as="h2" variant="headingMd">{typeLabel} content</Text><Text as="p" variant="bodySm" tone="subdued">Write useful storefront copy for shoppers, not search engines alone.</Text></BlockStack><Badge>{`${wordCount} words`}</Badge></InlineStack><TextField name="title" label="Title" value={title} onChange={setTitle} autoComplete="off" maxLength={255} showCharacterCount /><BlockStack gap="200"><Text as="h3" fontWeight="semibold">Description</Text><RichTextEditor value={descriptionHtml} onChange={setDescriptionHtml} /></BlockStack></BlockStack></Card>
        <Card><BlockStack gap="400"><InlineStack align="space-between" blockAlign="center"><BlockStack gap="100"><Text as="h2" variant="headingMd">Search engine listing</Text><Text as="p" tone="subdued">Preview and edit the title, description and Shopify URL.</Text></BlockStack><Icon source={SearchIcon} tone="info" /></InlineStack><div className="bp-search-preview"><div className="bp-search-preview__site">Your store · {resource.type}</div><div className="bp-search-preview__title">{displaySeoTitle}</div><div className="bp-search-preview__url">/{resource.type === "product" ? "products" : "collections"}/{handle}</div><div className="bp-search-preview__description">{displaySeoDescription}</div></div><TextField name="seoTitle" label="Page title" value={seoTitle} onChange={setSeoTitle} autoComplete="off" maxLength={70} showCharacterCount helpText="Leave blank to let Shopify use the resource title." /><TextField name="seoDescription" label="Meta description" value={seoDescription} onChange={setSeoDescription} multiline={4} autoComplete="off" maxLength={165} showCharacterCount helpText="Leave blank to let Shopify derive a description from the content." /><TextField name="handle" label="URL handle" value={handle} onChange={setHandle} autoComplete="off" prefix={resource.type === "product" ? "/products/" : "/collections/"} /></BlockStack></Card>
        <Card><BlockStack gap="300"><InlineStack align="space-between" blockAlign="center"><BlockStack gap="100"><Text as="h2" variant="headingMd">SEO checklist</Text><Text as="p" variant="bodySm" tone="subdued">Checks update as you edit this draft.</Text></BlockStack><Badge tone={currentAudit.issues.length ? "warning" : "success"}>{currentAudit.issues.length ? `${currentAudit.issues.length} issues` : "All good"}</Badge></InlineStack>{groups.map((group) => <ChecklistGroup key={group.label} {...group} />)}</BlockStack></Card>
      </BlockStack></Layout.Section><Layout.Section variant="oneThird"><BlockStack gap="400">
        <Card><BlockStack gap="300"><InlineStack align="space-between" blockAlign="center"><Text as="h2" variant="headingMd">SEO score</Text><Text as="p" variant="headingXl" fontWeight="bold">{currentAudit.score}<Text as="span" variant="bodySm" tone="subdued">/100</Text></Text></InlineStack><div className="bp-catalog-score-track"><span style={{ width: `${currentAudit.score}%` }} /></div><Text as="p" variant="bodySm" tone="subdued">{savedAt ? `Last analyzed ${new Date(savedAt).toLocaleString()}` : "Calculated from current Shopify content."}</Text></BlockStack></Card>
        <Card><BlockStack gap="300"><InlineStack align="space-between" blockAlign="center"><Text as="h2" variant="headingMd">Featured image</Text><Icon source={ImageIcon} tone="info" /></InlineStack>{resource.imageUrl ? <div className="bp-editor-image"><img src={resource.imageUrl} alt={resource.imageAlt || resource.title} /></div> : <div className="bp-editor-image bp-editor-image--empty"><Icon source={ImageIcon} tone="subdued" /></div>}<Text as="p" variant="bodySm" tone={resource.imageAlt ? "subdued" : "critical"}>{resource.imageAlt || "Image alt text is missing."}</Text><Button url={adminUrl} target="_blank" fullWidth>{resource.imageAlt ? "Manage image in Shopify" : "Add alt text in Shopify"}</Button></BlockStack></Card>
        <Card><BlockStack gap="300"><Text as="h2" variant="headingMd">{typeLabel} details</Text><Divider />{resource.type === "product" ? <><Detail label="Status" value={details.status || "—"} /><Detail label="Vendor" value={details.vendor || "Not set"} /><Detail label="Product type" value={details.productType || "Not set"} /><Detail label="Tags" value={details.tags.length ? details.tags.slice(0, 5).join(", ") : "None"} /></> : <><Detail label="Collection type" value={details.collectionKind} /><Detail label="Products" value={String(details.itemCount)} /><Detail label="URL" value={`/collections/${handle}`} /></>}<Text as="p" variant="bodySm" tone="subdued">Manage inventory, variants, rules and media safely in Shopify Admin.</Text><Button url={adminUrl} target="_blank" fullWidth>Open full Shopify editor</Button></BlockStack></Card>
      </BlockStack></Layout.Section></Layout>
      {dirty && <div className="bp-editor-savebar"><InlineStack align="space-between" blockAlign="center" gap="300"><Text as="p" fontWeight="semibold">You have unsaved changes</Text><InlineStack gap="200"><Button onClick={reset}>Discard</Button><Button variant="primary" submit loading={navigation.state === "submitting"}>Save changes</Button></InlineStack></InlineStack></div>}
    </BlockStack></Form>
  </Page>;
}

function EditorMetric({ label, value, icon, tone }: { label: string; value: string; icon: React.FunctionComponent<React.SVGProps<SVGSVGElement>>; tone: "success" | "warning" | "critical" | "info" }) {
  return <Card><InlineStack align="space-between" blockAlign="start" wrap={false}><BlockStack gap="150"><Text as="p" variant="bodySm" tone="subdued">{label}</Text><Text as="p" variant="headingLg" fontWeight="bold">{value}</Text></BlockStack><Icon source={icon} tone={tone} /></InlineStack></Card>;
}

function RichTextEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editor.current && document.activeElement !== editor.current && editor.current.innerHTML !== value) editor.current.innerHTML = value;
  }, [value]);
  const command = (name: string, commandValue?: string) => {
    editor.current?.focus();
    document.execCommand(name, false, commandValue);
    if (editor.current) onChange(editor.current.innerHTML);
  };
  return <div className="bp-rich-editor">
    <div className="bp-rich-editor__toolbar" role="toolbar" aria-label="Description formatting">
      <button type="button" onClick={() => command("bold")} aria-label="Bold"><strong>B</strong></button>
      <button type="button" onClick={() => command("italic")} aria-label="Italic"><em>I</em></button>
      <button type="button" onClick={() => command("formatBlock", "h2")} aria-label="Heading">H2</button>
      <button type="button" onClick={() => command("insertUnorderedList")} aria-label="Bulleted list">• List</button>
      <button type="button" onClick={() => { const url = window.prompt("Link URL"); if (url) command("createLink", url); }} aria-label="Insert link">Link</button>
      <button type="button" onClick={() => command("removeFormat")} aria-label="Clear formatting">Clear</button>
    </div>
    <div ref={editor} className="bp-rich-editor__content" contentEditable suppressContentEditableWarning onInput={(event) => onChange(event.currentTarget.innerHTML)} dangerouslySetInnerHTML={{ __html: value }} />
  </div>;
}

type ChecklistRow = { label: string; passed: boolean; fix?: string; impact?: CatalogSeoIssue["impact"] };
function checklistGroups(issues: CatalogSeoIssue[], resource: CatalogResourceInput) {
  const failed = (types: string[]) => issues.filter((issue) => types.includes(issue.type)).map((issue): ChecklistRow => ({ label: issue.label, passed: false, fix: issue.fix, impact: issue.impact }));
  const text = stripHtml(resource.descriptionHtml);
  const words = text.split(/\s+/).filter(Boolean).length;
  const effectiveTitle = resource.seoTitle.trim() || resource.title.trim();
  const effectiveDescription = resource.seoDescription.trim() || text.slice(0, 160).trim();
  return [
    { label: "Search appearance", rows: [...failed(["missing_seo_title", "long_seo_title", "short_seo_title", "missing_meta_description", "short_meta_description", "long_meta_description", "missing_handle", "long_handle"]), ...(effectiveTitle.length >= 20 && effectiveTitle.length <= 70 ? [{ label: "SEO title length is suitable", passed: true }] : []), ...(effectiveDescription.length >= 70 && effectiveDescription.length <= 165 ? [{ label: "Meta description length is suitable", passed: true }] : []), ...(resource.handle.length > 0 && resource.handle.length <= 80 ? [{ label: "URL handle is concise", passed: true }] : [])] },
    { label: "Content quality", rows: [...failed(["missing_description", "thin_description"]), ...(words >= (resource.type === "product" ? 40 : 30) ? [{ label: "Description has useful depth", passed: true }] : [])] },
    { label: "Image SEO", rows: [...failed(["missing_featured_image", "missing_image_alt", "small_image"]), ...(resource.imageUrl ? [{ label: "Featured image is available", passed: true }] : []), ...(resource.imageAlt ? [{ label: "Featured image has alt text", passed: true }] : [])] },
    ...(resource.type === "collection" ? [{ label: "Merchandising", rows: [...failed(["empty_collection"]), ...(resource.itemCount > 0 ? [{ label: "Collection contains products", passed: true }] : [])] }] : []),
  ].map((group) => ({ ...group, rows: dedupeRows(group.rows as ChecklistRow[]) }));
}

function dedupeRows(rows: ChecklistRow[]) { return rows.filter((row, index) => rows.findIndex((candidate) => candidate.label === row.label) === index); }
function ChecklistGroup({ label, rows }: { label: string; rows: ChecklistRow[] }) {
  const failures = rows.filter((row) => !row.passed).length;
  return <div className="bp-checklist-group"><InlineStack align="space-between" blockAlign="center"><Text as="h3" fontWeight="semibold">{label}</Text><Badge tone={failures ? "warning" : "success"}>{failures ? `${failures} issues` : "All good"}</Badge></InlineStack><div className="bp-checklist-rows">{rows.map((row) => <div className="bp-checklist-row" key={row.label}><Icon source={row.passed ? CheckCircleIcon : AlertTriangleIcon} tone={row.passed ? "success" : row.impact === "High" ? "critical" : "warning"} /><div><Text as="p" variant="bodySm" fontWeight={row.passed ? "regular" : "semibold"}>{row.label}</Text>{row.fix && <Text as="p" variant="bodySm" tone="subdued">{row.fix}</Text>}</div></div>)}</div></div>;
}

function Detail({ label, value }: { label: string; value: string }) { return <InlineStack align="space-between" gap="300" wrap={false}><Text as="span" variant="bodySm" tone="subdued">{label}</Text><Text as="span" variant="bodySm" fontWeight="semibold" alignment="end">{value}</Text></InlineStack>; }

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? String(error.data || error.statusText) : error instanceof Error ? error.message : "The resource could not be loaded.";
  return <Page><BlockStack gap="400"><Banner tone="critical" title="Unable to open the SEO editor"><p>{message}</p></Banner><InlineStack gap="200"><Button url="/app/catalog-seo?type=product">Back to Product SEO</Button><Button url="/app/catalog-seo?type=collection">Back to Collection SEO</Button></InlineStack></BlockStack></Page>;
}

function resourceType(value?: string): CatalogResourceType { if (value === "product" || value === "collection") return value; throw new Response("Not found", { status: 404 }); }
function stripHtml(value: string) { return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim(); }
function shopifyGid(type: CatalogResourceType, id?: string) { if (!id || !/^\d+$/.test(id)) throw new Response("Not found", { status: 404 }); return `gid://shopify/${type === "product" ? "Product" : "Collection"}/${id}`; }
function field(form: FormData, key: string, max: number) { return String(form.get(key) || "").trim().slice(0, max); }
function scoreTone(score: number): "success" | "warning" | "critical" { return score >= 80 ? "success" : score >= 60 ? "warning" : "critical"; }
function normalizeResource(node: any, type: CatalogResourceType): CatalogResourceInput { const image = type === "product" ? node.featuredMedia?.preview?.image || {} : node.image || {}; return { id: String(node.id), type, title: String(node.title || ""), handle: String(node.handle || ""), descriptionHtml: String(node.descriptionHtml || ""), updatedAt: String(node.updatedAt || ""), status: String(node.status || ""), seoTitle: String(node.seo?.title || ""), seoDescription: String(node.seo?.description || ""), imageUrl: String(image.url || ""), imageAlt: String(image.altText || ""), imageWidth: Number(image.width || 0), imageHeight: Number(image.height || 0), itemCount: type === "collection" ? Number(node.products?.nodes?.length || 0) : 0 }; }
function seoRecord(shop: string, audit: ReturnType<typeof auditCatalogResource>) { return { shop, resourceType: audit.type, resourceId: audit.id, title: audit.title, handle: audit.handle, status: audit.status, seoScore: audit.score, metaTitle: audit.seoTitle, metaDescription: audit.seoDescription, imageUrl: audit.imageUrl, imageAlt: audit.imageAlt, issues: JSON.stringify(audit.issues), issueCount: audit.issues.length, contentHash: audit.contentHash, sourceUpdatedAt: new Date(), lastAnalyzedAt: new Date() }; }

async function queryShopify(admin: any, query: string, variables: Record<string, unknown>) {
  try {
    const response = await admin.graphql(query, { variables });
    const payload: any = await response.json();
    if (payload.errors?.length) throw new Error(payload.errors.map((item: any) => item.message).join("; "));
    return payload;
  } catch (error: any) {
    const details = Array.isArray(error?.graphQLErrors) ? error.graphQLErrors.map((item: any) => item.message || String(item)).join("; ") : "";
    const message = details || error?.message || "Shopify API request failed";
    console.error("Catalog SEO editor Shopify query failed", { message, graphQLErrors: error?.graphQLErrors });
    throw new Response(`Shopify could not load this resource: ${message}`, { status: 502 });
  }
}

const PRODUCT_QUERY = `#graphql
  query CatalogSeoProduct($id: ID!) {
    product(id: $id) {
      id title handle descriptionHtml updatedAt status vendor productType tags
      seo { title description }
      featuredMedia { preview { image { url altText width height } } }
    }
  }
`;
const COLLECTION_QUERY = `#graphql
  query CatalogSeoCollection($id: ID!) {
    collection(id: $id) {
      id title handle descriptionHtml updatedAt
      seo { title description }
      image { url altText width height }
      products(first: 1) { nodes { id } }
      productsCount { count }
      ruleSet { appliedDisjunctively }
    }
  }
`;
const PRODUCT_UPDATE = `#graphql
  mutation UpdateCatalogProduct($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product {
        id title handle descriptionHtml updatedAt status
        seo { title description }
        featuredMedia { preview { image { url altText width height } } }
      }
      userErrors { field message }
    }
  }
`;
const COLLECTION_UPDATE = `#graphql
  mutation UpdateCatalogCollection($collection: CollectionUpdateInput!) {
    collectionUpdate(collection: $collection) {
      collection {
        id title handle descriptionHtml updatedAt
        seo { title description }
        image { url altText width height }
        products(first: 1) { nodes { id } }
      }
      userErrors { field message }
    }
  }
`;
