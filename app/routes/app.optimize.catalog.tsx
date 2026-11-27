import type { LoaderFunctionArgs } from "react-router";
import { data as json , useLoaderData, useNavigate, useSearchParams } from "react-router";
import {
  Badge,
  Box,
  Banner,
  BlockStack,
  Button,
  EmptyState,
  IndexTable,
  InlineStack,
  Text,
  useIndexResourceState,
} from "@shopify/polaris";
import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import { CATALOG_WORKSPACE_TABS } from "../components/WorkspaceTabs";
import { CATALOG_BULK_ISSUES, CATALOG_BULK_ISSUE_TYPES, MAX_CATALOG_BULK, bulkProblems, type CatalogBulkFilter } from "../catalog-bulk";
import { AppPage } from "../components/AppPage";
import { Chips, Steps } from "../components/rm";

const MAX_ROWS = 250;
const EMPTY_IMAGE = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";
const FILTERS: CatalogBulkFilter[] = ["attention", "all", "seo_title", "meta_description", "image_alt"];

function issueFilter(types: Iterable<string>): Prisma.ResourceSEOWhereInput {
  return { OR: [...types].map((type) => ({ issues: { contains: `"type":"${type}"` } })) };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const { limits, planKey } = await getActivePlanAndLimits(billing, session.shop);
  const url = new URL(request.url);
  const type = url.searchParams.get("type") === "collection" ? "collection" : "product";
  const filterParam = url.searchParams.get("filter") as CatalogBulkFilter;
  const filter: CatalogBulkFilter = FILTERS.includes(filterParam) ? filterParam : "attention";
  const base: Prisma.ResourceSEOWhereInput = { shop: session.shop, resourceType: type };
  const where: Prisma.ResourceSEOWhereInput = filter === "all"
    ? base
    : { ...base, ...issueFilter(filter === "attention" ? CATALOG_BULK_ISSUE_TYPES : CATALOG_BULK_ISSUES[filter].types) };

  const [rows, matching, total, attention] = await Promise.all([
    prisma.resourceSEO.findMany({
      where,
      select: { resourceId: true, title: true, metaTitle: true, metaDescription: true, imageUrl: true, imageAlt: true, issues: true, seoScore: true },
      orderBy: [{ issueCount: "desc" }, { title: "asc" }],
      take: MAX_ROWS,
    }),
    prisma.resourceSEO.count({ where }),
    prisma.resourceSEO.count({ where: base }),
    prisma.resourceSEO.count({ where: { ...base, ...issueFilter(CATALOG_BULK_ISSUE_TYPES) } }),
  ]);

  return json({
    canBulk: limits.canBulkReview && limits.canCatalogSeo,
    planKey,
    type,
    filter,
    total,
    attention,
    matching,
    rows: rows.map((row) => ({
      id: row.resourceId,
      title: row.title || "Untitled",
      seoTitle: row.metaTitle || row.title,
      metaDescription: row.metaDescription,
      hasImage: Boolean(row.imageUrl),
      imageAlt: row.imageAlt,
      score: row.seoScore,
      problems: bulkProblems(issueTypes(row.issues)),
    })),
  });
};

function issueTypes(value: string | null) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map((issue) => String(issue?.type || "")) : [];
  } catch {
    return [];
  }
}

export default function CatalogBulkPicker() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const rows = data.rows;
  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } = useIndexResourceState(rows);
  const selectedIds = allResourcesSelected ? rows.map((row) => row.id) : selectedResources;
  const tooMany = selectedIds.length > MAX_CATALOG_BULK;
  const noun = data.type === "collection" ? "collection" : "product";

  const update = (key: "type" | "filter", value: string) => {
    clearSelection();
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      next.set(key, value);
      if (key === "type") next.delete("filter");
      return next;
    });
  };

  const filterOptions = [
    { label: `Needs attention (${data.attention})`, value: "attention" },
    { label: `All scanned ${noun}s (${data.total})`, value: "all" },
    ...(Object.keys(CATALOG_BULK_ISSUES) as Array<keyof typeof CATALOG_BULK_ISSUES>).map((key) => ({ label: `${CATALOG_BULK_ISSUES[key].label} problems`, value: key })),
  ];

  return (
    <AppPage
      title="Bulk optimize"
      subtitle="Fix search listings for many products or collections at once: select → generate with AI → review → apply. Every change can be undone from Change history."
      fullWidth
      tabs={{ items: CATALOG_WORKSPACE_TABS, activeId: "bulk" }}
    >
        <Steps active={0} steps={[{ title: "Select", text: "Pick up to 50 products or collections" }, { title: "Generate & review", text: "AI drafts, you edit" }, { title: "Apply", text: "Saved to Shopify, undo anytime" }]} />

        {!data.canBulk && (
          <Banner tone="info" title="Bulk catalog editing is a Growth feature" action={{ content: "See plans", url: `/app/pricing?reason=bulk_edit&plan=${data.planKey}` }}>
            <p>You can still see which {noun}s need attention here and fix them one at a time in the product or collection editor.</p>
          </Banner>
        )}

        {!data.total ? (
          <s-section>
            <EmptyState heading="Run an SEO scan first" action={{ content: "Open SEO Analyzer", url: "/app/seo" }} image={EMPTY_IMAGE}>
              <p>Product and collection suggestions are built from your latest catalog scan.</p>
            </EmptyState>
          </s-section>
        ) : (
          <s-section padding="none">
            <Box padding="400">
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                  <Chips label="Resource type" active={data.type} items={[{ id: "product", label: "Products", onClick: () => update("type", "product") }, { id: "collection", label: "Collections", onClick: () => update("type", "collection") }]} />
                  <Button
                    variant="primary"
                    disabled={!selectedIds.length || tooMany || !data.canBulk}
                    onClick={() => navigate(`/app/optimize/catalog/review?ids=${encodeURIComponent(selectedIds.join(","))}`)}
                  >
                    {selectedIds.length ? `Review ${selectedIds.length} selected` : `Select ${noun}s to review`}
                  </Button>
                </InlineStack>
                <InlineStack gap="200" blockAlign="center" wrap>
                  <Text as="span" variant="bodySm" tone="subdued">Show {noun}s with:</Text>
                  <Chips label="Problem filter" active={data.filter} items={filterOptions.map((option) => ({ id: option.value, label: option.label, onClick: () => update("filter", option.value) }))} />
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Select up to {MAX_CATALOG_BULK} {noun}s.{data.matching > rows.length ? ` Showing the ${rows.length} with the most problems of ${data.matching}.` : ""}
                </Text>
                {tooMany && <Banner tone="warning"><p>Select at most {MAX_CATALOG_BULK} {noun}s per batch.</p></Banner>}
              </BlockStack>
            </Box>
            <IndexTable
              key={`${data.type}:${data.filter}`}
              resourceName={{ singular: noun, plural: `${noun}s` }}
              itemCount={rows.length}
              selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
              onSelectionChange={handleSelectionChange}
              headings={[{ title: noun === "product" ? "Product" : "Collection" }, { title: "SEO title" }, { title: "Meta description" }, { title: "Image alt" }, { title: "Problems" }, { title: "" }]}
              emptyState={<div style={{ padding: 24 }}><Text as="p" tone="subdued" alignment="center">No {noun}s match this filter.</Text></div>}
            >
              {rows.map((row, index) => (
                <IndexTable.Row id={row.id} key={row.id} position={index} selected={selectedResources.includes(row.id)}>
                  <IndexTable.Cell><Text as="span" fontWeight="semibold">{truncate(row.title, 60)}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" variant="bodySm">{truncate(row.seoTitle, 60) || "—"}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" variant="bodySm" tone={row.metaDescription ? undefined : "subdued"}>{truncate(row.metaDescription, 70) || "Missing"}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" variant="bodySm" tone={row.imageAlt ? undefined : "subdued"}>{row.hasImage ? truncate(row.imageAlt, 40) || "Missing" : "No image"}</Text></IndexTable.Cell>
                  <IndexTable.Cell>
                    {row.problems.length ? (
                      <InlineStack gap="100" wrap>{row.problems.map((problem) => <Badge key={problem} tone="warning">{CATALOG_BULK_ISSUES[problem].label}</Badge>)}</InlineStack>
                    ) : <Badge tone="success">Good</Badge>}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Button size="micro" variant="plain" onClick={() => navigate(`/app/catalog-seo/${data.type}/${encodeURIComponent(row.id.split("/").pop() || row.id)}`)}>Open editor</Button>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </s-section>
        )}
    </AppPage>
  );
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
