import { useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate, useRevalidator } from "@remix-run/react";
import type { Prisma } from "@prisma/client";
import { Badge, Banner, BlockStack, Box, Button, Card, Divider, Icon, IndexTable, InlineGrid, InlineStack, Modal, Page, Pagination, Select, Tabs, Text, TextField, Thumbnail } from "@shopify/polaris";
import { AlertTriangleIcon, CheckCircleIcon, CollectionIcon, ProductIcon } from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import type { CatalogResourceType, CatalogSeoIssue } from "../catalog-seo";
import catalogSeoStyles from "../styles/catalog-seo.css?url";

export const links = () => [{ rel: "stylesheet", href: catalogSeoStyles }];

const PAGE_SIZE = 20;
const PLACEHOLDER_IMAGE = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";
const SCOPE_TABS = [
  { id: "blogs", content: "Blog posts" },
  { id: "products", content: "Products" },
  { id: "collections", content: "Collections" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const resourceType: CatalogResourceType = url.searchParams.get("type") === "collection" ? "collection" : "product";
  const view = url.searchParams.get("view") === "manager" ? "manager" : "issues";
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const query = String(url.searchParams.get("q") || "").trim().slice(0, 100);
  const requestedStatus = String(url.searchParams.get("status") || "all");
  const status = ["attention", "good"].includes(requestedStatus) ? requestedStatus : "all";
  const baseWhere: Prisma.ResourceSEOWhereInput = { shop: session.shop, resourceType };
  const where: Prisma.ResourceSEOWhereInput = {
    ...baseWhere,
    ...(query ? { title: { contains: query, mode: "insensitive" } } : {}),
    ...(status === "attention" ? { issueCount: { gt: 0 } } : status === "good" ? { issueCount: 0 } : {}),
  };
  const [rows, filteredTotal, total, aggregate, needsAttention, issueRows, job] = await Promise.all([
    prisma.resourceSEO.findMany({ where, orderBy: [{ seoScore: "asc" }, { title: "asc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.resourceSEO.count({ where }),
    prisma.resourceSEO.count({ where: baseWhere }),
    prisma.resourceSEO.aggregate({ where: baseWhere, _avg: { seoScore: true }, _sum: { issueCount: true } }),
    prisma.resourceSEO.count({ where: { ...baseWhere, issueCount: { gt: 0 } } }),
    prisma.resourceSEO.findMany({ where: { ...baseWhere, issueCount: { gt: 0 } }, select: { resourceId: true, title: true, handle: true, issues: true }, orderBy: { issueCount: "desc" }, take: 5000 }),
    prisma.seoScanJob.findFirst({ where: { shop: session.shop }, orderBy: { requestedAt: "desc" } }),
  ]);
  const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));
  const queryParams = new URLSearchParams({ type: resourceType, ...(query ? { q: query } : {}), ...(status !== "all" ? { status } : {}) });
  if (page > totalPages) {
    queryParams.set("page", String(totalPages));
    return redirect(`/app/catalog-seo?${queryParams}`);
  }
  const grouped = issueRows.flatMap((row) => parseIssues(row.issues).map((issue) => ({ issue, row }))).reduce((groups, entry) => {
    const { issue, row } = entry;
    const current = groups.get(issue.type);
    groups.set(issue.type, { type: issue.type, label: issue.label, count: (current?.count || 0) + 1, impact: issue.impact, effort: issue.effort, fix: issue.fix, affected: [...(current?.affected || []), { id: row.resourceId, title: row.title, handle: row.handle }].slice(0, 8) });
    return groups;
  }, new Map<string, { type: string; label: string; count: number; impact: CatalogSeoIssue["impact"]; effort: CatalogSeoIssue["effort"]; fix: string; affected: Array<{ id: string; title: string; handle: string }> }>());
  const issueGroups = [...grouped.values()].sort((a, b) => impactRank(a.impact) - impactRank(b.impact) || b.count - a.count);
  const data = rows.map((row) => ({
    id: row.resourceId, title: row.title || `Untitled ${resourceType}`, handle: row.handle, status: row.status,
    score: row.seoScore, imageUrl: row.imageUrl, imageAlt: row.imageAlt, issues: parseIssues(row.issues),
    lastAnalyzedAt: row.lastAnalyzedAt?.toISOString() || null,
    adminUrl: `https://${session.shop}/admin/${resourceType === "product" ? "products" : "collections"}/${numericId(row.resourceId)}`,
    editorUrl: `/app/catalog-seo/${resourceType}/${numericId(row.resourceId)}`,
  }));
  return json({ view, resourceType, page, total, filteredTotal, totalPages, query, status, averageScore: Math.round(aggregate._avg.seoScore || 0), needsAttention, totalIssues: aggregate._sum.issueCount || 0, issueGroups, rows: data, job: job ? { status: job.status, phase: job.phase } : null });
};

export default function CatalogSeoPage() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const handled = useRef<unknown>(null);
  const [search, setSearch] = useState(data.query);
  const [reviewRow, setReviewRow] = useState<(typeof data.rows)[number] | null>(null);
  const [reviewIssue, setReviewIssue] = useState<(typeof data.issueGroups)[number] | null>(null);
  const isScanning = fetcher.state !== "idle" || data.job?.status === "queued" || data.job?.status === "running";
  const typeLabel = data.resourceType === "product" ? "Products" : "Collections";

  useEffect(() => { setSearch(data.query); }, [data.query]);
  useEffect(() => {
    if (!isScanning) return;
    const timer = window.setInterval(() => revalidator.revalidate(), 2500);
    return () => window.clearInterval(timer);
  }, [isScanning, revalidator]);
  useEffect(() => {
    if (!fetcher.data || handled.current === fetcher.data) return;
    handled.current = fetcher.data;
    const response = fetcher.data as { success?: boolean; error?: string };
    if (response.success) shopify.toast.show("SEO scan queued for blog posts, products and collections");
    if (response.error) shopify.toast.show(response.error, { isError: true });
  }, [fetcher.data, shopify]);

  const runScan = () => fetcher.submit({ intent: "scan_all" }, { method: "post", action: "/app/seo" });
  const switchScope = (index: number) => index === 0 ? navigate("/app/seo") : navigate(`/app/catalog-seo?type=${index === 1 ? "product" : "collection"}`);
  const switchManagerType = (index: number) => navigate(`/app/catalog-seo?view=manager&type=${index === 0 ? "product" : "collection"}`);
  const goToList = (next: { page?: number; query?: string; status?: string } = {}) => {
    const params = new URLSearchParams({ type: data.resourceType });
    const nextQuery = next.query === undefined ? data.query : next.query;
    const nextStatus = next.status === undefined ? data.status : next.status;
    if (nextQuery) params.set("q", nextQuery);
    if (nextStatus !== "all") params.set("status", nextStatus);
    if ((next.page || 1) > 1) params.set("page", String(next.page));
    navigate(`/app/catalog-seo?${params}`);
  };

  return <Page fullWidth>
    <TitleBar title={data.view === "manager" ? "Catalog Manager" : `${typeLabel} SEO`}><button variant="primary" disabled={isScanning} onClick={runScan}>{isScanning ? "Scanning..." : "Run SEO scan"}</button></TitleBar>
    <BlockStack gap="500">
      <InlineStack align="space-between" blockAlign="end" gap="300"><BlockStack gap="100"><Text as="h1" variant="headingXl" fontWeight="bold">{data.view === "manager" ? "Catalog Manager" : `${typeLabel} SEO issues`}</Text><Text as="p" tone="subdued">{data.view === "manager" ? "Manage and optimize Shopify products and collections in one place." : `Prioritize recurring SEO problems across all scanned ${typeLabel.toLowerCase()}.`}</Text></BlockStack><InlineStack gap="200">{data.view === "issues" && <Button url={`/app/catalog-seo?view=manager&type=${data.resourceType}`}>Manage catalog</Button>}<Button variant="primary" loading={isScanning} onClick={runScan}>Run SEO scan</Button></InlineStack></InlineStack>
      <div className="bp-seo-scope-tabs">{data.view === "manager" ? <Tabs tabs={[{ id: "products", content: "Products" }, { id: "collections", content: "Collections" }]} selected={data.resourceType === "product" ? 0 : 1} onSelect={switchManagerType} /> : <Tabs tabs={SCOPE_TABS} selected={data.resourceType === "product" ? 1 : 2} onSelect={switchScope} />}</div>
      {isScanning && <Banner tone="info" title={data.job?.phase || "SEO scan queued"}><p>Products and collections are scanned in the background. This page updates automatically.</p></Banner>}
      {data.job?.status === "failed" && <Banner tone="critical" title="SEO scan failed"><p>The background scan could not be completed. Check the SEO worker log and run the scan again.</p></Banner>}
      {!data.total && !isScanning && <Banner tone="info" title={`No saved ${typeLabel.toLowerCase()} report`}><p>Run an SEO scan to analyze Shopify {typeLabel.toLowerCase()}.</p></Banner>}
      <InlineGrid columns={{ xs: 1, sm: 2, md: data.view === "manager" ? 4 : 3 }} gap="300">
        {data.view === "manager" && <StatCard label="Average score" value={`${data.averageScore}/100`} icon={CheckCircleIcon} tone={data.averageScore >= 80 ? "success" : "warning"} />}
        <StatCard label="Resources scanned" value={String(data.total)} icon={data.resourceType === "product" ? ProductIcon : CollectionIcon} tone="info" />
        <StatCard label="Need attention" value={String(data.needsAttention)} icon={AlertTriangleIcon} tone={data.needsAttention ? "critical" : "success"} />
        <StatCard label="Total issues" value={String(data.totalIssues)} icon={AlertTriangleIcon} tone={data.totalIssues ? "warning" : "success"} />
      </InlineGrid>
      {data.view === "issues" && <Card padding="0"><Box padding="400"><BlockStack gap="100"><Text as="h2" variant="headingMd">SEO issue report</Text><Text as="p" variant="bodySm" tone="subdued">Issues are grouped so you can fix the highest-impact patterns first.</Text></BlockStack></Box><IndexTable resourceName={{ singular: "issue", plural: "issues" }} itemCount={data.issueGroups.length} selectable={false} headings={[{ title: "Issue" }, { title: "Affected" }, { title: "Impact" }, { title: "Effort" }, { title: "Suggested fix" }, { title: "Action" }]}>{data.issueGroups.map((issue, index) => <IndexTable.Row id={issue.type} key={issue.type} position={index}><IndexTable.Cell><Text as="span" fontWeight="semibold">{issue.label}</Text></IndexTable.Cell><IndexTable.Cell>{issue.count}</IndexTable.Cell><IndexTable.Cell><Badge tone={issue.impact === "High" ? "critical" : issue.impact === "Medium" ? "warning" : "info"}>{issue.impact}</Badge></IndexTable.Cell><IndexTable.Cell><Badge>{issue.effort}</Badge></IndexTable.Cell><IndexTable.Cell><div className="bp-catalog-fix-copy"><Text as="span" variant="bodySm">{issue.fix}</Text></div></IndexTable.Cell><IndexTable.Cell><Button size="micro" onClick={() => setReviewIssue(issue)}>Review</Button></IndexTable.Cell></IndexTable.Row>)}</IndexTable>{!data.issueGroups.length && <Box padding="500"><Banner tone="success" title="No SEO issues found"><p>Run a scan after Shopify content changes to refresh this report.</p></Banner></Box>}</Card>}
      {data.view === "manager" && <Card padding="0">
        <Box padding="400"><BlockStack gap="300"><InlineStack align="space-between"><BlockStack gap="050"><Text as="h2" variant="headingMd">{typeLabel}</Text><Text as="p" variant="bodySm" tone="subdued">Lowest scores are shown first · {data.filteredTotal} matching resources.</Text></BlockStack><Badge>{`${data.total} total`}</Badge></InlineStack><div className="bp-catalog-filters"><TextField label={`Search ${typeLabel.toLowerCase()}`} labelHidden value={search} onChange={setSearch} placeholder={`Search ${typeLabel.toLowerCase()}`} autoComplete="off" connectedRight={<Button onClick={() => goToList({ query: search.trim(), page: 1 })}>Search</Button>} /><Select label="Issue status" labelHidden value={data.status} options={[{ label: "All resources", value: "all" }, { label: "Needs attention", value: "attention" }, { label: "All good", value: "good" }]} onChange={(value) => goToList({ status: value, page: 1 })} /></div></BlockStack></Box>
        <IndexTable resourceName={{ singular: data.resourceType, plural: typeLabel.toLowerCase() }} itemCount={data.rows.length} selectable={false} headings={[{ title: typeLabel.slice(0, -1) }, { title: "SEO score" }, { title: "Issues" }, { title: "Status" }, { title: "Action" }]}>
          {data.rows.map((row, index) => <IndexTable.Row id={row.id} key={row.id} position={index}>
            <IndexTable.Cell><InlineStack gap="300" blockAlign="center" wrap={false}><Thumbnail source={row.imageUrl || PLACEHOLDER_IMAGE} alt={row.imageAlt || row.title} size="small" /><BlockStack gap="050"><Text as="span" fontWeight="semibold">{row.title}</Text><Text as="span" variant="bodySm" tone="subdued">/{data.resourceType === "product" ? "products" : "collections"}/{row.handle}</Text></BlockStack></InlineStack></IndexTable.Cell>
            <IndexTable.Cell><Badge tone={scoreTone(row.score)}>{`${row.score}/100`}</Badge></IndexTable.Cell>
            <IndexTable.Cell>{row.issues.length ? <BlockStack gap="050"><Text as="span" variant="bodySm" fontWeight="semibold">{row.issues[0].label}</Text><Text as="span" variant="bodySm" tone="subdued">{row.issues.length === 1 ? "1 issue" : `${row.issues.length} issues`}</Text></BlockStack> : <Badge tone="success">All good</Badge>}</IndexTable.Cell>
            <IndexTable.Cell>{row.status ? <Badge tone={row.status === "ACTIVE" ? "success" : undefined}>{row.status}</Badge> : <Text as="span" tone="subdued">—</Text>}</IndexTable.Cell>
            <IndexTable.Cell><InlineStack gap="150" wrap={false}><Button size="micro" onClick={() => setReviewRow(row)}>Review</Button><Button size="micro" url={row.editorUrl}>Edit</Button></InlineStack></IndexTable.Cell>
          </IndexTable.Row>)}
        </IndexTable>
        {data.totalPages > 1 && <Box padding="400"><InlineStack align="center"><Pagination label={`Page ${data.page} of ${data.totalPages}`} hasPrevious={data.page > 1} onPrevious={() => goToList({ page: data.page - 1 })} hasNext={data.page < data.totalPages} onNext={() => goToList({ page: data.page + 1 })} /></InlineStack></Box>}
      </Card>}
      <Modal open={Boolean(reviewRow)} onClose={() => setReviewRow(null)} title={reviewRow?.title || "SEO review"} primaryAction={reviewRow ? { content: "Edit in Shopify", url: reviewRow.adminUrl, target: "_blank" } : undefined} secondaryActions={[{ content: "Close", onAction: () => setReviewRow(null) }]}>
        <Modal.Section><BlockStack gap="400">{reviewRow?.issues.length ? reviewRow.issues.map((issue) => <div className="bp-catalog-review-issue" key={issue.type}><InlineStack align="space-between" blockAlign="center"><Text as="h3" fontWeight="semibold">{issue.label}</Text><Badge tone={issue.impact === "High" ? "critical" : issue.impact === "Medium" ? "warning" : "info"}>{issue.impact}</Badge></InlineStack><Text as="p" variant="bodySm" tone="subdued">{issue.message}</Text><Text as="p" variant="bodySm"><strong>Suggested fix:</strong> {issue.fix}</Text></div>) : <Banner tone="success" title="No SEO issues found"><p>This resource passed the current Shopify-compatible checks.</p></Banner>}</BlockStack></Modal.Section>
      </Modal>
      <Modal open={Boolean(reviewIssue)} onClose={() => setReviewIssue(null)} title={reviewIssue?.label || "Affected resources"} secondaryActions={[{ content: "Close", onAction: () => setReviewIssue(null) }]}><Modal.Section><BlockStack gap="400"><Text as="p">{reviewIssue?.fix}</Text><Divider /><BlockStack gap="300">{reviewIssue?.affected.map((resource) => <InlineStack key={resource.id} align="space-between" blockAlign="center" gap="300"><BlockStack gap="050"><Text as="p" fontWeight="semibold">{resource.title}</Text><Text as="p" variant="bodySm" tone="subdued">/{data.resourceType === "product" ? "products" : "collections"}/{resource.handle}</Text></BlockStack><Button size="micro" url={`/app/catalog-seo/${data.resourceType}/${numericId(resource.id)}`}>Edit</Button></InlineStack>)}</BlockStack>{reviewIssue && reviewIssue.count > reviewIssue.affected.length && <Text as="p" variant="bodySm" tone="subdued">Showing {reviewIssue.affected.length} of {reviewIssue.count} affected resources.</Text>}</BlockStack></Modal.Section></Modal>
    </BlockStack>
  </Page>;
}

function StatCard({ label, value, icon, tone }: { label: string; value: string; icon: React.FunctionComponent<React.SVGProps<SVGSVGElement>>; tone: "success" | "warning" | "critical" | "info" }) {
  return <Card><InlineStack align="space-between" blockAlign="start"><BlockStack gap="200"><Text as="p" variant="bodySm" tone="subdued">{label}</Text><Text as="p" variant="headingXl" fontWeight="bold">{value}</Text></BlockStack><Icon source={icon} tone={tone === "info" ? "info" : tone} /></InlineStack></Card>;
}

function parseIssues(value: string | null): CatalogSeoIssue[] {
  try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function numericId(id: string) { return id.split("/").pop() || ""; }
function impactRank(impact: CatalogSeoIssue["impact"]) { return impact === "High" ? 0 : impact === "Medium" ? 1 : 2; }
function scoreTone(score: number): "success" | "warning" | "critical" { return score >= 80 ? "success" : score >= 60 ? "warning" : "critical"; }
