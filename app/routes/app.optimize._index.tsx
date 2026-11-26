import { useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  EmptyState,
  IndexTable,
  InlineStack,
  Select,
  Text,
  useIndexResourceState,
} from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import { SEO_WORKSPACE_TABS } from "../components/WorkspaceTabs";
import { META_TAG_PROBLEM_LABELS, auditMetaTags, type MetaTagProblem } from "../meta-tag-audit";
import { AppPage } from "../components/AppPage";

const MAX_BULK_SELECTION = 50;
const MAX_ROWS = 250;
const EMPTY_IMAGE = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const { limits, planKey } = await getActivePlanAndLimits(billing, session.shop);
  const rows = await prisma.articleSEO.findMany({
    where: { shop: session.shop },
    select: {
      articleId: true,
      articleTitle: true,
      blogTitle: true,
      metaTitle: true,
      metaDescription: true,
      imageUrl: true,
      imageAlt: true,
      lastAnalyzedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const articles = rows
    .map((row) => ({
      id: row.articleId,
      title: row.articleTitle || "Untitled article",
      blogTitle: row.blogTitle,
      seoTitle: row.metaTitle || row.articleTitle,
      metaDescription: row.metaDescription || "",
      problems: auditMetaTags(row),
    }))
    .sort((a, b) => b.problems.length - a.problems.length);

  return json({
    canBulkReview: limits.canBulkReview,
    planKey,
    scanned: rows.some((row) => row.lastAnalyzedAt),
    totalArticles: articles.length,
    needsAttention: articles.filter((article) => article.problems.length).length,
    articles: articles.slice(0, MAX_ROWS),
  });
};

type Filter = "attention" | "all" | MetaTagProblem;

export default function MetaTagsOptimizer() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("attention");

  const visible = useMemo(() => data.articles.filter((article) => {
    if (filter === "all") return true;
    if (filter === "attention") return article.problems.length > 0;
    return article.problems.includes(filter);
  }), [data.articles, filter]);

  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } = useIndexResourceState(visible);
  const selectedIds = allResourcesSelected ? visible.map((article) => article.id) : selectedResources;
  const tooMany = selectedIds.length > MAX_BULK_SELECTION;

  const openReview = () => {
    navigate(`/app/blogs/bulk_edit?ids=${encodeURIComponent(selectedIds.join(","))}`);
  };

  const filterOptions = [
    { label: `Needs attention (${data.needsAttention})`, value: "attention" },
    { label: `All scanned posts (${data.totalArticles})`, value: "all" },
    ...(Object.keys(META_TAG_PROBLEM_LABELS) as MetaTagProblem[]).map((problem) => ({
      label: META_TAG_PROBLEM_LABELS[problem],
      value: problem,
    })),
  ];

  return (
    <AppPage
      title="Meta tags"
      subtitle="Fix SEO titles, meta descriptions and featured image alt text for many posts at once: select → generate with AI → review → apply. Every change can be undone from Change history."
      fullWidth
      tabs={{ items: SEO_WORKSPACE_TABS, activeId: "meta" }}
    >

        {!data.canBulkReview && (
          <Banner
            tone="info"
            title="Bulk meta tag editing is a Growth feature"
            action={{ content: "See plans", url: `/app/pricing?reason=bulk_edit&plan=${data.planKey}` }}
          >
            <p>You can still review which posts need attention here and fix them one at a time in the post editor.</p>
          </Banner>
        )}

        {!data.totalArticles ? (
          <Card>
            <EmptyState
              heading="Run an SEO scan first"
              action={{ content: "Open SEO Analyzer", url: "/app/seo" }}
              image={EMPTY_IMAGE}
            >
              <p>Meta tag suggestions are built from your latest SEO scan of blog posts.</p>
            </EmptyState>
          </Card>
        ) : (
          <Card padding="0">
            <BlockStack gap="0">
              <div style={{ padding: "16px" }}>
                <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                  <BlockStack gap="050">
                    <Text as="h2" variant="headingMd">Meta tags</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      SEO title, meta description and featured image alt text. Select up to {MAX_BULK_SELECTION} posts.
                    </Text>
                  </BlockStack>
                  <InlineStack gap="200" blockAlign="center">
                    <div style={{ minWidth: 240 }}>
                      <Select
                        label="Filter"
                        labelHidden
                        options={filterOptions}
                        value={filter}
                        onChange={(value) => { clearSelection(); setFilter(value as Filter); }}
                      />
                    </div>
                    <Button
                      variant="primary"
                      disabled={!selectedIds.length || tooMany || !data.canBulkReview}
                      onClick={openReview}
                    >
                      {selectedIds.length ? `Review ${selectedIds.length} selected` : "Select posts to review"}
                    </Button>
                  </InlineStack>
                </InlineStack>
                {tooMany && (
                  <div style={{ marginTop: 12 }}>
                    <Banner tone="warning"><p>Select at most {MAX_BULK_SELECTION} posts per batch.</p></Banner>
                  </div>
                )}
              </div>
              <IndexTable
                resourceName={{ singular: "post", plural: "posts" }}
                itemCount={visible.length}
                selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
                onSelectionChange={handleSelectionChange}
                headings={[{ title: "Post" }, { title: "SEO title" }, { title: "Meta description" }, { title: "Problems" }, { title: "" }]}
                emptyState={<div style={{ padding: 24 }}><Text as="p" tone="subdued" alignment="center">No posts match this filter.</Text></div>}
              >
                {visible.map((article, index) => (
                  <IndexTable.Row id={article.id} key={article.id} position={index} selected={selectedResources.includes(article.id)}>
                    <IndexTable.Cell>
                      <BlockStack gap="050">
                        <Text as="span" fontWeight="semibold">{truncate(article.title, 60)}</Text>
                        {article.blogTitle && <Text as="span" variant="bodySm" tone="subdued">{article.blogTitle}</Text>}
                      </BlockStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell><Text as="span" variant="bodySm">{truncate(article.seoTitle, 60) || "—"}</Text></IndexTable.Cell>
                    <IndexTable.Cell><Text as="span" variant="bodySm" tone={article.metaDescription ? undefined : "subdued"}>{truncate(article.metaDescription, 80) || "Not set"}</Text></IndexTable.Cell>
                    <IndexTable.Cell>
                      {article.problems.length ? (
                        <InlineStack gap="100" wrap>
                          {article.problems.map((problem) => <Badge key={problem} tone="warning">{META_TAG_PROBLEM_LABELS[problem]}</Badge>)}
                        </InlineStack>
                      ) : <Badge tone="success">Good</Badge>}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Button size="micro" variant="plain" onClick={() => navigate(`/app/blogs/${encodeURIComponent(article.id.split("/").pop() || article.id)}`)}>
                        Open editor
                      </Button>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            </BlockStack>
          </Card>
        )}
    </AppPage>
  );
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
