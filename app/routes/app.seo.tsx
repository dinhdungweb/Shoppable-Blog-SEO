import { useCallback, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Box,
  Badge,
  IndexTable,
  EmptyState,
  ProgressBar,
  InlineGrid,
  Icon,
  Banner,
  Filters,
  ChoiceList,
  Tooltip,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Fetch all articles from Shopify
  const response = await admin.graphql(
    `#graphql
    query GetAllArticles {
      blogs(first: 50) {
        nodes {
          id
          title
          articles(first: 100) {
            nodes {
              id
              title
              handle
              publishedAt
              seo {
                title
                description
              }
              image {
                url
              }
              blog {
                title
              }
            }
          }
        }
      }
    }`,
  );

  const responseJson = await response.json();
  const blogs = responseJson.data?.blogs?.nodes || [];

  const articles = blogs.flatMap((blog: any) =>
    blog.articles.nodes.map((article: any) => ({
      id: article.id,
      title: article.title,
      handle: article.handle,
      publishedAt: article.publishedAt,
      seoTitle: article.seo?.title || "",
      seoDescription: article.seo?.description || "",
      hasImage: !!article.image?.url,
      blogTitle: blog.title,
    })),
  );

  // Fetch SEO data from database
  const seoDataList = await prisma.articleSEO.findMany({
    where: { shop },
  });

  const seoMap = new Map(seoDataList.map((s) => [s.articleId, s]));

  // Get embed counts
  const embedCounts = await prisma.articleProduct.groupBy({
    by: ["articleId"],
    where: { shop, isActive: true },
    _count: { productId: true },
  });
  const embedMap = new Map(
    embedCounts.map((ec) => [ec.articleId, ec._count.productId]),
  );

  const articlesWithSEO = articles.map((article: any) => {
    const seo = seoMap.get(article.id);
    return {
      ...article,
      seoScore: seo?.seoScore ?? null,
      issues: seo?.issues ? JSON.parse(seo.issues as string) : [],
      lastAnalyzedAt: seo?.lastAnalyzedAt?.toISOString() ?? null,
      embedCount: embedMap.get(article.id) || 0,
    };
  });

  // Calculate overview stats
  const analyzedArticles = articlesWithSEO.filter(
    (a: any) => a.seoScore !== null,
  );
  const avgScore =
    analyzedArticles.length > 0
      ? Math.round(
          analyzedArticles.reduce(
            (sum: number, a: any) => sum + a.seoScore,
            0,
          ) / analyzedArticles.length,
        )
      : 0;

  const excellent = analyzedArticles.filter(
    (a: any) => a.seoScore >= 80,
  ).length;
  const needsWork = analyzedArticles.filter(
    (a: any) => a.seoScore >= 50 && a.seoScore < 80,
  ).length;
  const poor = analyzedArticles.filter((a: any) => a.seoScore < 50).length;

  return {
    articles: articlesWithSEO,
    stats: {
      total: articles.length,
      analyzed: analyzedArticles.length,
      avgScore,
      excellent,
      needsWork,
      poor,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "bulk_analyze") {
    const articleIdsJson = formData.get("articleIds") as string;
    const articlesJson = formData.get("articles") as string;
    const articleIds = JSON.parse(articleIdsJson || "[]");
    const articlesData = JSON.parse(articlesJson || "[]");

    let results = [];

    for (const articleData of articlesData) {
      if (!articleIds.includes(articleData.id)) continue;

      const issues: { type: string; message: string; severity: string }[] = [];
      let score = 100;

      if (!articleData.seoTitle || articleData.seoTitle.length === 0) {
        issues.push({
          type: "meta_title",
          message: "Meta title is missing",
          severity: "error",
        });
        score -= 20;
      } else if (articleData.seoTitle.length < 30) {
        issues.push({
          type: "meta_title",
          message: "Meta title too short",
          severity: "warning",
        });
        score -= 10;
      }

      if (
        !articleData.seoDescription ||
        articleData.seoDescription.length === 0
      ) {
        issues.push({
          type: "meta_description",
          message: "Meta description is missing",
          severity: "error",
        });
        score -= 20;
      } else if (articleData.seoDescription.length < 120) {
        issues.push({
          type: "meta_description",
          message: "Meta description too short",
          severity: "warning",
        });
        score -= 10;
      }

      if (!articleData.hasImage) {
        issues.push({
          type: "image",
          message: "No featured image",
          severity: "warning",
        });
        score -= 10;
      }

      if (articleData.embedCount === 0) {
        issues.push({
          type: "products",
          message: "No embedded products",
          severity: "info",
        });
        score -= 5;
      }

      score = Math.max(0, Math.min(100, score));

      await prisma.articleSEO.upsert({
        where: { articleId: articleData.id },
        update: {
          seoScore: score,
          articleTitle: articleData.title,
          metaTitle: articleData.seoTitle,
          metaDescription: articleData.seoDescription,
          issues: JSON.stringify(issues),
          lastAnalyzedAt: new Date(),
        },
        create: {
          shop,
          articleId: articleData.id,
          articleTitle: articleData.title,
          seoScore: score,
          metaTitle: articleData.seoTitle,
          metaDescription: articleData.seoDescription,
          issues: JSON.stringify(issues),
          lastAnalyzedAt: new Date(),
        },
      });

      results.push({ id: articleData.id, score, issues });
    }

    return json({ success: true, results });
  }

  return json({ success: false });
};

export default function SEOOptimizer() {
  const { articles, stats } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [scoreFilter, setScoreFilter] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const isSubmitting = fetcher.state !== "idle";

  const filteredArticles = articles.filter((article: any) => {
    const matchesSearch =
      searchQuery === "" ||
      article.title.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesScore =
      scoreFilter.length === 0 ||
      scoreFilter.some((filter) => {
        if (filter === "excellent") return article.seoScore >= 80;
        if (filter === "needs_work")
          return article.seoScore >= 50 && article.seoScore < 80;
        if (filter === "poor")
          return article.seoScore !== null && article.seoScore < 50;
        if (filter === "not_analyzed") return article.seoScore === null;
        return true;
      });

    return matchesSearch && matchesScore;
  });

  const handleBulkAnalyze = useCallback(() => {
    const targetArticles = filteredArticles.map((a: any) => ({
      id: a.id,
      title: a.title,
      seoTitle: a.seoTitle,
      seoDescription: a.seoDescription,
      hasImage: a.hasImage,
      embedCount: a.embedCount,
    }));

    fetcher.submit(
      {
        intent: "bulk_analyze",
        articleIds: JSON.stringify(filteredArticles.map((a: any) => a.id)),
        articles: JSON.stringify(targetArticles),
      },
      { method: "POST" },
    );
  }, [fetcher, filteredArticles]);

  const filters = [
    {
      key: "score",
      label: "SEO Score",
      filter: (
        <ChoiceList
          title="SEO Score"
          titleHidden
          choices={[
            { label: "🟢 Excellent (80-100)", value: "excellent" },
            { label: "🟡 Needs Work (50-79)", value: "needs_work" },
            { label: "🔴 Poor (0-49)", value: "poor" },
            { label: "⚪ Not Analyzed", value: "not_analyzed" },
          ]}
          selected={scoreFilter}
          onChange={setScoreFilter}
          allowMultiple
        />
      ),
      shortcut: true,
    },
  ];

  const appliedFilters =
    scoreFilter.length > 0
      ? [
          {
            key: "score",
            label: `Score: ${scoreFilter.join(", ")}`,
            onRemove: () => setScoreFilter([]),
          },
        ]
      : [];

  const rowMarkup = filteredArticles.map((article: any, index: number) => {
    const scoreTone =
      article.seoScore === null
        ? undefined
        : article.seoScore >= 80
          ? "success"
          : article.seoScore >= 50
            ? "warning"
            : "critical";

    const errorCount = article.issues.filter(
      (i: any) => i.severity === "error",
    ).length;
    const warningCount = article.issues.filter(
      (i: any) => i.severity === "warning",
    ).length;

    return (
      <IndexTable.Row
        id={article.id}
        key={article.id}
        position={index}
      >
        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {article.title}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {article.blogTitle}
            </Text>
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {article.seoScore !== null ? (
            <InlineStack gap="200" blockAlign="center">
              <Box minWidth="45px">
                <Badge tone={scoreTone as any}>
                  {article.seoScore.toString()}
                </Badge>
              </Box>
              <Box width="100%">
                <ProgressBar
                  progress={article.seoScore}
                  size="small"
                  tone={
                    article.seoScore >= 80
                      ? "success"
                      : article.seoScore >= 50
                        ? "primary"
                        : "critical"
                  }
                />
              </Box>
            </InlineStack>
          ) : (
            <Text as="span" variant="bodySm" tone="subdued">
              Not analyzed
            </Text>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <InlineStack gap="200">
            {errorCount > 0 && (
              <Tooltip content={`${errorCount} errors`}>
                <Badge tone="critical">{`${errorCount} errors`}</Badge>
              </Tooltip>
            )}
            {warningCount > 0 && (
              <Tooltip content={`${warningCount} warnings`}>
                <Badge tone="warning">{`${warningCount} warnings`}</Badge>
              </Tooltip>
            )}
            {errorCount === 0 && warningCount === 0 && article.seoScore !== null && (
              <Badge tone="success">All good</Badge>
            )}
          </InlineStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={article.embedCount > 0 ? "info" : undefined}>
            {`${article.embedCount} products`}
          </Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {article.lastAnalyzedAt ? (
            <Text as="span" variant="bodySm" tone="subdued">
              {new Date(article.lastAnalyzedAt).toLocaleDateString("vi-VN")}
            </Text>
          ) : (
            <Text as="span" variant="bodySm" tone="subdued">
              —
            </Text>
          )}
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page>
      <TitleBar title="SEO Optimizer">
        <button
          variant="primary"
          onClick={handleBulkAnalyze}
          disabled={isSubmitting}
        >
          {isSubmitting ? "Analyzing..." : "Analyze All Articles"}
        </button>
      </TitleBar>
      <BlockStack gap="500">
        {/* Results Banner */}
        {fetcher.data?.success && (
          <Banner
            title={`SEO analysis complete — ${(fetcher.data as any).results?.length || 0} articles analyzed`}
            tone="success"
            onDismiss={() => {}}
          />
        )}

        {/* Overview Stats */}
        <InlineGrid columns={{ xs: 2, sm: 3, md: 6 }} gap="400">
          <Card>
            <BlockStack gap="100">
              <Text as="span" variant="bodySm" tone="subdued">
                Total Articles
              </Text>
              <Text as="p" variant="headingLg" fontWeight="bold">
                {stats.total}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="span" variant="bodySm" tone="subdued">
                Analyzed
              </Text>
              <Text as="p" variant="headingLg" fontWeight="bold">
                {stats.analyzed}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="span" variant="bodySm" tone="subdued">
                Avg Score
              </Text>
              <Text
                as="p"
                variant="headingLg"
                fontWeight="bold"
                tone={
                  stats.avgScore >= 80
                    ? "success"
                    : stats.avgScore >= 50
                      ? "caution"
                      : stats.avgScore > 0
                        ? "critical"
                        : undefined
                }
              >
                {stats.avgScore > 0 ? stats.avgScore : "—"}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="span" variant="bodySm" tone="subdued">
                🟢 Excellent
              </Text>
              <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                {stats.excellent}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="span" variant="bodySm" tone="subdued">
                🟡 Needs Work
              </Text>
              <Text as="p" variant="headingLg" fontWeight="bold" tone="caution">
                {stats.needsWork}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="span" variant="bodySm" tone="subdued">
                🔴 Poor
              </Text>
              <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                {stats.poor}
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Score Distribution */}
        <Layout>
          <Layout.Section>
            <Card padding="0">
              {articles.length > 0 ? (
                <>
                  <Box padding="400" paddingBlockEnd="0">
                    <Filters
                      queryValue={searchQuery}
                      queryPlaceholder="Search articles..."
                      onQueryChange={setSearchQuery}
                      onQueryClear={() => setSearchQuery("")}
                      filters={filters}
                      appliedFilters={appliedFilters}
                      onClearAll={() => {
                        setSearchQuery("");
                        setScoreFilter([]);
                      }}
                    />
                  </Box>
                  <IndexTable
                    resourceName={{
                      singular: "article",
                      plural: "articles",
                    }}
                    itemCount={filteredArticles.length}
                    headings={[
                      { title: "Article" },
                      { title: "SEO Score" },
                      { title: "Issues" },
                      { title: "Products" },
                      { title: "Last Analyzed" },
                    ]}
                    selectable={false}
                  >
                    {rowMarkup}
                  </IndexTable>
                </>
              ) : (
                <Box padding="800">
                  <EmptyState
                    heading="No articles to analyze"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>
                      Create blog articles in your Shopify admin first.
                    </p>
                  </EmptyState>
                </Box>
              )}
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              {/* SEO Tips */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    SEO Best Practices
                  </Text>
                  <BlockStack gap="200">
                    <SEOTip
                      title="Meta Title"
                      description="30-60 characters with primary keyword"
                    />
                    <SEOTip
                      title="Meta Description"
                      description="120-160 characters with CTA"
                    />
                    <SEOTip
                      title="Featured Image"
                      description="Include alt text for accessibility"
                    />
                    <SEOTip
                      title="Product Schema"
                      description="JSON-LD auto-generated by widget"
                    />
                    <SEOTip
                      title="Internal Links"
                      description="Link to products for better SEO"
                    />
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* Schema Info */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    JSON-LD Schema
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    When you embed products in a blog article, our Theme
                    Extension automatically injects structured data (JSON-LD)
                    for both the BlogPosting and Product schemas.
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    This helps search engines understand your content and
                    display rich snippets with product prices and ratings.
                  </Text>
                  <Banner tone="info">
                    <p>
                      Make sure the "SEO Schema" block is enabled in your
                      Theme Editor under Blog Post template.
                    </p>
                  </Banner>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

function SEOTip({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <InlineStack gap="200" blockAlign="start">
      <Box>
        <Icon source={CheckCircleIcon} tone="success" />
      </Box>
      <BlockStack gap="050">
        <Text as="span" variant="bodySm" fontWeight="semibold">
          {title}
        </Text>
        <Text as="span" variant="bodySm" tone="subdued">
          {description}
        </Text>
      </BlockStack>
    </InlineStack>
  );
}
