import { useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate, useNavigation, useRevalidator } from "@remix-run/react";
import type { Prisma } from "@prisma/client";
import { Badge, Banner, BlockStack, Box, Button, Card, Divider, IndexTable, InlineStack, Modal, Text, Thumbnail, useIndexResourceState, ChoiceList, IndexFilters, useSetIndexFiltersMode } from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import type { CatalogResourceType, CatalogSeoIssue } from "../catalog-seo";
import catalogSeoStyles from "../styles/catalog-seo.css?url";
import { CATALOG_BULK_ISSUES } from "../catalog-bulk";
import { CATALOG_WORKSPACE_TABS, SEO_WORKSPACE_TABS } from "../components/WorkspaceTabs";
import { IssueScopeSwitcher } from "../components/IssueScopeSwitcher";
import { AppPage } from "../components/AppPage";
import { ActionRow, ActionRows, AiButton, DotScore, Pill, StatTile, StatTiles, impactTone } from "../components/rm";
import { AlertTriangleIcon, XCircleIcon } from "@shopify/polaris-icons";

export const links = () => [{ rel: "stylesheet", href: catalogSeoStyles }];

const PAGE_SIZE = 20;
const PLACEHOLDER_IMAGE = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const { limits } = await getActivePlanAndLimits(billing, session.shop);
  if (!limits.canCatalogSeo) return redirect("/app/pricing?reason=catalog_seo");
  const url = new URL(request.url);
  const requestedType = url.searchParams.get("type");
  const resourceType: CatalogResourceType = requestedType === "collection" || requestedType === "page" ? requestedType : "product";
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
  const [rows, filteredTotal, total, aggregate, needsAttention, issueGroups, job] = await Promise.all([
    prisma.resourceSEO.findMany({ where, orderBy: [{ seoScore: "asc" }, { title: "asc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.resourceSEO.count({ where }),
    prisma.resourceSEO.count({ where: baseWhere }),
    prisma.resourceSEO.aggregate({ where: baseWhere, _avg: { seoScore: true }, _sum: { issueCount: true } }),
    prisma.resourceSEO.count({ where: { ...baseWhere, issueCount: { gt: 0 } } }),
    // Issue groups are only needed for the issue report, and are counted in SQL so they stay exact for any catalog size.
    view === "issues" ? loadIssueGroups(session.shop, resourceType) : Promise.resolve([]),
    prisma.seoScanJob.findFirst({ where: { shop: session.shop }, orderBy: { requestedAt: "desc" } }),
  ]);
  const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));
  const queryParams = new URLSearchParams({ type: resourceType, ...(query ? { q: query } : {}), ...(status !== "all" ? { status } : {}) });
  if (page > totalPages) {
    queryParams.set("page", String(totalPages));
    return redirect(`/app/catalog-seo?${queryParams}`);
  }
  const data = rows.map((row) => ({
    id: row.resourceId, title: row.title || `Untitled ${resourceType}`, handle: row.handle, status: row.status,
    score: row.seoScore, imageUrl: row.imageUrl, imageAlt: row.imageAlt, issues: parseIssues(row.issues),
    lastAnalyzedAt: row.lastAnalyzedAt?.toISOString() || null,
    editorUrl: resourceEditUrl(resourceType, row.resourceId),
  }));
  return json({ canBulk: limits.canBulkReview, view, resourceType, page, total, filteredTotal, totalPages, query, status, averageScore: Math.round(aggregate._avg.seoScore || 0), needsAttention, totalIssues: aggregate._sum.issueCount || 0, issueGroups, rows: data, job: job ? { status: job.status, phase: job.phase } : null });
};

type IssueGroup = { type: string; label: string; count: number; impact: CatalogSeoIssue["impact"]; effort: CatalogSeoIssue["effort"]; fix: string; affected: Array<{ id: string; title: string; handle: string }> };

/** Issue counts and up to 8 example resources per issue type, aggregated in PostgreSQL. */
async function loadIssueGroups(shop: string, resourceType: string): Promise<IssueGroup[]> {
  try {
    const [counts, samples] = await Promise.all([
      prisma.$queryRaw<Array<{ type: string; label: string; impact: string; effort: string; fix: string; count: number }>>`
        SELECT elem->>'type' AS "type", MIN(elem->>'label') AS "label", MIN(elem->>'impact') AS "impact",
               MIN(elem->>'effort') AS "effort", MIN(elem->>'fix') AS "fix", COUNT(*)::int AS "count"
        FROM "ResourceSEO" r, jsonb_array_elements(r."issues"::jsonb) elem
        WHERE r."shop" = ${shop} AND r."resourceType" = ${resourceType} AND r."issueCount" > 0 AND r."issues" IS NOT NULL AND r."issues" <> '' AND r."issues" <> '[]'
        GROUP BY 1`,
      prisma.$queryRaw<Array<{ type: string; resourceId: string; title: string; handle: string }>>`
        SELECT "type", "resourceId", "title", "handle" FROM (
          SELECT elem->>'type' AS "type", r."resourceId", r."title", r."handle",
                 ROW_NUMBER() OVER (PARTITION BY elem->>'type' ORDER BY r."issueCount" DESC, r."title") AS rn
          FROM "ResourceSEO" r, jsonb_array_elements(r."issues"::jsonb) elem
          WHERE r."shop" = ${shop} AND r."resourceType" = ${resourceType} AND r."issueCount" > 0 AND r."issues" IS NOT NULL AND r."issues" <> '' AND r."issues" <> '[]'
        ) ranked WHERE rn <= 8`,
    ]);
    const affected = new Map<string, IssueGroup["affected"]>();
    for (const row of samples) {
      const list = affected.get(row.type) || [];
      list.push({ id: row.resourceId, title: row.title, handle: row.handle });
      affected.set(row.type, list);
    }
    return counts
      .map((row) => ({
        type: row.type,
        label: row.label,
        count: row.count,
        impact: (["High", "Medium", "Low"].includes(row.impact) ? row.impact : "Low") as CatalogSeoIssue["impact"],
        effort: (row.effort === "Medium" ? "Medium" : "Low") as CatalogSeoIssue["effort"],
        fix: row.fix || "",
        affected: affected.get(row.type) || [],
      }))
      .sort((a, b) => impactRank(a.impact) - impactRank(b.impact) || b.count - a.count);
  } catch (error) {
    console.error("Catalog issue aggregation failed", error);
    return [];
  }
}

export default function CatalogSeoPage() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const handled = useRef<unknown>(null);
  const [search, setSearch] = useState(data.query);
  const navigation = useNavigation();
  const { mode, setMode } = useSetIndexFiltersMode();
  const [reviewIssue, setReviewIssue] = useState<(typeof data.issueGroups)[number] | null>(null);
  const isScanning = fetcher.state !== "idle" || data.job?.status === "queued" || data.job?.status === "running";
  const typeLabel = data.resourceType === "product" ? "Products" : data.resourceType === "page" ? "Pages" : "Collections";
  // Products and collections can be sent to Bulk Optimize; pages are edited one at a time.
  const bulkSelectable = data.resourceType !== "page";
  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } = useIndexResourceState(data.rows);
  const selectedIds = allResourcesSelected ? data.rows.map((row) => row.id) : selectedResources;
  useEffect(() => { clearSelection(); }, [data.resourceType, data.page, data.query, data.status, clearSelection]);
  const bulkActions = bulkSelectable ? [{
    content: data.canBulk ? "Optimize search listings" : "Optimize search listings (Growth plan)",
    onAction: () => navigate(data.canBulk ? `/app/optimize/catalog/review?ids=${encodeURIComponent(selectedIds.join(","))}` : "/app/pricing?reason=bulk_edit"),
  }] : undefined;

  useEffect(() => { setSearch(data.query); }, [data.query]);
  // Search as you type, like Shopify's own lists.
  useEffect(() => {
    if (data.view !== "manager" || search.trim() === data.query) return;
    const timer = window.setTimeout(() => goToList({ query: search.trim(), page: 1 }), 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
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
  const switchManagerType = (index: number) => navigate(`/app/catalog-seo?view=manager&type=${index === 0 ? "product" : "collection"}`);
  const goToList = (next: { page?: number; query?: string; status?: string } = {}) => {
    const params = new URLSearchParams({ type: data.resourceType });
    if (data.view === "manager") params.set("view", "manager");
    const nextQuery = next.query === undefined ? data.query : next.query;
    const nextStatus = next.status === undefined ? data.status : next.status;
    if (nextQuery) params.set("q", nextQuery);
    if (nextStatus !== "all") params.set("status", nextStatus);
    if ((next.page || 1) > 1) params.set("page", String(next.page));
    navigate(`/app/catalog-seo?${params}`);
  };

  const manager = data.view === "manager";
  return <AppPage
    title={manager ? "Products & collections" : "SEO Analyzer"}
    subtitle={manager ? "Search listings, descriptions and image alt text for your products and collections." : `Recurring SEO problems in scanned ${typeLabel.toLowerCase()}.`}
    fullWidth
    tabs={manager ? { items: CATALOG_WORKSPACE_TABS, activeId: "manage" } : { items: SEO_WORKSPACE_TABS, activeId: "issues" }}
    primaryAction={{ content: isScanning ? "Scanning…" : "Run SEO scan", onAction: runScan, loading: isScanning }}
    secondaryActions={!manager && data.resourceType !== "page" ? [{ content: "Open in Products & collections", url: `/app/catalog-seo?view=manager&type=${data.resourceType}` }] : []}
  >
    <BlockStack gap="500">
      {data.view === "issues" && <IssueScopeSwitcher active={data.resourceType === "product" ? "products" : data.resourceType === "page" ? "pages" : "collections"} />}
      {isScanning && <Banner tone="info" title={data.job?.phase || "SEO scan queued"}><p>Products and collections are scanned in the background. This page updates automatically.</p></Banner>}
      {data.job?.status === "failed" && <Banner tone="critical" title="SEO scan failed"><p>The background scan could not be completed. Check the SEO worker log and run the scan again.</p></Banner>}
      {!data.total && !isScanning && <Banner tone="info" title={`No saved ${typeLabel.toLowerCase()} report`}><p>Run an SEO scan to analyze Shopify {typeLabel.toLowerCase()}.</p></Banner>}
      <StatTiles>
        {data.view === "manager" && <StatTile label="Average score" value={data.total ? data.averageScore : "–"} tone={!data.total ? "plain" : data.averageScore >= 80 ? "good" : data.averageScore >= 50 ? "warn" : "bad"} hint={data.total ? "out of 100" : "Not scanned"} />}
        <StatTile label={`${typeLabel} scanned`} value={data.total} />
        <StatTile label="Need attention" value={data.needsAttention} tone={data.needsAttention ? "warn" : "good"} />
        <StatTile label="Total issues" value={data.totalIssues} tone={data.totalIssues ? "bad" : "good"} />
      </StatTiles>
      {data.view === "issues" && <Card padding="0">
        <Box padding="400"><BlockStack gap="100"><Text as="h2" variant="headingMd">{`${typeLabel} checks`}</Text><Text as="p" variant="bodySm" tone="subdued">Grouped by problem, highest impact first.</Text></BlockStack></Box>
        {data.issueGroups.length ? (
          <ActionRows>
            {data.issueGroups.map((issue) => (
              <ActionRow
                key={issue.type}
                icon={issue.impact === "High" ? XCircleIcon : AlertTriangleIcon}
                iconTone={issue.impact === "High" ? "bad" : "warn"}
                title={issue.label}
                text={issue.fix}
                meta={`${issue.count} affected${issue.affected.length ? ` · ${issue.affected.slice(0, 2).map((item) => item.title).join(", ")}` : ""}`}
                aside={<>
                  <Pill tone={impactTone(issue.impact)}>{issue.impact}</Pill>
                  {bulkFilterFor(issue.type) && data.resourceType !== "page" && <AiButton url={`/app/optimize/catalog?type=${data.resourceType}&filter=${bulkFilterFor(issue.type)}`}>Fix in bulk</AiButton>}
                  <Button size="slim" onClick={() => setReviewIssue(issue)}>Review</Button>
                </>}
              />
            ))}
          </ActionRows>
        ) : (
          <Box padding="400" paddingBlockStart="0"><Banner tone="success" title="No SEO issues found"><p>Run a scan after Shopify content changes to refresh this report.</p></Banner></Box>
        )}
      </Card>}
      {data.view === "manager" && <Card padding="0">
        <IndexFilters
          tabs={[
            { id: "products", content: "Products", isLocked: true, onAction: () => switchManagerType(0) },
            { id: "collections", content: "Collections", isLocked: true, onAction: () => switchManagerType(1) },
          ]}
          selected={data.resourceType === "product" ? 0 : 1}
          onSelect={switchManagerType}
          canCreateNewView={false}
          queryValue={search}
          queryPlaceholder={`Search ${typeLabel.toLowerCase()}`}
          onQueryChange={setSearch}
          onQueryClear={() => setSearch("")}
          filters={[{
            key: "seo",
            label: "SEO status",
            shortcut: true,
            filter: (
              <ChoiceList
                title="SEO status"
                titleHidden
                choices={[{ label: "Needs attention", value: "attention" }, { label: "All good", value: "good" }]}
                selected={data.status === "all" ? [] : [data.status]}
                onChange={(value) => goToList({ status: value[0] || "all", page: 1 })}
              />
            ),
          }]}
          appliedFilters={data.status === "all" ? [] : [{ key: "seo", label: data.status === "attention" ? "Needs attention" : "All good", onRemove: () => goToList({ status: "all", page: 1 }) }]}
          onClearAll={() => { setSearch(""); goToList({ query: "", status: "all", page: 1 }); }}
          mode={mode}
          setMode={setMode}
          loading={navigation.state === "loading"}
        />
        <IndexTable resourceName={{ singular: data.resourceType, plural: typeLabel.toLowerCase() }} itemCount={data.rows.length} selectable={bulkSelectable} selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length} onSelectionChange={handleSelectionChange} promotedBulkActions={bulkActions} pagination={data.totalPages > 1 ? { hasPrevious: data.page > 1, onPrevious: () => goToList({ page: data.page - 1 }), hasNext: data.page < data.totalPages, onNext: () => goToList({ page: data.page + 1 }), label: `Page ${data.page} of ${data.totalPages} · ${data.filteredTotal} ${typeLabel.toLowerCase()}, lowest score first` } : undefined} headings={[{ title: typeLabel.slice(0, -1) }, { title: "SEO details" }, { title: "Status" }]}>
          {data.rows.map((row, index) => <IndexTable.Row id={row.id} key={row.id} position={index} selected={selectedResources.includes(row.id)} onClick={() => navigate(row.editorUrl)}>
            <IndexTable.Cell><InlineStack gap="300" blockAlign="center" wrap={false}><Thumbnail source={row.imageUrl || PLACEHOLDER_IMAGE} alt={row.imageAlt || row.title} size="small" /><BlockStack gap="050"><Text as="span" fontWeight="semibold">{row.title}</Text><Text as="span" variant="bodySm" tone="subdued">{resourcePath(data.resourceType, row.handle)}</Text></BlockStack></InlineStack></IndexTable.Cell>
            <IndexTable.Cell><InlineStack gap="200" blockAlign="center" wrap={false}><DotScore score={row.score} /><Text as="span" variant="bodySm" tone="subdued">{row.issues.length ? `${row.issues[0].label}${row.issues.length > 1 ? ` · +${row.issues.length - 1} more` : ""}` : "No issues"}</Text></InlineStack></IndexTable.Cell>
            <IndexTable.Cell>{row.status ? <Badge tone={row.status === "ACTIVE" ? "success" : undefined}>{row.status}</Badge> : <Text as="span" tone="subdued">—</Text>}</IndexTable.Cell>
          </IndexTable.Row>)}
        </IndexTable>
      </Card>}
      <Modal open={Boolean(reviewIssue)} onClose={() => setReviewIssue(null)} title={reviewIssue?.label || "Affected resources"} secondaryActions={[{ content: "Close", onAction: () => setReviewIssue(null) }]}><Modal.Section><BlockStack gap="400"><Text as="p">{reviewIssue?.fix}</Text><Divider /><BlockStack gap="300">{reviewIssue?.affected.map((resource) => <InlineStack key={resource.id} align="space-between" blockAlign="center" gap="300"><BlockStack gap="050"><Text as="p" fontWeight="semibold">{resource.title}</Text><Text as="p" variant="bodySm" tone="subdued">{resourcePath(data.resourceType, resource.handle)}</Text></BlockStack><Button size="micro" url={resourceEditUrl(data.resourceType, resource.id)} target={data.resourceType === "page" ? "_top" : undefined}>Edit</Button></InlineStack>)}</BlockStack>{reviewIssue && reviewIssue.count > reviewIssue.affected.length && <Text as="p" variant="bodySm" tone="subdued">Showing {reviewIssue.affected.length} of {reviewIssue.count} affected resources.</Text>}</BlockStack></Modal.Section></Modal>
    </BlockStack>
  </AppPage>;
}


function parseIssues(value: string | null): CatalogSeoIssue[] {
  try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

/** The bulk tool filter that fixes this issue type, if any. */
function bulkFilterFor(type: string) {
  return (Object.keys(CATALOG_BULK_ISSUES) as Array<keyof typeof CATALOG_BULK_ISSUES>).find((key) => CATALOG_BULK_ISSUES[key].types.includes(type)) || null;
}

function numericId(id: string) { return id.split("/").pop() || ""; }

function resourcePath(type: CatalogResourceType, handle: string) {
  if (type === "page") return handle.startsWith("/") ? handle : `/pages/${handle}`;
  return `/${type === "product" ? "products" : "collections"}/${handle}`;
}

/** Products and collections open the in-app editor; store pages open in Shopify admin. */
function resourceEditUrl(type: CatalogResourceType, id: string) {
  if (type !== "page") return `/app/catalog-seo/${type}/${numericId(id)}`;
  if (id === "homepage") return "shopify://admin/online_store/preferences";
  if (id.startsWith("gid://shopify/Blog/")) return `shopify://admin/blogs/${numericId(id)}`;
  return `shopify://admin/pages/${numericId(id)}`;
}
function impactRank(impact: CatalogSeoIssue["impact"]) { return impact === "High" ? 0 : impact === "Medium" ? 1 : 2; }
