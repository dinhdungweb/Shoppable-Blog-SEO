import { useEffect, useRef } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate, useRevalidator } from "@remix-run/react";
import { Badge, Banner, BlockStack, Box, Button, Card, Icon, IndexTable, InlineGrid, InlineStack, Page, Tabs, Text, Thumbnail } from "@shopify/polaris";
import { AlertTriangleIcon, CheckCircleIcon, CollectionIcon, ProductIcon } from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import type { CatalogResourceType, CatalogSeoIssue } from "../catalog-seo";

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
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const where = { shop: session.shop, resourceType };
  const [rows, total, aggregate, job] = await Promise.all([
    prisma.resourceSEO.findMany({ where, orderBy: [{ seoScore: "asc" }, { title: "asc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.resourceSEO.count({ where }),
    prisma.resourceSEO.aggregate({ where, _avg: { seoScore: true } }),
    prisma.seoScanJob.findFirst({ where: { shop: session.shop }, orderBy: { requestedAt: "desc" } }),
  ]);
  const data = rows.map((row) => ({
    id: row.resourceId, title: row.title || `Untitled ${resourceType}`, handle: row.handle, status: row.status,
    score: row.seoScore, imageUrl: row.imageUrl, imageAlt: row.imageAlt, issues: parseIssues(row.issues),
    lastAnalyzedAt: row.lastAnalyzedAt?.toISOString() || null,
    adminUrl: `https://${session.shop}/admin/${resourceType === "product" ? "products" : "collections"}/${numericId(row.resourceId)}`,
  }));
  return json({ resourceType, page, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)), averageScore: Math.round(aggregate._avg.seoScore || 0), rows: data, job: job ? { status: job.status, phase: job.phase } : null });
};

export default function CatalogSeoPage() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const handled = useRef<unknown>(null);
  const isScanning = fetcher.state !== "idle" || data.job?.status === "queued" || data.job?.status === "running";
  const typeLabel = data.resourceType === "product" ? "Products" : "Collections";
  const affected = data.rows.filter((row) => row.issues.length > 0).length;
  const issueCount = data.rows.reduce((sum, row) => sum + row.issues.length, 0);

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
  return <Page fullWidth>
    <TitleBar title={`${typeLabel} SEO`}><button variant="primary" disabled={isScanning} onClick={runScan}>{isScanning ? "Scanning..." : "Run SEO scan"}</button></TitleBar>
    <BlockStack gap="500">
      <InlineStack align="space-between" blockAlign="end" gap="300">
        <BlockStack gap="100"><Text as="h1" variant="headingXl" fontWeight="bold">{typeLabel} SEO</Text><Text as="p" tone="subdued">Review Shopify search listings, descriptions, URL handles and image SEO.</Text></BlockStack>
        <Button variant="primary" loading={isScanning} onClick={runScan}>Run SEO scan</Button>
      </InlineStack>
      <Card padding="200"><Tabs tabs={SCOPE_TABS} selected={data.resourceType === "product" ? 1 : 2} onSelect={switchScope} /></Card>
      {isScanning && <Banner tone="info" title={data.job?.phase || "SEO scan queued"}><p>Products and collections are scanned in the background. This page updates automatically.</p></Banner>}
      {data.job?.status === "failed" && <Banner tone="critical" title="SEO scan failed"><p>The background scan could not be completed. Check the SEO worker log and run the scan again.</p></Banner>}
      {!data.total && !isScanning && <Banner tone="info" title={`No saved ${typeLabel.toLowerCase()} report`}><p>Run an SEO scan to analyze Shopify {typeLabel.toLowerCase()}.</p></Banner>}
      <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
        <StatCard label="Average score" value={`${data.averageScore}/100`} icon={CheckCircleIcon} tone={data.averageScore >= 80 ? "success" : "warning"} />
        <StatCard label="Resources scanned" value={String(data.total)} icon={data.resourceType === "product" ? ProductIcon : CollectionIcon} tone="info" />
        <StatCard label="Issues on this page" value={String(issueCount)} icon={AlertTriangleIcon} tone={issueCount ? "critical" : "success"} />
      </InlineGrid>
      <Card padding="0">
        <Box padding="400"><InlineStack align="space-between"><BlockStack gap="050"><Text as="h2" variant="headingMd">{typeLabel}</Text><Text as="p" variant="bodySm" tone="subdued">Lowest scores are shown first · {affected} need attention on this page.</Text></BlockStack><Badge>{`${data.total} total`}</Badge></InlineStack></Box>
        <IndexTable resourceName={{ singular: data.resourceType, plural: typeLabel.toLowerCase() }} itemCount={data.rows.length} selectable={false} headings={[{ title: typeLabel.slice(0, -1) }, { title: "SEO score" }, { title: "Issues" }, { title: "Status" }, { title: "Action" }]}>
          {data.rows.map((row, index) => <IndexTable.Row id={row.id} key={row.id} position={index}>
            <IndexTable.Cell><InlineStack gap="300" blockAlign="center" wrap={false}><Thumbnail source={row.imageUrl || PLACEHOLDER_IMAGE} alt={row.imageAlt || row.title} size="small" /><BlockStack gap="050"><Text as="span" fontWeight="semibold">{row.title}</Text><Text as="span" variant="bodySm" tone="subdued">/{data.resourceType === "product" ? "products" : "collections"}/{row.handle}</Text></BlockStack></InlineStack></IndexTable.Cell>
            <IndexTable.Cell><Badge tone={scoreTone(row.score)}>{`${row.score}/100`}</Badge></IndexTable.Cell>
            <IndexTable.Cell><BlockStack gap="100">{row.issues.length ? row.issues.slice(0, 2).map((issue) => <BlockStack gap="050" key={issue.type}><Text as="span" variant="bodySm" fontWeight="semibold">{issue.label}</Text><Text as="span" variant="bodySm" tone="subdued">{issue.fix}</Text></BlockStack>) : <Badge tone="success">All good</Badge>}{row.issues.length > 2 && <Text as="span" variant="bodySm" tone="subdued">+{row.issues.length - 2} more</Text>}</BlockStack></IndexTable.Cell>
            <IndexTable.Cell>{row.status ? <Badge tone={row.status === "ACTIVE" ? "success" : undefined}>{row.status}</Badge> : <Text as="span" tone="subdued">—</Text>}</IndexTable.Cell>
            <IndexTable.Cell><Button size="micro" url={row.adminUrl} target="_blank">Edit in Shopify</Button></IndexTable.Cell>
          </IndexTable.Row>)}
        </IndexTable>
        {data.totalPages > 1 && <Box padding="400"><InlineStack align="center" gap="300"><Button disabled={data.page <= 1} onClick={() => navigate(`/app/catalog-seo?type=${data.resourceType}&page=${data.page - 1}`)}>Previous</Button><Text as="span" variant="bodySm">Page {data.page} of {data.totalPages}</Text><Button disabled={data.page >= data.totalPages} onClick={() => navigate(`/app/catalog-seo?type=${data.resourceType}&page=${data.page + 1}`)}>Next</Button></InlineStack></Box>}
      </Card>
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
function scoreTone(score: number): "success" | "warning" | "critical" { return score >= 80 ? "success" : score >= 60 ? "warning" : "critical"; }
