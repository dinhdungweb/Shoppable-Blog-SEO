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
  Button,
  Divider,
  Thumbnail,
  Modal,
  Select,
  EmptyState,
  ProgressBar,
  InlineGrid,
  Icon,
  ButtonGroup,
} from "@shopify/polaris";
import {
  DeleteIcon,
  EditIcon,
  ImageIcon,
  ProductIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  CheckIcon,
  AlertCircleIcon,
  ExternalIcon,
} from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const articleId = decodeURIComponent(params.blogId || "");

  // Fetch article details from Shopify
  const articleResponse = await admin.graphql(
    `#graphql
    query GetArticle($id: ID!) {
      article(id: $id) {
        id
        title
        handle
        tags
        body
        summary: summaryHtml
        publishedAt
        seo {
          title
          description
        }
        image {
          url
          altText
        }
        blog {
          id
          title
          handle
        }
      }
    }`,
    { variables: { id: articleId } },
  );

  const articleJson = await articleResponse.json();
  const article = articleJson.data?.article;

  if (!article) {
    throw new Response("Article not found", { status: 404 });
  }

  // Fetch embedded products from database
  const embeddedProducts = await prisma.articleProduct.findMany({
    where: { shop, articleId },
    orderBy: { position: "asc" },
  });

  // Fetch SEO data
  const seoData = await prisma.articleSEO.findFirst({
    where: { shop, articleId },
  });

  // Fetch widget events for this article
  const [clicks, impressions] = await Promise.all([
    prisma.widgetEvent.count({
      where: { shop, articleId, eventType: "click" },
    }),
    prisma.widgetEvent.count({
      where: { shop, articleId, eventType: "impression" },
    }),
  ]);

  return {
    article,
    embeddedProducts,
    seoData,
    stats: { clicks, impressions },
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const articleId = decodeURIComponent(params.blogId || "");
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "add_products") {
    const productsJson = formData.get("products") as string;
    const products = JSON.parse(productsJson || "[]");
    const articleTitle = formData.get("articleTitle") as string;
    const articleHandle = formData.get("articleHandle") as string;
    const blogId = formData.get("blogId") as string;

    // Get current max position
    const maxPos = await prisma.articleProduct.findFirst({
      where: { shop, articleId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    let nextPosition = (maxPos?.position || 0) + 1;

    for (const product of products) {
      await prisma.articleProduct.upsert({
        where: {
          articleId_productId: {
            articleId,
            productId: product.id,
          },
        },
        update: {
          isActive: true,
          productTitle: product.title,
          productImage: product.images?.[0]?.originalSrc || "",
          productPrice: product.variants?.[0]?.price || "0",
        },
        create: {
          shop,
          articleId,
          articleTitle,
          articleHandle,
          blogId,
          productId: product.id,
          productTitle: product.title,
          productHandle: product.handle,
          productImage: product.images?.[0]?.originalSrc || "",
          productPrice: product.variants?.[0]?.price || "0",
          position: nextPosition++,
          displayStyle: "card",
        },
      });
    }

    return json({ success: true, action: "added" });
  }

  if (intent === "remove_product") {
    const productId = formData.get("productId") as string;
    await prisma.articleProduct.deleteMany({
      where: { shop, articleId, productId },
    });
    return json({ success: true, action: "removed" });
  }

  if (intent === "update_style") {
    const productId = formData.get("productId") as string;
    const displayStyle = formData.get("displayStyle") as string;
    await prisma.articleProduct.updateMany({
      where: { shop, articleId, productId },
      data: { displayStyle },
    });
    return json({ success: true, action: "style_updated" });
  }

  if (intent === "reorder") {
    const orderJson = formData.get("order") as string;
    const order = JSON.parse(orderJson || "[]") as string[];

    for (let i = 0; i < order.length; i++) {
      await prisma.articleProduct.updateMany({
        where: { shop, articleId, productId: order[i] },
        data: { position: i },
      });
    }
    return json({ success: true, action: "reordered" });
  }

  if (intent === "analyze_seo") {
    // SEO Analysis logic
    const articleTitle = formData.get("articleTitle") as string;
    const seoTitle = formData.get("seoTitle") as string;
    const seoDescription = formData.get("seoDescription") as string;
    const body = formData.get("body") as string;
    const hasImage = formData.get("hasImage") === "true";

    const issues: { type: string; message: string; severity: string }[] = [];
    let score = 100;

    // Check meta title
    if (!seoTitle || seoTitle.length === 0) {
      issues.push({
        type: "meta_title",
        message: "Meta title is missing",
        severity: "error",
      });
      score -= 20;
    } else if (seoTitle.length < 30) {
      issues.push({
        type: "meta_title",
        message: "Meta title is too short (< 30 chars)",
        severity: "warning",
      });
      score -= 10;
    } else if (seoTitle.length > 60) {
      issues.push({
        type: "meta_title",
        message: "Meta title is too long (> 60 chars)",
        severity: "warning",
      });
      score -= 5;
    }

    // Check meta description
    if (!seoDescription || seoDescription.length === 0) {
      issues.push({
        type: "meta_description",
        message: "Meta description is missing",
        severity: "error",
      });
      score -= 20;
    } else if (seoDescription.length < 120) {
      issues.push({
        type: "meta_description",
        message: "Meta description is too short (< 120 chars)",
        severity: "warning",
      });
      score -= 10;
    } else if (seoDescription.length > 160) {
      issues.push({
        type: "meta_description",
        message: "Meta description is too long (> 160 chars)",
        severity: "warning",
      });
      score -= 5;
    }

    // Check featured image
    if (!hasImage) {
      issues.push({
        type: "image",
        message: "Article has no featured image",
        severity: "warning",
      });
      score -= 10;
    }

    // Check body content length
    if (!body || body.length < 300) {
      issues.push({
        type: "content",
        message: "Content is too short (< 300 chars)",
        severity: "error",
      });
      score -= 15;
    }

    // Check if products are embedded
    const embedCount = await prisma.articleProduct.count({
      where: { shop, articleId, isActive: true },
    });

    if (embedCount === 0) {
      issues.push({
        type: "products",
        message: "No products embedded — add products for better engagement",
        severity: "info",
      });
      score -= 5;
    }

    score = Math.max(0, Math.min(100, score));

    // Save SEO data
    await prisma.articleSEO.upsert({
      where: { articleId },
      update: {
        seoScore: score,
        metaTitle: seoTitle,
        metaDescription: seoDescription,
        articleTitle,
        issues: JSON.stringify(issues),
        lastAnalyzedAt: new Date(),
      },
      create: {
        shop,
        articleId,
        articleTitle,
        seoScore: score,
        metaTitle: seoTitle,
        metaDescription: seoDescription,
        issues: JSON.stringify(issues),
        lastAnalyzedAt: new Date(),
      },
    });

    return json({ success: true, action: "seo_analyzed", score, issues });
  }

  return json({ success: false });
};

export default function ArticleDetail() {
  const { article, embeddedProducts, seoData, stats } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [showStyleModal, setShowStyleModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState("card");

  const isSubmitting = fetcher.state !== "idle";

  const handleAddProducts = useCallback(async () => {
    try {
      const selected = await shopify.resourcePicker({
        type: "product",
        multiple: true,
        action: "select",
      });

      if (selected && selected.length > 0) {
        const products = selected.map((product: any) => ({
          id: product.id,
          title: product.title,
          handle: product.handle,
          images: product.images,
          variants: product.variants,
        }));

        fetcher.submit(
          {
            intent: "add_products",
            products: JSON.stringify(products),
            articleTitle: article.title,
            articleHandle: article.handle,
            blogId: article.blog.id,
          },
          { method: "POST" },
        );
      }
    } catch (error) {
      console.error("Resource picker error:", error);
    }
  }, [shopify, fetcher, article]);

  const handleRemoveProduct = useCallback(
    (productId: string) => {
      fetcher.submit(
        { intent: "remove_product", productId },
        { method: "POST" },
      );
    },
    [fetcher],
  );

  const handleMoveProduct = useCallback(
    (currentIndex: number, direction: "up" | "down") => {
      const newOrder = [...embeddedProducts.map((p) => p.productId)];
      const swapIndex =
        direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (swapIndex < 0 || swapIndex >= newOrder.length) return;
      [newOrder[currentIndex], newOrder[swapIndex]] = [
        newOrder[swapIndex],
        newOrder[currentIndex],
      ];
      fetcher.submit(
        { intent: "reorder", order: JSON.stringify(newOrder) },
        { method: "POST" },
      );
    },
    [embeddedProducts, fetcher],
  );

  const handleStyleChange = useCallback(
    (productId: string, style: string) => {
      fetcher.submit(
        { intent: "update_style", productId, displayStyle: style },
        { method: "POST" },
      );
      setShowStyleModal(false);
    },
    [fetcher],
  );

  const handleAnalyzeSEO = useCallback(() => {
    fetcher.submit(
      {
        intent: "analyze_seo",
        articleTitle: article.title,
        seoTitle: article.seo?.title || "",
        seoDescription: article.seo?.description || "",
        body: article.body || "",
        hasImage: article.image ? "true" : "false",
      },
      { method: "POST" },
    );
  }, [fetcher, article]);

  const seoScore = (fetcher.data as any)?.score ?? seoData?.seoScore ?? null;
  const seoIssues =
    (fetcher.data as any)?.issues ??
    (seoData?.issues ? JSON.parse(seoData.issues as string) : []);

  return (
    <Page
      backAction={{ content: "Blog Manager", url: "/app/blogs" }}
      title={article.title}
      subtitle={`${article.blog.title} • ${
        article.publishedAt
          ? new Date(article.publishedAt).toLocaleDateString("vi-VN")
          : "Draft"
      }`}
      primaryAction={{
        content: "Add Products",
        icon: ProductIcon,
        onAction: handleAddProducts,
        loading: isSubmitting,
      }}
      secondaryActions={[
        {
          content: "Analyze SEO",
          icon: CheckIcon,
          onAction: handleAnalyzeSEO,
          loading: isSubmitting,
        },
        {
          content: "View on Store",
          icon: ExternalIcon,
          url: `shopify:admin/articles/${article.id.replace("gid://shopify/Article/", "")}`,
          target: "_blank",
        },
      ]}
    >
      <BlockStack gap="500">
        {/* Quick Stats */}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          <Card>
            <BlockStack gap="100">
              <Text as="span" variant="bodySm" tone="subdued">
                Products Embedded
              </Text>
              <Text as="p" variant="headingLg" fontWeight="bold">
                {embeddedProducts.length}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="span" variant="bodySm" tone="subdued">
                Impressions
              </Text>
              <Text as="p" variant="headingLg" fontWeight="bold">
                {stats.impressions}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="span" variant="bodySm" tone="subdued">
                Clicks
              </Text>
              <Text as="p" variant="headingLg" fontWeight="bold">
                {stats.clicks}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="span" variant="bodySm" tone="subdued">
                SEO Score
              </Text>
              <Text
                as="p"
                variant="headingLg"
                fontWeight="bold"
                tone={
                  seoScore === null
                    ? undefined
                    : seoScore >= 80
                      ? "success"
                      : seoScore >= 50
                        ? "caution"
                        : "critical"
                }
              >
                {seoScore !== null ? `${seoScore}/100` : "—"}
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        <Layout>
          {/* Main Content - Embedded Products */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Embedded Products
                  </Text>
                  <Button
                    icon={ProductIcon}
                    onClick={handleAddProducts}
                    loading={isSubmitting}
                  >
                    Add Products
                  </Button>
                </InlineStack>

                {embeddedProducts.length > 0 ? (
                  <BlockStack gap="300">
                    {embeddedProducts.map((product, index) => (
                      <Box
                        key={product.id}
                        padding="400"
                        background="bg-surface-secondary"
                        borderRadius="300"
                        borderWidth="025"
                        borderColor="border"
                      >
                        <InlineStack
                          align="space-between"
                          blockAlign="center"
                          wrap={false}
                        >
                          <InlineStack gap="400" blockAlign="center">
                            {/* Drag handle + position */}
                            <BlockStack gap="100" inlineAlign="center">
                              <Button
                                icon={ArrowUpIcon}
                                variant="plain"
                                size="micro"
                                disabled={index === 0}
                                onClick={() =>
                                  handleMoveProduct(index, "up")
                                }
                                accessibilityLabel="Move up"
                              />
                              <Text
                                as="span"
                                variant="bodySm"
                                tone="subdued"
                                alignment="center"
                              >
                                {index + 1}
                              </Text>
                              <Button
                                icon={ArrowDownIcon}
                                variant="plain"
                                size="micro"
                                disabled={
                                  index === embeddedProducts.length - 1
                                }
                                onClick={() =>
                                  handleMoveProduct(index, "down")
                                }
                                accessibilityLabel="Move down"
                              />
                            </BlockStack>

                            {/* Product thumbnail */}
                            <Thumbnail
                              source={product.productImage || ImageIcon}
                              alt={product.productTitle}
                              size="medium"
                            />

                            {/* Product info */}
                            <BlockStack gap="100">
                              <Text
                                as="span"
                                variant="bodyMd"
                                fontWeight="semibold"
                              >
                                {product.productTitle}
                              </Text>
                              <InlineStack gap="200">
                                <Text as="span" variant="bodySm" tone="subdued">
                                  ${product.productPrice}
                                </Text>
                                <Badge
                                  tone={
                                    product.displayStyle === "card"
                                      ? "info"
                                      : product.displayStyle === "inline"
                                        ? "success"
                                        : undefined
                                  }
                                >
                                  {product.displayStyle}
                                </Badge>
                                {product.isActive ? (
                                  <Badge tone="success">Active</Badge>
                                ) : (
                                  <Badge tone="critical">Inactive</Badge>
                                )}
                              </InlineStack>
                            </BlockStack>
                          </InlineStack>

                          {/* Actions */}
                          <ButtonGroup>
                            <Button
                              icon={EditIcon}
                              variant="plain"
                              onClick={() => {
                                setEditingProduct(product.productId);
                                setSelectedStyle(product.displayStyle);
                                setShowStyleModal(true);
                              }}
                              accessibilityLabel="Edit style"
                            />
                            <Button
                              icon={DeleteIcon}
                              variant="plain"
                              tone="critical"
                              onClick={() =>
                                handleRemoveProduct(product.productId)
                              }
                              accessibilityLabel="Remove product"
                            />
                          </ButtonGroup>
                        </InlineStack>
                      </Box>
                    ))}
                  </BlockStack>
                ) : (
                  <EmptyState
                    heading="No products embedded yet"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    action={{
                      content: "Add Products",
                      onAction: handleAddProducts,
                    }}
                  >
                    <p>
                      Add products to this article to create shoppable content
                      that drives conversions.
                    </p>
                  </EmptyState>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Sidebar */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              {/* Article Preview */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Article Info
                  </Text>
                  {article.image && (
                    <Box
                      borderRadius="200"
                      overflowX="hidden"
                      overflowY="hidden"
                    >
                      <img
                        src={article.image.url}
                        alt={article.image.altText || article.title}
                        style={{
                          width: "100%",
                          height: "auto",
                          display: "block",
                        }}
                      />
                    </Box>
                  )}
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm" tone="subdued">
                        Blog
                      </Text>
                      <Text as="span" variant="bodySm">
                        {article.blog.title}
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm" tone="subdued">
                        Status
                      </Text>
                      {article.publishedAt ? (
                        <Badge tone="success">Published</Badge>
                      ) : (
                        <Badge>Draft</Badge>
                      )}
                    </InlineStack>
                    {article.tags && article.tags.length > 0 && (
                      <>
                        <Text as="span" variant="bodySm" tone="subdued">
                          Tags
                        </Text>
                        <InlineStack gap="100" wrap>
                          {article.tags.map((tag: string) => (
                            <Badge key={tag}>{tag}</Badge>
                          ))}
                        </InlineStack>
                      </>
                    )}
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* SEO Card */}
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      SEO Analysis
                    </Text>
                    <Button
                      variant="plain"
                      onClick={handleAnalyzeSEO}
                      loading={isSubmitting}
                    >
                      Analyze
                    </Button>
                  </InlineStack>

                  {seoScore !== null ? (
                    <>
                      <BlockStack gap="200">
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm">
                            Score
                          </Text>
                          <Text
                            as="span"
                            variant="headingMd"
                            fontWeight="bold"
                            tone={
                              seoScore >= 80
                                ? "success"
                                : seoScore >= 50
                                  ? "caution"
                                  : "critical"
                            }
                          >
                            {seoScore}/100
                          </Text>
                        </InlineStack>
                        <ProgressBar
                          progress={seoScore}
                          size="small"
                          tone={
                            seoScore >= 80
                              ? "success"
                              : seoScore >= 50
                                ? "primary"
                                : "critical"
                          }
                        />
                      </BlockStack>

                      {seoIssues.length > 0 && (
                        <>
                          <Divider />
                          <BlockStack gap="200">
                            {seoIssues.map(
                              (issue: any, i: number) => (
                                <InlineStack
                                  key={i}
                                  gap="200"
                                  blockAlign="start"
                                >
                                  <Box>
                                    <Icon
                                      source={
                                        issue.severity === "error"
                                          ? AlertCircleIcon
                                          : issue.severity === "warning"
                                            ? AlertCircleIcon
                                            : CheckIcon
                                      }
                                      tone={
                                        issue.severity === "error"
                                          ? "critical"
                                          : issue.severity === "warning"
                                            ? "caution"
                                            : "info"
                                      }
                                    />
                                  </Box>
                                  <Text as="span" variant="bodySm">
                                    {issue.message}
                                  </Text>
                                </InlineStack>
                              ),
                            )}
                          </BlockStack>
                        </>
                      )}
                    </>
                  ) : (
                    <Box padding="400">
                      <BlockStack gap="200" inlineAlign="center">
                        <Text
                          as="p"
                          variant="bodySm"
                          tone="subdued"
                          alignment="center"
                        >
                          Click "Analyze" to check SEO health for this article.
                        </Text>
                      </BlockStack>
                    </Box>
                  )}
                </BlockStack>
              </Card>

              {/* Widget Display Settings */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Display Styles
                  </Text>
                  <BlockStack gap="200">
                    <StyleOption
                      title="Card"
                      description="Full product card with image, price, and CTA"
                      value="card"
                    />
                    <StyleOption
                      title="Inline"
                      description="Compact inline widget within content"
                      value="inline"
                    />
                    <StyleOption
                      title="Minimal"
                      description="Text link with price only"
                      value="minimal"
                    />
                  </BlockStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* Style Edit Modal */}
      {showStyleModal && editingProduct && (
        <Modal
          open={showStyleModal}
          onClose={() => setShowStyleModal(false)}
          title="Change Display Style"
          primaryAction={{
            content: "Save",
            onAction: () =>
              handleStyleChange(editingProduct, selectedStyle),
          }}
          secondaryActions={[
            { content: "Cancel", onAction: () => setShowStyleModal(false) },
          ]}
        >
          <Modal.Section>
            <Select
              label="Display Style"
              options={[
                { label: "Card — Full product card", value: "card" },
                { label: "Inline — Compact widget", value: "inline" },
                { label: "Minimal — Text link only", value: "minimal" },
              ]}
              value={selectedStyle}
              onChange={setSelectedStyle}
            />
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}

function StyleOption({
  title,
  description,
  value,
}: {
  title: string;
  description: string;
  value: string;
}) {
  return (
    <Box
      padding="300"
      background="bg-surface-secondary"
      borderRadius="200"
    >
      <BlockStack gap="050">
        <Text as="span" variant="bodySm" fontWeight="semibold">
          {title}
        </Text>
        <Text as="span" variant="bodySm" tone="subdued">
          {description}
        </Text>
      </BlockStack>
    </Box>
  );
}
