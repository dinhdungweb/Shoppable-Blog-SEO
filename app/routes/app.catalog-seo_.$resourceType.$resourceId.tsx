import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, isRouteErrorResponse, useActionData, useLoaderData, useNavigation, useRouteError, useSearchParams } from "@remix-run/react";
import { Badge, Banner, BlockStack, Button, Card, Divider, Icon, InlineGrid, InlineStack, Modal, Page, Select, Text, TextField } from "@shopify/polaris";
import { AlertTriangleIcon, CheckCircleIcon, ChevronDownIcon, ChevronUpIcon, CodeIcon, CollectionIcon, DataTableIcon, ImageIcon, LinkIcon, ListBulletedIcon, PlayCircleIcon, ProductIcon, SearchIcon, TextAlignCenterIcon, TextAlignLeftIcon, TextAlignRightIcon, TextBoldIcon, TextItalicIcon, TextUnderlineIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import { auditCatalogResource, type CatalogResourceInput, type CatalogResourceType, type CatalogSeoIssue } from "../catalog-seo";
import { suggestInternalLinksForDraft, insertApprovedLink, type LinkSuggestion } from "../internal-linking";
import { PLAN_LIMITS } from "../pricing-plans";
import catalogSeoStyles from "../styles/catalog-seo.css?url";

export const links = () => [{ rel: "stylesheet", href: catalogSeoStyles }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, session, billing } = await authenticate.admin(request);
  const type = resourceType(params.resourceType);
  const gid = shopifyGid(type, params.resourceId);
  const payload = await queryShopify(admin, type === "product" ? PRODUCT_QUERY : COLLECTION_QUERY, { id: gid });
  const node = type === "product" ? payload.data?.product : payload.data?.collection;
  if (!node) throw new Response("Resource not found", { status: 404 });
  const resource = normalizeResource(node, type);
  let saved;
  try {
    saved = await prisma.resourceSEO.findUnique({ where: { shop_resourceType_resourceId: { shop: session.shop, resourceType: type, resourceId: gid } } });
  } catch (error: any) {
    if (error?.code === "P2022") throw new Response("The database update for the catalog SEO editor has not been applied. Run `npx prisma migrate deploy` on the server, then restart the app.", { status: 503 });
    throw error;
  }
  resource.focusKeyword = saved?.focusKeyword || "";
  let planAccess: Awaited<ReturnType<typeof getActivePlanAndLimits>>;
  try {
    planAccess = await getActivePlanAndLimits(billing);
  } catch (error) {
    console.error("Catalog SEO editor billing lookup failed; using safe free-plan access", error);
    planAccess = { limits: PLAN_LIMITS.free, planKey: "free", planName: "" };
  }
  const { limits, planKey } = planAccess;
  const linkTargets = limits.canInternalLinking ? await prisma.articleSEO.findMany({ where: { shop: session.shop }, select: { articleId: true, articleTitle: true, articleHandle: true, blogHandle: true }, orderBy: { sourceUpdatedAt: "desc" }, take: 250 }) : [];
  const details = type === "product"
    ? { status: String(node.status || ""), vendor: String(node.vendor || ""), productType: String(node.productType || ""), tags: Array.isArray(node.tags) ? node.tags : [], collectionKind: "", itemCount: 0 }
    : { status: "", vendor: "", productType: "", tags: [], collectionKind: node.ruleSet ? "Automated" : "Manual", itemCount: Number(node.productsCount?.count || 0) };
  return json({ resource, details, audit: auditCatalogResource(resource), savedAt: saved?.lastAnalyzedAt?.toISOString() || null, adminUrl: `https://${session.shop}/admin/${type === "product" ? "products" : "collections"}/${params.resourceId}`, canInternalLinking: limits.canInternalLinking, planKey, linkTargets });
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
  const status = ["ACTIVE", "DRAFT", "ARCHIVED"].includes(field(form, "status", 20)) ? field(form, "status", 20) : "ACTIVE";
  const vendor = field(form, "vendor", 255);
  const productType = field(form, "productType", 255);
  const tags = field(form, "tags", 5_000).split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 250);
  const focusKeyword = field(form, "focusKeyword", 500);
  const imageAlt = field(form, "imageAlt", 500);
  if (!title) return json({ error: "Title is required." }, { status: 400 });
  const variableKey = type === "product" ? "product" : "collection";
  const input = { id: gid, title, handle, descriptionHtml, seo: { title: seoTitle || null, description: seoDescription || null }, ...(type === "product" ? { status, vendor, productType, tags } : { ...(imageAlt !== field(form, "originalImageAlt", 500) ? { image: { src: field(form, "imageUrl", 2_000), altText: imageAlt } } : {}) }) };
  const response = await admin.graphql(type === "product" ? PRODUCT_UPDATE : COLLECTION_UPDATE, { variables: { [variableKey]: input } });
  const payload: any = await response.json();
  const result = type === "product" ? payload.data?.productUpdate : payload.data?.collectionUpdate;
  const errors = [...(payload.errors || []), ...(result?.userErrors || [])].map((item: any) => item.message).filter(Boolean);
  if (errors.length) return json({ error: errors.join("; ") }, { status: 400 });
  if (type === "product" && imageAlt !== field(form, "originalImageAlt", 500) && field(form, "mediaId", 500)) {
    const mediaResponse = await admin.graphql(FILE_UPDATE, { variables: { files: [{ id: field(form, "mediaId", 500), alt: imageAlt }] } });
    const mediaPayload: any = await mediaResponse.json();
    const mediaErrors = [...(mediaPayload.errors || []), ...(mediaPayload.data?.fileUpdate?.userErrors || [])].map((item: any) => item.message).filter(Boolean);
    if (mediaErrors.length) return json({ error: mediaErrors.join("; ") }, { status: 400 });
  }
  const updated = normalizeResource(type === "product" ? result?.product : result?.collection, type);
  updated.imageAlt = imageAlt;
  updated.focusKeyword = focusKeyword;
  const audit = auditCatalogResource(updated);
  await prisma.resourceSEO.upsert({ where: { shop_resourceType_resourceId: { shop: session.shop, resourceType: type, resourceId: gid } }, create: seoRecord(session.shop, audit), update: seoRecord(session.shop, audit) });
  return redirect(`/app/catalog-seo/${type}/${params.resourceId}?saved=1`);
}

export default function CatalogResourceEditor() {
  const { resource, details, savedAt, adminUrl, canInternalLinking, planKey, linkTargets } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const initialSeoTitle = resource.seoTitle.trim() || resource.title;
  const initialSeoDescription = resource.seoDescription.trim() || stripHtml(resource.descriptionHtml).slice(0, 165);
  const [title, setTitleState] = useState(resource.title);
  const [descriptionHtml, setDescriptionHtml] = useState(resource.descriptionHtml);
  const [seoTitle, setSeoTitle] = useState(initialSeoTitle);
  const [seoDescription, setSeoDescription] = useState(initialSeoDescription);
  const seoTitleAutomatic = useRef(!resource.seoTitle.trim());
  const seoDescriptionAutomatic = useRef(!resource.seoDescription.trim());
  const [handle, setHandle] = useState(resource.handle);
  const [status, setStatus] = useState(details.status || "ACTIVE");
  const [vendor, setVendor] = useState(details.vendor);
  const [productType, setProductType] = useState(details.productType);
  const [tags, setTags] = useState(details.tags.join(", "));
  const [focusKeyword, setFocusKeyword] = useState(resource.focusKeyword || "");
  const [keywordInput, setKeywordInput] = useState("");
  const [imageAlt, setImageAlt] = useState(resource.imageAlt);
  const [pendingLink, setPendingLink] = useState<LinkSuggestion | null>(null);
  const [linkAnchor, setLinkAnchor] = useState("");
  const currentAudit = useMemo(() => auditCatalogResource({ ...resource, title, descriptionHtml, seoTitle, seoDescription, handle, imageAlt, focusKeyword }), [resource, title, descriptionHtml, seoTitle, seoDescription, handle, imageAlt, focusKeyword]);
  const typeLabel = resource.type === "product" ? "Product" : "Collection";
  const dirty = title !== resource.title || descriptionHtml !== resource.descriptionHtml || seoTitle !== initialSeoTitle || seoDescription !== initialSeoDescription || handle !== resource.handle || imageAlt !== resource.imageAlt || focusKeyword !== (resource.focusKeyword || "") || (resource.type === "product" && (status !== details.status || vendor !== details.vendor || productType !== details.productType || tags !== details.tags.join(", ")));
  const wordCount = stripHtml(descriptionHtml).split(/\s+/).filter(Boolean).length;
  const displaySeoTitle = seoTitle.trim() || title.trim() || `Untitled ${typeLabel.toLowerCase()}`;
  const displaySeoDescription = seoDescription.trim() || stripHtml(descriptionHtml).slice(0, 165) || `Add a description for this ${typeLabel.toLowerCase()}.`;
  const setTitle = (next: string) => { setTitleState(next); if (seoTitleAutomatic.current) setSeoTitle(next.slice(0, 70)); };
  const setDescription = (next: string) => { setDescriptionHtml(next); if (seoDescriptionAutomatic.current) setSeoDescription(stripHtml(next).slice(0, 165)); };
  const reset = () => { setTitleState(resource.title); setDescriptionHtml(resource.descriptionHtml); setSeoTitle(initialSeoTitle); setSeoDescription(initialSeoDescription); seoTitleAutomatic.current = !resource.seoTitle.trim(); seoDescriptionAutomatic.current = !resource.seoDescription.trim(); setHandle(resource.handle); setStatus(details.status || "ACTIVE"); setVendor(details.vendor); setProductType(details.productType); setTags(details.tags.join(", ")); setImageAlt(resource.imageAlt); setFocusKeyword(resource.focusKeyword || ""); };
  const groups = checklistGroups(currentAudit.issues, { ...resource, title, descriptionHtml, seoTitle, seoDescription, handle, imageAlt, focusKeyword });
  const linkSuggestions = useMemo(() => canInternalLinking ? suggestInternalLinksForDraft({ id: resource.id, title, handle, blogHandle: resource.type === "product" ? "products" : "collections", body: descriptionHtml }, linkTargets.map((item) => ({ id: item.articleId, title: item.articleTitle, handle: item.articleHandle, blogHandle: item.blogHandle, body: "" })), 8) : [], [canInternalLinking, descriptionHtml, handle, linkTargets, resource.id, resource.type, title]);
  return <Page fullWidth backAction={{ content: `${typeLabel} SEO`, url: `/app/catalog-seo?type=${resource.type}` }}>
    <TitleBar title={`Edit ${typeLabel.toLowerCase()}`}><button variant="primary" type="submit" form="catalog-resource-form" disabled={!dirty}>Save changes</button></TitleBar>
    <div className="bp-catalog-editor-shell"><Form method="post" id="catalog-resource-form"><BlockStack gap="500">
      <input type="hidden" name="descriptionHtml" value={descriptionHtml} />
      <input type="hidden" name="focusKeyword" value={focusKeyword} /><input type="hidden" name="originalImageAlt" value={resource.imageAlt} /><input type="hidden" name="imageUrl" value={resource.imageUrl} /><input type="hidden" name="mediaId" value={(resource as any).mediaId || ""} />
      <InlineStack align="space-between" blockAlign="center" gap="300"><BlockStack gap="100"><InlineStack gap="200" blockAlign="center"><Text as="h1" variant="headingXl" fontWeight="bold">{title || resource.title}</Text><Badge tone={resource.type === "product" && details.status === "ACTIVE" ? "success" : "info"}>{resource.type === "product" ? details.status || typeLabel : typeLabel}</Badge></InlineStack><Text as="p" tone="subdued">Improve storefront content, search appearance and image signals without leaving the app.</Text></BlockStack><InlineStack gap="200"><Button url={adminUrl} target="_blank">Open in Shopify</Button><Button variant="primary" submit loading={navigation.state === "submitting"} disabled={!dirty}>Save changes</Button></InlineStack></InlineStack>
      {actionData?.error && <Banner tone="critical" title="Changes were not saved"><p>{actionData.error}</p></Banner>}
      {searchParams.get("saved") === "1" && <Banner tone="success" title={`${typeLabel} updated`}><p>The Shopify content and saved SEO report are now up to date.</p></Banner>}
      <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
        <EditorMetric label="SEO score" value={`${currentAudit.score}/100`} icon={CheckCircleIcon} tone={scoreTone(currentAudit.score)} />
        <EditorMetric label="Open issues" value={String(currentAudit.issues.length)} icon={AlertTriangleIcon} tone={currentAudit.issues.length ? "warning" : "success"} />
        <EditorMetric label="Description" value={`${wordCount} words`} icon={SearchIcon} tone={wordCount >= (resource.type === "product" ? 40 : 30) ? "success" : "warning"} />
        <EditorMetric label={resource.type === "product" ? "Resource" : "Products"} value={resource.type === "product" ? "Product" : String(details.itemCount)} icon={resource.type === "product" ? ProductIcon : CollectionIcon} tone="info" />
      </InlineGrid>
      <div className="bp-catalog-editor-main"><main className="bp-catalog-editor-content"><BlockStack gap="400">
        <Card><BlockStack gap="400"><InlineStack align="space-between" blockAlign="center"><BlockStack gap="100"><Text as="h2" variant="headingMd">{typeLabel} content</Text><Text as="p" variant="bodySm" tone="subdued">Write useful storefront copy for shoppers, not search engines alone.</Text></BlockStack><Badge>{`${wordCount} words`}</Badge></InlineStack><TextField name="title" label="Title" value={title} onChange={setTitle} autoComplete="off" maxLength={255} showCharacterCount /><BlockStack gap="200"><Text as="h3" fontWeight="semibold">Description</Text><RichTextEditor value={descriptionHtml} onChange={setDescription} /></BlockStack></BlockStack></Card>
        <Card><BlockStack gap="400"><InlineStack gap="200" blockAlign="center"><Icon source={SearchIcon} tone="info" /><BlockStack gap="100"><Text as="h2" variant="headingMd">Search engine listing</Text><Text as="p" tone="subdued">Preview and edit the title, description and Shopify URL.</Text></BlockStack></InlineStack><div className="bp-search-preview"><div className="bp-search-preview__site">Your store · {resource.type}</div><div className="bp-search-preview__title">{displaySeoTitle}</div><div className="bp-search-preview__url">/{resource.type === "product" ? "products" : "collections"}/{handle}</div><div className="bp-search-preview__description">{displaySeoDescription}</div></div><TextField name="seoTitle" label="Page title" value={seoTitle} onChange={(next) => { seoTitleAutomatic.current = false; setSeoTitle(next); }} autoComplete="off" maxLength={70} showCharacterCount helpText="Automatically follows the resource title until you edit this field manually." /><TextField name="seoDescription" label="Meta description" value={seoDescription} onChange={(next) => { seoDescriptionAutomatic.current = false; setSeoDescription(next); }} multiline={4} autoComplete="off" maxLength={165} showCharacterCount helpText="Automatically follows the description until you edit this field manually." /><TextField name="handle" label="URL handle" value={handle} onChange={setHandle} autoComplete="off" prefix={resource.type === "product" ? "/products/" : "/collections/"} /></BlockStack></Card>
        <FocusKeywordCard value={focusKeyword} input={keywordInput} setInput={setKeywordInput} onChange={setFocusKeyword} audit={currentAudit} />
        <Card><BlockStack gap="300"><InlineStack align="space-between" blockAlign="center"><BlockStack gap="100"><Text as="h2" variant="headingMd">SEO score</Text><Text as="p" variant="bodySm" tone="subdued">Every passed and failed check remains visible and updates while you edit.</Text></BlockStack><Badge tone={scoreTone(currentAudit.score)}>{`${currentAudit.score}/100`}</Badge></InlineStack><div className="bp-checklist-groups">{groups.map((group) => <ChecklistGroup key={group.label} {...group} />)}</div></BlockStack></Card>
      </BlockStack></main><aside className="bp-catalog-editor-sidebar"><BlockStack gap="400">
        <Card><BlockStack gap="300"><InlineStack align="space-between" blockAlign="center"><Text as="h2" variant="headingMd">SEO score</Text><Text as="p" variant="headingXl" fontWeight="bold">{currentAudit.score}<Text as="span" variant="bodySm" tone="subdued">/100</Text></Text></InlineStack><div className="bp-catalog-score-track"><span style={{ width: `${currentAudit.score}%` }} /></div><Text as="p" variant="bodySm" tone="subdued">{savedAt ? `Last analyzed ${new Date(savedAt).toLocaleString()}` : "Calculated from current Shopify content."}</Text></BlockStack></Card>
        <Card><BlockStack gap="300"><InlineStack gap="200" blockAlign="center"><Icon source={ImageIcon} tone="info" /><Text as="h2" variant="headingMd">Image</Text></InlineStack>{resource.imageUrl ? <div className="bp-editor-image"><img src={resource.imageUrl} alt={imageAlt || resource.title} /></div> : <div className="bp-editor-image bp-editor-image--empty"><Icon source={ImageIcon} tone="subdued" /></div>}<TextField name="imageAlt" label="Image alt text" value={imageAlt} onChange={setImageAlt} autoComplete="off" maxLength={500} helpText="Briefly describe the image for screen readers and image search." /><Button url={adminUrl} target="_blank" fullWidth>Change image in Shopify</Button></BlockStack></Card>
        <InternalLinkCard allowed={canInternalLinking} planKey={planKey} suggestions={linkSuggestions} onReview={(suggestion) => { setPendingLink(suggestion); setLinkAnchor(suggestion.anchorText); }} />
        <Card><BlockStack gap="300"><Text as="h2" variant="headingMd">{typeLabel} settings</Text><Divider />{resource.type === "product" ? <><Select name="status" label="Status" value={status} onChange={setStatus} options={[{ label: "Active", value: "ACTIVE" }, { label: "Draft", value: "DRAFT" }, { label: "Archived", value: "ARCHIVED" }]} /><TextField name="vendor" label="Vendor" value={vendor} onChange={setVendor} autoComplete="off" /><TextField name="productType" label="Product type" value={productType} onChange={setProductType} autoComplete="off" /><TextField name="tags" label="Tags" value={tags} onChange={setTags} autoComplete="off" helpText="Separate tags with commas." /></> : <><Detail label="Collection type" value={details.collectionKind} /><Detail label="Products" value={String(details.itemCount)} /><Detail label="URL" value={`/collections/${handle}`} /></>}<Text as="p" variant="bodySm" tone="subdued">Variants, pricing, inventory, collection rules and media remain in Shopify to prevent destructive edits.</Text><Button url={adminUrl} target="_blank" fullWidth>Open full Shopify editor</Button></BlockStack></Card>
      </BlockStack></aside></div>
      {dirty && <div className="bp-editor-savebar"><InlineStack align="space-between" blockAlign="center" gap="300"><Text as="p" fontWeight="semibold">You have unsaved changes</Text><InlineStack gap="200"><Button onClick={reset}>Discard</Button><Button variant="primary" submit loading={navigation.state === "submitting"}>Save changes</Button></InlineStack></InlineStack></div>}
    </BlockStack></Form></div>
    <Modal open={Boolean(pendingLink)} onClose={() => setPendingLink(null)} title="Review internal link" primaryAction={{ content: "Insert link", onAction: () => { if (!pendingLink) return; setDescriptionHtml(insertApprovedLink(descriptionHtml, linkAnchor.trim() || pendingLink.anchorText, pendingLink.targetUrl).body); setPendingLink(null); } }} secondaryActions={[{ content: "Cancel", onAction: () => setPendingLink(null) }]}><Modal.Section><BlockStack gap="300"><Text as="p">Link to <strong>{pendingLink?.targetTitle}</strong></Text><TextField label="Anchor text" value={linkAnchor} onChange={setLinkAnchor} autoComplete="off" /><Text as="p" variant="bodySm" tone="subdued">The link is inserted into the description only after you approve and save this resource.</Text></BlockStack></Modal.Section></Modal>
  </Page>;
}

function EditorMetric({ label, value, icon, tone }: { label: string; value: string; icon: React.FunctionComponent<React.SVGProps<SVGSVGElement>>; tone: "success" | "warning" | "critical" | "info" }) {
  return <Card><BlockStack gap="150"><InlineStack gap="150" blockAlign="center"><Icon source={icon} tone={tone} /><Text as="p" variant="bodySm" tone="subdued">{label}</Text></InlineStack><Text as="p" variant="headingLg" fontWeight="bold">{value}</Text></BlockStack></Card>;
}

function FocusKeywordCard({ value, input, setInput, onChange, audit }: { value: string; input: string; setInput: (value: string) => void; onChange: (value: string) => void; audit: ReturnType<typeof auditCatalogResource> }) {
  const keywords = value.split(",").map((item) => item.trim()).filter(Boolean);
  const addKeyword = () => {
    const next = input.trim();
    if (next && !keywords.some((item) => item.toLowerCase() === next.toLowerCase())) onChange([...keywords, next].join(", "));
    setInput("");
  };
  return <Card><BlockStack gap="300"><Text as="h2" variant="headingMd">Focus keyword</Text><div onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addKeyword(); } }}><TextField label="Focus keyword" labelHidden value={input} onChange={setInput} autoComplete="off" placeholder="Type keyword and press Enter" connectedRight={<Button onClick={addKeyword} disabled={!input.trim()}>Add</Button>} /></div>{keywords.length > 0 ? <InlineStack gap="200">{keywords.map((keyword) => { const relatedIssues = audit.issues.filter((issue) => issue.type.startsWith("keyword_") || issue.type === "missing_focus_keyword"); return <button type="button" className="bp-keyword-chip" key={keyword} onClick={() => onChange(keywords.filter((item) => item !== keyword).join(", "))} title="Remove keyword"><Badge tone={relatedIssues.length ? "warning" : "success"}>{`${keyword} ×`}</Badge></button>; })}</InlineStack> : <Text as="p" variant="bodySm" tone="subdued">Add the primary phrase shoppers use to find this page. It will activate keyword-specific checks.</Text>}</BlockStack></Card>;
}

function InternalLinkCard({ allowed, planKey, suggestions, onReview }: { allowed: boolean; planKey: string; suggestions: LinkSuggestion[]; onReview: (suggestion: LinkSuggestion) => void }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? suggestions : suggestions.slice(0, 3);
  return <Card><BlockStack gap="300"><InlineStack align="space-between" blockAlign="center"><InlineStack gap="200" blockAlign="center"><Icon source={LinkIcon} tone="info" /><Text as="h2" variant="headingMd">Internal link assistant</Text></InlineStack>{allowed && <Badge tone="info">{`${suggestions.length} suggestions`}</Badge>}</InlineStack>{!allowed ? <><Text as="p" variant="bodySm" tone="subdued">Available on Pro and Growth plans.</Text><Button url={`/app/pricing?reason=internal_linking&plan=${planKey}`} fullWidth>Upgrade to Pro</Button></> : suggestions.length ? <><Text as="p" variant="bodySm" tone="subdued">Review relevant Shopify articles before inserting a link into this description.</Text><div className="bp-catalog-link-list">{visible.map((suggestion) => <div className="bp-catalog-link-row" key={suggestion.id}><div className="bp-catalog-link-copy"><Text as="p" variant="bodySm" fontWeight="semibold">{suggestion.targetTitle}</Text><Text as="p" variant="bodySm" tone="subdued">Anchor: {suggestion.anchorText}</Text></div><Button size="micro" onClick={() => onReview(suggestion)}>Review</Button></div>)}</div>{suggestions.length > 3 && <Button variant="plain" onClick={() => setExpanded((value) => !value)} icon={expanded ? ChevronUpIcon : ChevronDownIcon}>{expanded ? "Show fewer" : `Show ${suggestions.length - 3} more`}</Button>}</> : <Text as="p" variant="bodySm" tone="subdued">No relevant article suggestion was found for the current title and description.</Text>}</BlockStack></Card>;
}

function RichTextEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const editor = useRef<HTMLDivElement>(null);
  const selection = useRef<Range | null>(null);
  const [htmlMode, setHtmlMode] = useState(false);
  const [block, setBlock] = useState("p");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const activeLink = useRef<HTMLAnchorElement | null>(null);
  const [imageOpen, setImageOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  useEffect(() => {
    if (editor.current && document.activeElement !== editor.current && editor.current.innerHTML !== value) editor.current.innerHTML = value;
  }, [value]);
  const saveSelection = () => {
    const active = window.getSelection();
    if (!editor.current || !active || !active.rangeCount) return;
    const range = active.getRangeAt(0);
    if (editor.current.contains(range.commonAncestorContainer)) selection.current = range.cloneRange();
  };
  const restoreSelection = () => {
    const active = window.getSelection();
    if (!active || !selection.current) return;
    active.removeAllRanges();
    active.addRange(selection.current);
  };
  const emit = () => { if (editor.current) onChange(editor.current.innerHTML); };
  const command = (name: string, commandValue?: string) => {
    editor.current?.focus();
    restoreSelection();
    document.execCommand(name, false, commandValue);
    emit();
  };
  const insertHtml = (html: string) => command("insertHTML", html);
  const openLink = () => {
    saveSelection();
    const range = selection.current;
    const node = range?.startContainer;
    const element = node instanceof HTMLElement ? node : node?.parentElement;
    const anchor = element?.closest("a");
    activeLink.current = anchor && editor.current?.contains(anchor) ? anchor : null;
    setLinkUrl(activeLink.current?.getAttribute("href") || "");
    setLinkText(activeLink.current?.textContent || window.getSelection()?.toString() || "");
    setLinkOpen(true);
  };
  const applyLink = () => {
    if (!/^https?:\/\//i.test(linkUrl) && !linkUrl.startsWith("/")) return;
    if (activeLink.current) {
      activeLink.current.setAttribute("href", linkUrl);
      if (linkText.trim()) activeLink.current.textContent = linkText.trim();
      emit();
      activeLink.current = null;
      setLinkOpen(false); setLinkUrl(""); setLinkText("");
      return;
    }
    restoreSelection();
    if (linkText) insertHtml(`<a href="${escapeHtml(linkUrl)}">${escapeHtml(linkText)}</a>`); else command("createLink", linkUrl);
    setLinkOpen(false); setLinkUrl(""); setLinkText("");
  };
  const removeLink = () => {
    const anchor = activeLink.current;
    if (!anchor) return;
    const parent = anchor.parentNode;
    while (anchor.firstChild) parent?.insertBefore(anchor.firstChild, anchor);
    parent?.removeChild(anchor);
    activeLink.current = null;
    emit();
    setLinkOpen(false); setLinkUrl(""); setLinkText("");
  };
  const closeLink = () => { activeLink.current = null; setLinkOpen(false); setLinkUrl(""); setLinkText(""); };
  const applyImage = () => { if (!/^https?:\/\//i.test(imageUrl)) return; restoreSelection(); insertHtml(`<p><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(imageAlt)}" style="max-width:100%;height:auto"></p>`); setImageOpen(false); setImageUrl(""); setImageAlt(""); };
  const applyVideo = () => { const embed = videoEmbed(videoUrl); if (!embed) return; restoreSelection(); insertHtml(embed); setVideoOpen(false); setVideoUrl(""); };
  const toolbarButton = (label: string, icon: any, action: () => void) => <button type="button" title={label} aria-label={label} className="bp-editor-icon-button" onMouseDown={(event) => { event.preventDefault(); saveSelection(); }} onClick={action}><Icon source={icon} tone="base" /></button>;
  return <>
    <div className="bp-rich-editor">
      <div className="bp-editor-toolbar" role="toolbar" aria-label="Description formatting">
        <Select label="Text style" labelHidden options={[{ label: "Paragraph", value: "p" }, { label: "Heading 2", value: "h2" }, { label: "Heading 3", value: "h3" }, { label: "Quote", value: "blockquote" }]} value={block} onChange={(next) => { setBlock(next); command("formatBlock", next); }} />
        <span className="bp-editor-separator" />
        {toolbarButton("Bold", TextBoldIcon, () => command("bold"))}
        {toolbarButton("Italic", TextItalicIcon, () => command("italic"))}
        {toolbarButton("Underline", TextUnderlineIcon, () => command("underline"))}
        <span className="bp-editor-separator" />
        {toolbarButton("Align left", TextAlignLeftIcon, () => command("justifyLeft"))}
        {toolbarButton("Align center", TextAlignCenterIcon, () => command("justifyCenter"))}
        {toolbarButton("Align right", TextAlignRightIcon, () => command("justifyRight"))}
        {toolbarButton("Bulleted list", ListBulletedIcon, () => command("insertUnorderedList"))}
        <span className="bp-editor-separator" />
        {toolbarButton("Insert link", LinkIcon, openLink)}
        {toolbarButton("Insert image", ImageIcon, () => { saveSelection(); setImageOpen(true); })}
        {toolbarButton("Insert video", PlayCircleIcon, () => { saveSelection(); setVideoOpen(true); })}
        {toolbarButton("Insert table", DataTableIcon, () => insertHtml('<table><tbody><tr><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td></tr></tbody></table><p><br></p>'))}
        <button type="button" title="HTML view" aria-label="HTML view" className={`bp-editor-icon-button bp-editor-code-button${htmlMode ? " is-active" : ""}`} onClick={() => setHtmlMode((active) => !active)}><Icon source={CodeIcon} tone="base" /></button>
      </div>
      <div ref={editor} className="bp-editor-canvas" style={{ display: htmlMode ? "none" : "block" }} contentEditable suppressContentEditableWarning role="textbox" aria-label="Resource description" data-placeholder="Write a detailed description..." onInput={emit} onBlur={emit} onKeyUp={saveSelection} onMouseUp={saveSelection} onClick={(event) => { if ((event.target as HTMLElement).closest("a")) event.preventDefault(); }} />
      {htmlMode && <textarea className="bp-editor-html-textarea" value={value} onChange={(event) => onChange(event.target.value)} aria-label="Description HTML" />}
    </div>
    <Modal open={linkOpen} onClose={closeLink} title={activeLink.current ? "Edit link" : "Insert link"} primaryAction={{ content: activeLink.current ? "Apply" : "Insert link", onAction: applyLink, disabled: !linkUrl }} secondaryActions={activeLink.current ? [{ content: "Remove link", onAction: removeLink, destructive: true }, { content: "Cancel", onAction: closeLink }] : [{ content: "Cancel", onAction: closeLink }]}><Modal.Section><BlockStack gap="300"><TextField label="Link to" value={linkUrl} onChange={setLinkUrl} autoComplete="off" placeholder="https://example.com" /><TextField label="Text to display" value={linkText} onChange={setLinkText} autoComplete="off" /></BlockStack></Modal.Section></Modal>
    <Modal open={imageOpen} onClose={() => setImageOpen(false)} title="Insert image" primaryAction={{ content: "Insert image", onAction: applyImage, disabled: !imageUrl }} secondaryActions={[{ content: "Cancel", onAction: () => setImageOpen(false) }]}><Modal.Section><BlockStack gap="300"><TextField label="Image URL" value={imageUrl} onChange={setImageUrl} autoComplete="off" placeholder="https://cdn.shopify.com/..." /><TextField label="Alt text" value={imageAlt} onChange={setImageAlt} autoComplete="off" helpText="Describe the image for accessibility and image search." /></BlockStack></Modal.Section></Modal>
    <Modal open={videoOpen} onClose={() => setVideoOpen(false)} title="Insert video" primaryAction={{ content: "Insert video", onAction: applyVideo, disabled: !videoEmbed(videoUrl) }} secondaryActions={[{ content: "Cancel", onAction: () => setVideoOpen(false) }]}><Modal.Section><TextField label="YouTube, Vimeo or video URL" value={videoUrl} onChange={setVideoUrl} autoComplete="off" placeholder="https://www.youtube.com/watch?v=..." /></Modal.Section></Modal>
  </>;
}

type ChecklistRow = { label: string; passed: boolean; fix?: string; impact?: CatalogSeoIssue["impact"] };
function checklistGroups(issues: CatalogSeoIssue[], resource: CatalogResourceInput) {
  const issueRow = (entry: CatalogSeoIssue): ChecklistRow => ({ label: entry.label, passed: false, fix: entry.fix, impact: entry.impact });
  const check = (types: string[], passedLabel: string): ChecklistRow[] => {
    const matches = issues.filter((entry) => types.includes(entry.type));
    return matches.length ? matches.map(issueRow) : [{ label: passedLabel, passed: true }];
  };
  const hasKeyword = Boolean((resource.focusKeyword || "").trim());
  const hasImage = Boolean(resource.imageUrl);
  return [
    { label: "Search appearance", rows: [
      ...check(["missing_seo_title", "long_seo_title", "short_seo_title"], "SEO title length is suitable"),
      ...check(["missing_meta_description", "short_meta_description", "long_meta_description"], "Meta description length is suitable"),
      ...check(["missing_handle", "long_handle"], "URL handle is concise"),
      ...check(["unclean_handle"], "URL uses lowercase words and hyphens"),
    ] },
    { label: "Title readability", rows: [
      ...check(["title_word_count"], "SEO title has a scannable word count"),
      ...check(["title_all_caps"], "SEO title uses natural capitalization"),
      ...check(["title_repeated_words"], "SEO title does not repeat terms"),
    ] },
    { label: "Content quality", rows: [
      ...check(["missing_description", "thin_description"], "Description meets the minimum useful length"),
      ...check(["limited_content_depth"], "Description provides useful shopper detail"),
      ...check(["missing_subheadings"], "Description uses useful subheadings"),
      ...check(["missing_internal_link"], "Description includes a contextual link"),
    ] },
    { label: "Content readability", rows: [
      ...check(["long_paragraph"], "Paragraphs are easy to scan on mobile"),
    ] },
    { label: "Focus keyword", rows: hasKeyword ? [
      ...check(["keyword_missing_title"], "Focus keyword appears in the SEO title"),
      ...check(["keyword_missing_description"], "Focus keyword appears in the meta description"),
      ...check(["keyword_missing_content"], "Focus keyword appears in the description"),
      ...check(["keyword_missing_url"], "Focus keyword appears in the URL"),
      ...check(["keyword_missing_heading"], "Focus keyword is used in a relevant heading"),
      ...check(["keyword_missing_image_alt"], "Image alt text supports the focus topic"),
    ] : issues.filter((entry) => entry.type === "missing_focus_keyword").map(issueRow) },
    { label: "Image SEO", rows: hasImage ? [
      ...check(["missing_image_alt"], "Featured image has descriptive alt text"),
      ...check(["long_image_alt"], "Image alt text is concise"),
      ...check(["small_image"], "Image resolution is suitable"),
      ...check(["generic_image_filename"], "Image filename is descriptive"),
    ] : issues.filter((entry) => entry.type === "missing_featured_image").map(issueRow) },
    ...(resource.type === "collection" ? [{ label: "Merchandising", rows: check(["empty_collection"], "Collection contains products") }] : []),
  ].map((group) => ({ ...group, rows: dedupeRows(group.rows as ChecklistRow[]) }));
}

function dedupeRows(rows: ChecklistRow[]) { return rows.filter((row, index) => rows.findIndex((candidate) => candidate.label === row.label) === index); }
function ChecklistGroup({ label, rows }: { label: string; rows: ChecklistRow[] }) {
  const failures = rows.filter((row) => !row.passed).length;
  const [open, setOpen] = useState(false);
  return <div className="bp-checklist-group"><button type="button" className="bp-checklist-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}><InlineStack gap="200" blockAlign="center"><Text as="h3" fontWeight="semibold">{label}</Text><Badge tone={failures ? "warning" : "success"}>{failures ? `${failures} ${failures === 1 ? "issue" : "issues"}` : "All good"}</Badge></InlineStack><Icon source={open ? ChevronUpIcon : ChevronDownIcon} tone="subdued" /></button>{open && <div className="bp-checklist-rows">{rows.map((row) => <div className="bp-checklist-row" key={row.label}><Icon source={row.passed ? CheckCircleIcon : AlertTriangleIcon} tone={row.passed ? "success" : row.impact === "High" ? "critical" : "warning"} /><div><Text as="p" variant="bodySm" fontWeight={row.passed ? "regular" : "semibold"}>{row.label}</Text>{row.fix && <Text as="p" variant="bodySm" tone="subdued">{row.fix}</Text>}</div></div>)}</div>}</div>;
}

function Detail({ label, value }: { label: string; value: string }) { return <InlineStack align="space-between" gap="300" wrap={false}><Text as="span" variant="bodySm" tone="subdued">{label}</Text><Text as="span" variant="bodySm" fontWeight="semibold" alignment="end">{value}</Text></InlineStack>; }

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? String(error.data || error.statusText) : error instanceof Error ? error.message : "The resource could not be loaded.";
  return <Page><BlockStack gap="400"><Banner tone="critical" title="Unable to open the SEO editor"><p>{message}</p></Banner><InlineStack gap="200"><Button url="/app/catalog-seo?type=product">Back to Product SEO</Button><Button url="/app/catalog-seo?type=collection">Back to Collection SEO</Button></InlineStack></BlockStack></Page>;
}

function resourceType(value?: string): CatalogResourceType { if (value === "product" || value === "collection") return value; throw new Response("Not found", { status: 404 }); }
function stripHtml(value: string) { return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim(); }
function escapeHtml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function videoEmbed(value: string) {
  const input = value.trim();
  if (!input) return "";
  try {
    const url = new URL(input);
    const youtubeId = url.hostname.includes("youtu.be") ? url.pathname.slice(1) : url.hostname.includes("youtube.com") ? url.searchParams.get("v") || url.pathname.split("/").pop() : "";
    if (youtubeId) return `<div class="bp-editor-video"><iframe src="https://www.youtube.com/embed/${escapeHtml(youtubeId)}" title="Embedded video" allowfullscreen></iframe></div><p><br></p>`;
    if (url.hostname.includes("vimeo.com")) return `<div class="bp-editor-video"><iframe src="https://player.vimeo.com/video/${escapeHtml(url.pathname.split("/").filter(Boolean).pop() || "")}" title="Embedded video" allowfullscreen></iframe></div><p><br></p>`;
    return `<p><a href="${escapeHtml(input)}">${escapeHtml(input)}</a></p>`;
  } catch { return ""; }
}
function shopifyGid(type: CatalogResourceType, id?: string) { if (!id || !/^\d+$/.test(id)) throw new Response("Not found", { status: 404 }); return `gid://shopify/${type === "product" ? "Product" : "Collection"}/${id}`; }
function field(form: FormData, key: string, max: number) { return String(form.get(key) || "").trim().slice(0, max); }
function scoreTone(score: number): "success" | "warning" | "critical" { return score >= 80 ? "success" : score >= 60 ? "warning" : "critical"; }
function normalizeResource(node: any, type: CatalogResourceType): CatalogResourceInput { const image = type === "product" ? node.featuredMedia?.preview?.image || {} : node.image || {}; return { id: String(node.id), type, title: String(node.title || ""), handle: String(node.handle || ""), descriptionHtml: String(node.descriptionHtml || ""), updatedAt: String(node.updatedAt || ""), status: String(node.status || ""), seoTitle: String(node.seo?.title || ""), seoDescription: String(node.seo?.description || ""), imageUrl: String(image.url || ""), imageAlt: String(image.altText || ""), imageWidth: Number(image.width || 0), imageHeight: Number(image.height || 0), itemCount: type === "collection" ? Number(node.products?.nodes?.length || 0) : 0, mediaId: type === "product" ? String(node.featuredMedia?.id || "") : "" }; }
function seoRecord(shop: string, audit: ReturnType<typeof auditCatalogResource>) { return { shop, resourceType: audit.type, resourceId: audit.id, title: audit.title, handle: audit.handle, status: audit.status, seoScore: audit.score, metaTitle: audit.seoTitle, metaDescription: audit.seoDescription, focusKeyword: audit.focusKeyword || "", imageUrl: audit.imageUrl, imageAlt: audit.imageAlt, issues: JSON.stringify(audit.issues), issueCount: audit.issues.length, contentHash: audit.contentHash, sourceUpdatedAt: new Date(), lastAnalyzedAt: new Date() }; }

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
      featuredMedia { id preview { image { url altText width height } } }
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
const FILE_UPDATE = `#graphql
  mutation CatalogSeoFileUpdate($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) { files { id alt } userErrors { field message } }
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
