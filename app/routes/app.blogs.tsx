import { useCallback, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Box,
  Badge,
  IndexTable,
  Thumbnail,
  EmptyState,
  useIndexResourceState,
  Filters,
  ChoiceList,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Fetch blogs from Shopify
  const response = await admin.graphql(
    `#graphql
    query GetBlogs {
      blogs(first: 50) {
        nodes {
          id
          title
          handle
          articles(first: 100) {
            nodes {
              id
              title
              handle
              tags
              publishedAt
              image {
                url
                altText
              }
              blog {
                id
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

  // Get all articles with flat structure
  const articles = blogs.flatMap((blog: any) =>
    blog.articles.nodes.map((article: any) => ({
      id: article.id,
      title: article.title,
      handle: article.handle,
      tags: article.tags || [],
      publishedAt: article.publishedAt,
      image: article.image?.url || null,
      imageAlt: article.image?.altText || "",
      blogId: blog.id,
      blogTitle: blog.title,
    })),
  );

  // Get embed counts per article from database
  const embedCounts = await prisma.articleProduct.groupBy({
    by: ["articleId"],
    where: { shop, isActive: true },
    _count: { productId: true },
  });

  const embedCountMap = new Map(
    embedCounts.map((ec) => [ec.articleId, ec._count.productId]),
  );

  // Get SEO scores
  const seoScores = await prisma.articleSEO.findMany({
    where: { shop },
    select: { articleId: true, seoScore: true },
  });
  const seoScoreMap = new Map(
    seoScores.map((s) => [s.articleId, s.seoScore]),
  );

  const articlesWithMeta = articles.map((article: any) => ({
    ...article,
    embedCount: embedCountMap.get(article.id) || 0,
    seoScore: seoScoreMap.get(article.id) || null,
  }));

  return {
    blogs: blogs.map((b: any) => ({ id: b.id, title: b.title })),
    articles: articlesWithMeta,
  };
};

export default function BlogManager() {
  const { blogs, articles } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedBlog, setSelectedBlog] = useState<string[]>([]);

  const filteredArticles = articles.filter((article: any) => {
    const matchesSearch =
      searchQuery === "" ||
      article.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesBlog =
      selectedBlog.length === 0 || selectedBlog.includes(article.blogId);
    return matchesSearch && matchesBlog;
  });

  const resourceName = {
    singular: "article",
    plural: "articles",
  };

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(filteredArticles);

  const handleArticleClick = useCallback(
    (articleId: string, blogId: string) => {
      const encodedArticleId = encodeURIComponent(articleId);
      navigate(`/app/blogs/${encodedArticleId}`);
    },
    [navigate],
  );

  const blogFilterOptions = blogs.map((blog: any) => ({
    label: blog.title,
    value: blog.id,
  }));

  const filters = [
    {
      key: "blog",
      label: "Blog",
      filter: (
        <ChoiceList
          title="Blog"
          titleHidden
          choices={blogFilterOptions}
          selected={selectedBlog}
          onChange={setSelectedBlog}
          allowMultiple
        />
      ),
      shortcut: true,
    },
  ];

  const appliedFilters = selectedBlog.length > 0
    ? [
        {
          key: "blog",
          label: `Blog: ${selectedBlog
            .map((id) => blogs.find((b: any) => b.id === id)?.title)
            .join(", ")}`,
          onRemove: () => setSelectedBlog([]),
        },
      ]
    : [];

  const rowMarkup = filteredArticles.map((article: any, index: number) => {
    const seoTone =
      article.seoScore === null
        ? undefined
        : article.seoScore >= 80
          ? "success"
          : article.seoScore >= 50
            ? "warning"
            : "critical";

    return (
      <IndexTable.Row
        id={article.id}
        key={article.id}
        position={index}
        selected={selectedResources.includes(article.id)}
        onClick={() => handleArticleClick(article.id, article.blogId)}
      >
        <IndexTable.Cell>
          <InlineStack gap="300" blockAlign="center">
            <Thumbnail
              source={article.image || ImageIcon}
              alt={article.imageAlt || article.title}
              size="small"
            />
            <BlockStack gap="050">
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {article.title}
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                {article.blogTitle}
              </Text>
            </BlockStack>
          </InlineStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {article.embedCount > 0 ? (
            <Badge tone="info">{`${article.embedCount} products`}</Badge>
          ) : (
            <Badge tone="new">No products</Badge>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {article.seoScore !== null ? (
            <InlineStack gap="200" blockAlign="center">
              <Badge tone={seoTone as any}>{article.seoScore.toString()}</Badge>
            </InlineStack>
          ) : (
            <Text as="span" variant="bodySm" tone="subdued">
              —
            </Text>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {article.publishedAt ? (
            <Text as="span" variant="bodySm" tone="subdued">
              {new Date(article.publishedAt).toLocaleDateString("vi-VN")}
            </Text>
          ) : (
            <Badge>Draft</Badge>
          )}
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page>
      <TitleBar title="Blog Manager">
        <button variant="primary" onClick={() => navigate("/app/blogs")}>
          Refresh
        </button>
      </TitleBar>
      <BlockStack gap="500">
        {/* Summary Cards */}
        <InlineStack gap="400" wrap={false}>
          <Box minWidth="0" width="100%">
            <Card>
              <BlockStack gap="200">
                <Text as="span" variant="bodySm" tone="subdued">
                  Total Articles
                </Text>
                <Text as="p" variant="headingXl" fontWeight="bold">
                  {articles.length}
                </Text>
              </BlockStack>
            </Card>
          </Box>
          <Box minWidth="0" width="100%">
            <Card>
              <BlockStack gap="200">
                <Text as="span" variant="bodySm" tone="subdued">
                  With Products
                </Text>
                <Text as="p" variant="headingXl" fontWeight="bold">
                  {articles.filter((a: any) => a.embedCount > 0).length}
                </Text>
              </BlockStack>
            </Card>
          </Box>
          <Box minWidth="0" width="100%">
            <Card>
              <BlockStack gap="200">
                <Text as="span" variant="bodySm" tone="subdued">
                  Without Products
                </Text>
                <Text as="p" variant="headingXl" fontWeight="bold">
                  {articles.filter((a: any) => a.embedCount === 0).length}
                </Text>
              </BlockStack>
            </Card>
          </Box>
          <Box minWidth="0" width="100%">
            <Card>
              <BlockStack gap="200">
                <Text as="span" variant="bodySm" tone="subdued">
                  Blogs
                </Text>
                <Text as="p" variant="headingXl" fontWeight="bold">
                  {blogs.length}
                </Text>
              </BlockStack>
            </Card>
          </Box>
        </InlineStack>

        {/* Article List */}
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
                    setSelectedBlog([]);
                  }}
                />
              </Box>
              <IndexTable
                resourceName={resourceName}
                itemCount={filteredArticles.length}
                selectedItemsCount={
                  allResourcesSelected ? "All" : selectedResources.length
                }
                onSelectionChange={handleSelectionChange}
                headings={[
                  { title: "Article" },
                  { title: "Products" },
                  { title: "SEO Score" },
                  { title: "Published" },
                ]}
                selectable={false}
              >
                {rowMarkup}
              </IndexTable>
            </>
          ) : (
            <Box padding="800">
              <EmptyState
                heading="No blog articles found"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Create blog articles in your Shopify admin first, then come
                  back here to embed products.
                </p>
              </EmptyState>
            </Box>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
