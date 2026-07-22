import { useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, isRouteErrorResponse, useActionData, useLoaderData, useNavigation, useRouteError, useSearchParams } from "@remix-run/react";
import { Badge, Banner, BlockStack, Box, Button, Card, Divider, InlineStack, Layout, Page, Text, TextField, Thumbnail } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { auditCatalogResource, type CatalogResourceInput, type CatalogResourceType } from "../catalog-seo";
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
  return json({ resource, audit: auditCatalogResource(resource), savedAt: saved?.lastAnalyzedAt?.toISOString() || null, adminUrl: `https://${session.shop}/admin/${type === "product" ? "products" : "collections"}/${params.resourceId}` });
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
  const { resource, savedAt, adminUrl } = useLoaderData<typeof loader>();
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
  return <Page fullWidth backAction={{ content: `${typeLabel} SEO`, url: `/app/catalog-seo?type=${resource.type}` }}>
    <TitleBar title={`Edit ${typeLabel.toLowerCase()}`} />
    <Form method="post"><BlockStack gap="500">
      <InlineStack align="space-between" blockAlign="center" gap="300"><BlockStack gap="100"><InlineStack gap="200" blockAlign="center"><Text as="h1" variant="headingXl" fontWeight="bold">{resource.title}</Text><Badge>{typeLabel}</Badge></InlineStack><Text as="p" tone="subdued">Edit Shopify content and its search engine listing in one place.</Text></BlockStack><InlineStack gap="200"><Button url={adminUrl} target="_blank">Open in Shopify</Button><Button variant="primary" submit loading={navigation.state === "submitting"}>Save changes</Button></InlineStack></InlineStack>
      {actionData?.error && <Banner tone="critical" title="Changes were not saved"><p>{actionData.error}</p></Banner>}
      {searchParams.get("saved") === "1" && <Banner tone="success" title={`${typeLabel} updated`}><p>The Shopify content and saved SEO report are now up to date.</p></Banner>}
      <Layout><Layout.Section><BlockStack gap="400">
        <Card><BlockStack gap="400"><Text as="h2" variant="headingMd">{typeLabel} content</Text><TextField name="title" label="Title" value={title} onChange={setTitle} autoComplete="off" maxLength={255} showCharacterCount /><TextField name="descriptionHtml" label="Description (HTML)" value={descriptionHtml} onChange={setDescriptionHtml} multiline={14} autoComplete="off" helpText="HTML is preserved when the content is saved to Shopify." /></BlockStack></Card>
        <Card><BlockStack gap="400"><BlockStack gap="100"><Text as="h2" variant="headingMd">Search engine listing</Text><Text as="p" tone="subdued">Control how this {resource.type} can appear in search results.</Text></BlockStack><TextField name="seoTitle" label="Page title" value={seoTitle} onChange={setSeoTitle} autoComplete="off" maxLength={70} showCharacterCount /><TextField name="seoDescription" label="Meta description" value={seoDescription} onChange={setSeoDescription} multiline={4} autoComplete="off" maxLength={165} showCharacterCount /><TextField name="handle" label="URL handle" value={handle} onChange={setHandle} autoComplete="off" prefix={resource.type === "product" ? "/products/" : "/collections/"} /></BlockStack></Card>
      </BlockStack></Layout.Section><Layout.Section variant="oneThird"><BlockStack gap="400">
        <Card><BlockStack gap="300"><InlineStack align="space-between" blockAlign="center"><Text as="h2" variant="headingMd">SEO score</Text><Badge tone={scoreTone(currentAudit.score)}>{`${currentAudit.score}/100`}</Badge></InlineStack><div className="bp-catalog-score-track"><span style={{ width: `${currentAudit.score}%` }} /></div><Text as="p" variant="bodySm" tone="subdued">{savedAt ? `Last analyzed ${new Date(savedAt).toLocaleString()}` : "Calculated from current Shopify content."}</Text></BlockStack></Card>
        {resource.imageUrl && <Card><BlockStack gap="300"><Text as="h2" variant="headingMd">Featured image</Text><Thumbnail source={resource.imageUrl} alt={resource.imageAlt || resource.title} size="large" /><Text as="p" variant="bodySm" tone={resource.imageAlt ? "subdued" : "critical"}>{resource.imageAlt || "Missing image alt text. Edit media details in Shopify."}</Text></BlockStack></Card>}
        <Card><BlockStack gap="300"><InlineStack align="space-between"><Text as="h2" variant="headingMd">SEO checklist</Text><Badge tone={currentAudit.issues.length ? "warning" : "success"}>{currentAudit.issues.length ? `${currentAudit.issues.length} issues` : "All good"}</Badge></InlineStack><Divider />{currentAudit.issues.length ? currentAudit.issues.map((issue) => <Box key={issue.type} paddingBlockEnd="300"><BlockStack gap="100"><InlineStack align="space-between" blockAlign="center"><Text as="h3" fontWeight="semibold">{issue.label}</Text><Badge tone={issue.impact === "High" ? "critical" : issue.impact === "Medium" ? "warning" : "info"}>{issue.impact}</Badge></InlineStack><Text as="p" variant="bodySm" tone="subdued">{issue.fix}</Text></BlockStack></Box>) : <Banner tone="success" title="No issues found"><p>This resource passes the current Shopify-compatible checks.</p></Banner>}</BlockStack></Card>
      </BlockStack></Layout.Section></Layout>
    </BlockStack></Form>
  </Page>;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? String(error.data || error.statusText) : error instanceof Error ? error.message : "The resource could not be loaded.";
  return <Page><BlockStack gap="400"><Banner tone="critical" title="Unable to open the SEO editor"><p>{message}</p></Banner><InlineStack gap="200"><Button url="/app/catalog-seo?type=product">Back to Product SEO</Button><Button url="/app/catalog-seo?type=collection">Back to Collection SEO</Button></InlineStack></BlockStack></Page>;
}

function resourceType(value?: string): CatalogResourceType { if (value === "product" || value === "collection") return value; throw new Response("Not found", { status: 404 }); }
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
      id title handle descriptionHtml updatedAt status
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
