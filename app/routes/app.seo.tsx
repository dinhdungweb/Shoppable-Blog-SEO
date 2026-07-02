import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  EmptyState,
  Icon,
  IndexTable,
  InlineGrid,
  InlineStack,
  Layout,
  Modal,
  Page,
  ProgressBar,
  Tabs,
  Text,
  Thumbnail,
  useIndexResourceState,
} from "@shopify/polaris";
import {
  AlertTriangleIcon,
  ChartVerticalFilledIcon,
  ImageIcon,
  MagicIcon,
  NoteIcon,
  ShieldCheckMarkIcon,
} from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { auditSeo as runSeoAudit } from "../seo-audit";
import { fetchShopDomains } from "../shopify-domains.server";

type SeoCategory = "on_page" | "product_linking" | "image" | "schema" | "content";
type SeoSeverity = "critical" | "warning" | "info" | "good";
type Impact = "High" | "Medium" | "Low";
type Effort = "High" | "Medium" | "Low";

type ArticleInput = {
  id: string;
  title: string;
  handle: string;
  body: string;
  summary: string;
  imageUrl: string;
  imageAlt: string;
  updatedAt: string;
  seoTitle: string;
  seoDescription: string;
  blogId: string;
  blogTitle: string;
  blogHandle: string;
};

type StoredSeoInput = {
  articleId: string;
  seoScore?: number | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  focusKeyword?: string | null;
  lastAnalyzedAt?: Date | null;
};

type SeoIssue = {
  type: string;
  category: SeoCategory;
  label: string;
  message: string;
  severity: SeoSeverity;
  impact: Impact;
  effort: Effort;
  fix: string;
};

type AuditedPost = ArticleInput & {
  productCount: number;
  score: number;
  issues: SeoIssue[];
  lastAnalyzedAt: string | null;
};

type IssueGroup = {
  id: string;
  category: SeoCategory;
  issue: string;
  affected: number;
  impact: Impact;
  effort: Effort;
  status: string;
  fix: string;
  actionLabel: string;
  examples: string[];
  targetPostId: string;
  affectedPosts: Array<{
    id: string;
    title: string;
    blogTitle: string;
  }>;
};

const PLACEHOLDER_IMAGE = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";
const DONUT_COLORS = {
  High: "#D82C0D",
  Medium: "#FFC453",
  Low: "#29845A",
};

const CATEGORY_TABS: Array<{ id: SeoCategory | "all"; content: string }> = [
  { id: "all", content: "All issues" },
  { id: "on_page", content: "On-page SEO" },
  { id: "product_linking", content: "Product linking" },
  { id: "image", content: "Image SEO" },
  { id: "schema", content: "Schema" },
  { id: "content", content: "Content quality" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const shopDomains = await fetchShopDomains(admin, shop);
  let shopifyError = "";
  let articles: ArticleInput[] = [];

  try {
    articles = await fetchShopifyArticles(admin);
  } catch (error) {
    console.error("SEO Shopify query failed:", error);
    shopifyError = "Could not load Shopify blog posts.";
  }

  const [linkedProducts, seoRows, config] = await Promise.all([
    prisma.articleProduct.findMany({
      where: { shop, isActive: true },
      select: {
        articleId: true,
        articleTitle: true,
        articleHandle: true,
        blogId: true,
      },
    }),
    prisma.articleSEO.findMany({
      where: { shop },
      select: {
        articleId: true,
        articleTitle: true,
        seoScore: true,
        metaTitle: true,
        metaDescription: true,
        focusKeyword: true,
        issues: true,
        lastAnalyzedAt: true,
      },
    }),
    prisma.shopConfig.upsert({
      where: { shop },
      update: {},
      create: { shop },
    }),
  ]);

  const fallbackArticleMap = new Map<string, ArticleInput>();
  linkedProducts.forEach((product) => {
    if (!fallbackArticleMap.has(product.articleId)) {
      fallbackArticleMap.set(product.articleId, {
        id: product.articleId,
        title: product.articleTitle || "Untitled post",
        handle: product.articleHandle || "",
        body: "",
        summary: "",
        imageUrl: "",
        imageAlt: "",
        updatedAt: "",
        seoTitle: "",
        seoDescription: "",
        blogId: product.blogId || "",
        blogTitle: "Blog",
        blogHandle: "",
      });
    }
  });
  seoRows.forEach((row) => {
    if (!fallbackArticleMap.has(row.articleId)) {
      fallbackArticleMap.set(row.articleId, {
        id: row.articleId,
        title: row.articleTitle || "Untitled post",
        handle: "",
        body: "",
        summary: "",
        imageUrl: "",
        imageAlt: "",
        updatedAt: "",
        seoTitle: row.metaTitle || "",
        seoDescription: row.metaDescription || "",
        blogId: "",
        blogTitle: "Blog",
        blogHandle: "",
      });
    }
  });

  const articleMap = new Map(articles.map((article) => [article.id, article]));
  fallbackArticleMap.forEach((article, id) => {
    if (!articleMap.has(id)) articleMap.set(id, article);
  });

  const productCountMap = new Map<string, number>();
  linkedProducts.forEach((product) => {
    productCountMap.set(product.articleId, (productCountMap.get(product.articleId) || 0) + 1);
  });

  const storedSeoMap = new Map(seoRows.map((row) => [row.articleId, row]));
  const auditedPosts = Array.from(articleMap.values())
    .map((article) => {
      const productCount = productCountMap.get(article.id) || 0;
      const stored = storedSeoMap.get(article.id);
      const audit = auditArticle(article, productCount, config, stored, shop, shopDomains);

      return {
        ...article,
        productCount,
        score: audit.score,
        issues: audit.issues,
        lastAnalyzedAt: stored?.lastAnalyzedAt ? stored.lastAnalyzedAt.toISOString() : null,
      };
    })
    .sort((a, b) => a.score - b.score || b.issues.length - a.issues.length || a.title.localeCompare(b.title));

  const issueGroups = buildIssueGroups(auditedPosts);
  const issueStats = getIssueStats(issueGroups);
  const averageScore = getAverageScore(auditedPosts);
  const lastScanAt = seoRows.reduce<Date | null>((latest, row) => {
    if (!row.lastAnalyzedAt) return latest;
    if (!latest || row.lastAnalyzedAt > latest) return row.lastAnalyzedAt;
    return latest;
  }, null);

  return json({
    shopifyError,
    averageScore,
    issueGroups,
    issueStats,
    affectedPosts: auditedPosts.filter((post) => post.issues.length > 0).length,
    quickWins: issueGroups.filter((issue) => issue.effort === "Low").reduce((sum, issue) => sum + issue.affected, 0),
    scannedPosts: seoRows.length,
    totalPosts: auditedPosts.length,
    lastScanAt: lastScanAt ? lastScanAt.toISOString() : null,
    postsNeedingAttention: auditedPosts.filter((post) => post.issues.length > 0).slice(0, 6),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent !== "scan_all") {
    return json({ error: "Unsupported action" }, { status: 400 });
  }

  const [articles, linkedProducts, config, seoRows, shopDomains] = await Promise.all([
    fetchShopifyArticles(admin),
    prisma.articleProduct.findMany({
      where: { shop, isActive: true },
      select: { articleId: true },
    }),
    prisma.shopConfig.upsert({
      where: { shop },
      update: {},
      create: { shop },
    }),
    prisma.articleSEO.findMany({
      where: { shop },
      select: {
        articleId: true,
        seoScore: true,
        metaTitle: true,
        metaDescription: true,
        focusKeyword: true,
        lastAnalyzedAt: true,
      },
    }),
    fetchShopDomains(admin, shop),
  ]);

  const productCountMap = new Map<string, number>();
  linkedProducts.forEach((product) => {
    productCountMap.set(product.articleId, (productCountMap.get(product.articleId) || 0) + 1);
  });

  const storedSeoMap = new Map(seoRows.map((row) => [row.articleId, row]));
  const audits = articles.map((article) => {
    const stored = storedSeoMap.get(article.id);
    const audit = auditArticle(article, productCountMap.get(article.id) || 0, config, stored, shop, shopDomains);
    return { article, audit };
  });

  const articleIds = articles.map((a) => a.id);

  // Clean up obsolete records for deleted articles
  await prisma.articleSEO.deleteMany({
    where: { shop, articleId: { notIn: articleIds } },
  });
  await prisma.articleProduct.deleteMany({
    where: { shop, articleId: { notIn: articleIds } },
  });

  await Promise.all(
    audits.map(({ article, audit }) => {
      const stored = storedSeoMap.get(article.id);
      const metaTitle = textValue(stored?.metaTitle) || null;
      const metaDescription = textValue(stored?.metaDescription) || null;

      return prisma.articleSEO.upsert({
        where: { articleId: article.id },
        update: {
          shop,
          articleTitle: article.title,
          seoScore: audit.score,
          metaTitle,
          metaDescription,
          issues: JSON.stringify(audit.issues),
          lastAnalyzedAt: new Date(),
        },
        create: {
          shop,
          articleId: article.id,
          articleTitle: article.title,
          seoScore: audit.score,
          metaTitle,
          metaDescription,
          issues: JSON.stringify(audit.issues),
          lastAnalyzedAt: new Date(),
        },
      });
    }),
  );

  return json({
    success: true,
    scannedCount: audits.length,
    averageScore: getAverageScore(audits.map(({ article, audit }) => ({ ...article, productCount: productCountMap.get(article.id) || 0, score: audit.score, issues: audit.issues, lastAnalyzedAt: new Date().toISOString() }))),
  });
};

export default function SEOOptimizer() {
  const {
    shopifyError,
    averageScore,
    issueGroups,
    issueStats,
    affectedPosts,
    quickWins,
    scannedPosts,
    totalPosts,
    lastScanAt,
    postsNeedingAttention,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const scanFetcher = useFetcher<typeof action>();
  const [selectedTab, setSelectedTab] = useState(0);
  const [activeIssue, setActiveIssue] = useState<IssueGroup | null>(null);
  const selectedCategory = CATEGORY_TABS[selectedTab]?.id || "all";
  const visibleIssues = useMemo(
    () => issueGroups.filter((issue) => selectedCategory === "all" || issue.category === selectedCategory),
    [issueGroups, selectedCategory],
  );
  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } = useIndexResourceState(visibleIssues as any);
  const isScanning = scanFetcher.state !== "idle";

  useEffect(() => {
    const data = scanFetcher.data as { success?: boolean; scannedCount?: number; averageScore?: number; error?: string } | undefined;
    if (!data) return;
    if (data.success) {
      shopify.toast.show(`SEO scan complete: ${data.scannedCount || 0} posts, avg ${data.averageScore || 0}/100`);
    } else if (data.error) {
      shopify.toast.show(data.error, { isError: true });
    }
  }, [scanFetcher.data, shopify]);

  const selectedIssueCount = allResourcesSelected ? visibleIssues.length : selectedResources.length;
  const selectedIssues = visibleIssues.filter((issue) => allResourcesSelected || selectedResources.includes(issue.id));
  const selectedPotential = selectedIssues.reduce((sum, issue) => sum + issue.affected * getImpactWeight(issue.impact), 0);
  const selectedTime = selectedIssues.reduce((sum, issue) => sum + issue.affected * getEffortMinutes(issue.effort), 0);
  const donutData = [
    { name: "High impact", value: issueStats.High, color: DONUT_COLORS.High },
    { name: "Medium impact", value: issueStats.Medium, color: DONUT_COLORS.Medium },
    { name: "Low impact", value: issueStats.Low, color: DONUT_COLORS.Low },
  ];
  const goToPost = (postId: string) => navigate(getPostTarget(postId));
  const handleIssueAction = (issue: IssueGroup) => {
    if (issue.category === "schema") {
      navigate("/app/settings");
      return;
    }

    if (issue.affectedPosts.length > 1) {
      setActiveIssue(issue);
      return;
    }

    if (issue.targetPostId) {
      goToPost(issue.targetPostId);
      return;
    }

    navigate("/app/blogs");
  };

  return (
    <Page fullWidth>
      <TitleBar title="SEO Optimizer">
        <button
          variant="primary"
          disabled={isScanning}
          onClick={() => scanFetcher.submit({ intent: "scan_all" }, { method: "post" })}
        >
          {isScanning ? "Scanning..." : "Run SEO scan"}
        </button>
      </TitleBar>

      <BlockStack gap="500">
        <InlineStack align="space-between" blockAlign="end">
          <BlockStack gap="100">
            <Text as="h1" variant="headingXl" fontWeight="bold">
              SEO Optimizer
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Identify and resolve SEO issues across Shopify blog posts. Scores are saved to ArticleSEO for Blog Manager and Overview.
            </Text>
          </BlockStack>
          <InlineStack gap="200" blockAlign="center">
            <Badge tone="info">{lastScanAt ? `Last scan ${formatDate(lastScanAt)}` : "Not scanned yet"}</Badge>
            <Button loading={isScanning} onClick={() => scanFetcher.submit({ intent: "scan_all" }, { method: "post" })}>
              Run SEO scan
            </Button>
            <Button variant="primary" onClick={() => navigate("/app/blogs")}>
              Review posts
            </Button>
          </InlineStack>
        </InlineStack>

        {shopifyError && (
          <Card padding="400">
            <Text as="p" variant="bodyMd" tone="caution">
              {shopifyError} Existing saved SEO rows are still shown when available.
            </Text>
          </Card>
        )}

        <InlineGrid columns={{ xs: 1, sm: 2, md: 5 }} gap="400">
          <MetricCard
            title="SEO health score"
            value={String(averageScore)}
            suffix="/100"
            tone={averageScore >= 80 ? "success" : averageScore >= 60 ? "warning" : "critical"}
            icon={ShieldCheckMarkIcon}
            progress={averageScore}
          />
          <MetricCard
            title="High impact issues"
            value={String(issueStats.High)}
            tone={issueStats.High ? "critical" : "success"}
            icon={AlertTriangleIcon}
            progress={Math.min(100, issueStats.High * 12)}
          />
          <MetricCard
            title="Quick wins"
            value={String(quickWins)}
            tone={quickWins ? "warning" : "success"}
            icon={MagicIcon}
            progress={Math.min(100, quickWins * 8)}
          />
          <MetricCard
            title="Affected posts"
            value={String(affectedPosts)}
            suffix={`/${totalPosts}`}
            tone={affectedPosts ? "info" : "success"}
            icon={NoteIcon}
            progress={totalPosts ? (affectedPosts / totalPosts) * 100 : 0}
          />
          <MetricCard
            title="Saved scans"
            value={String(scannedPosts)}
            suffix={`/${totalPosts}`}
            tone={scannedPosts === totalPosts && totalPosts > 0 ? "success" : "info"}
            icon={ChartVerticalFilledIcon}
            progress={totalPosts ? (scannedPosts / totalPosts) * 100 : 0}
          />
        </InlineGrid>

        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              <Card padding="0">
                <Tabs tabs={CATEGORY_TABS} selected={selectedTab} onSelect={setSelectedTab} />
                {visibleIssues.length ? (
                  <div className="bp-seo-issue-table">
                    <IndexTable
                      resourceName={{ singular: "issue", plural: "issues" }}
                      itemCount={visibleIssues.length}
                      selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
                      onSelectionChange={handleSelectionChange}
                      headings={[
                        { title: "Issue" },
                        { title: "Affected" },
                        { title: "Impact" },
                        { title: "Effort" },
                        { title: "Status" },
                        { title: "Suggested fix" },
                        { title: "Action" },
                      ]}
                      selectable
                    >
                      {visibleIssues.map((issue, index) => (
                        <IndexTable.Row id={issue.id} key={issue.id} position={index} selected={selectedResources.includes(issue.id)}>
                          <IndexTable.Cell>
                            <div className="bp-seo-issue-cell">
                              <Text as="span" variant="bodyMd" fontWeight="semibold" truncate>
                                {issue.issue}
                              </Text>
                              <Text as="span" variant="bodySm" tone="subdued" truncate>
                                {issue.examples.slice(0, 2).join(", ")}
                              </Text>
                            </div>
                          </IndexTable.Cell>
                          <IndexTable.Cell>{issue.affected}</IndexTable.Cell>
                          <IndexTable.Cell>
                            <Badge tone={getImpactTone(issue.impact)}>{issue.impact}</Badge>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Badge tone={getEffortTone(issue.effort)}>{issue.effort}</Badge>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Badge tone={issue.status === "Done" ? "success" : issue.status === "Saved scan" ? "info" : undefined}>{issue.status}</Badge>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <div className="bp-seo-fix-cell">
                              <Text as="span" variant="bodyMd" truncate>
                                {issue.fix}
                              </Text>
                            </div>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Button size="micro" onClick={() => handleIssueAction(issue)}>
                              {issue.actionLabel}
                            </Button>
                          </IndexTable.Cell>
                        </IndexTable.Row>
                      ))}
                    </IndexTable>
                  </div>
                ) : (
                  <Box padding="600">
                    <EmptyState heading="No issues in this category" image={PLACEHOLDER_IMAGE}>
                      <p>Choose another category or run a fresh SEO scan.</p>
                    </EmptyState>
                  </Box>
                )}
              </Card>

              <Card padding="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="400" blockAlign="center">
                    <BlockStack gap="0">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="headingSm">
                          {selectedIssueCount} issues selected
                        </Text>
                        <Button variant="plain" onClick={clearSelection}>
                          Clear
                        </Button>
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        High ({issueStats.High}) - Medium ({issueStats.Medium}) - Low ({issueStats.Low})
                      </Text>
                    </BlockStack>
                    <Divider borderColor="border" />
                    <BlockStack gap="0">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        Potential impact
                      </Text>
                      <Text as="span" variant="bodySm" tone="success" fontWeight="bold">
                        {selectedPotential ? `+${selectedPotential} priority points` : "Select issues"}
                      </Text>
                    </BlockStack>
                    <Divider borderColor="border" />
                    <BlockStack gap="0">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        Estimated time
                      </Text>
                      <Text as="span" variant="bodySm" fontWeight="bold">
                        {selectedTime ? formatMinutes(selectedTime) : "-"}
                      </Text>
                    </BlockStack>
                  </InlineStack>

                  <InlineStack gap="200">
                    <Button onClick={() => navigate("/app/blogs")}>Review posts</Button>
                    <Button variant="primary" loading={isScanning} onClick={() => scanFetcher.submit({ intent: "scan_all" }, { method: "post" })}>
                      Apply scan
                    </Button>
                  </InlineStack>
                </InlineStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card padding="400">
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd" fontWeight="bold">
                    Issue breakdown
                  </Text>
                  <InlineStack gap="500" blockAlign="center" wrap={false}>
                    <div style={{ width: "120px", height: "120px", position: "relative" }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={donutData} cx="50%" cy="50%" innerRadius={45} outerRadius={60} paddingAngle={2} dataKey="value" stroke="none">
                            {donutData.map((entry) => (
                              <Cell key={entry.name} fill={entry.color} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
                        <Text as="p" variant="headingLg" fontWeight="bold">
                          {issueStats.total}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued" alignment="center">
                          Issues
                        </Text>
                      </div>
                    </div>
                    <BlockStack gap="200">
                      {donutData.map((item) => (
                        <InlineStack key={item.name} align="space-between" blockAlign="center" gap="300">
                          <InlineStack gap="100" blockAlign="center">
                            <div style={{ width: "8px", height: "8px", borderRadius: "4px", backgroundColor: item.color }} />
                            <Text as="span" variant="bodySm">
                              {item.name}
                            </Text>
                          </InlineStack>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {item.value}
                          </Text>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  </InlineStack>
                </BlockStack>
              </Card>

              <Card padding="400">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd" fontWeight="bold">
                      Posts needing attention
                    </Text>
                    <Button variant="plain" onClick={() => navigate("/app/blogs")}>
                      View all
                    </Button>
                  </InlineStack>
                  <BlockStack gap="300">
                    {postsNeedingAttention.length ? (
                      postsNeedingAttention.map((post) => (
                        <InlineStack key={post.id} align="space-between" blockAlign="center" wrap={false}>
                          <InlineStack gap="300" blockAlign="center" wrap={false}>
                            <Thumbnail source={post.imageUrl || ImageIcon} alt={post.imageAlt || post.title} size="small" />
                            <BlockStack gap="050">
                              <Text as="span" variant="bodyMd" fontWeight="semibold" truncate>
                                {post.title}
                              </Text>
                              <Text as="span" variant="bodySm" tone="subdued">
                                Score {post.score}/100
                              </Text>
                            </BlockStack>
                          </InlineStack>
                          <Button size="micro" onClick={() => goToPost(post.id)}>
                            Review
                          </Button>
                        </InlineStack>
                      ))
                    ) : (
                      <Text as="p" tone="subdued">
                        All posts are optimized.
                      </Text>
                    )}
                  </BlockStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
      <Modal
        open={Boolean(activeIssue)}
        onClose={() => setActiveIssue(null)}
        title={activeIssue ? `${activeIssue.issue} (${activeIssue.affected} posts)` : "Affected posts"}
        secondaryActions={[
          {
            content: "Close",
            onAction: () => setActiveIssue(null),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            {(activeIssue?.affectedPosts || []).map((post) => (
              <div key={post.id} className="bp-seo-affected-post-row">
                <BlockStack gap="050">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {post.title}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {post.blogTitle}
                  </Text>
                </BlockStack>
                <Button
                  size="micro"
                  onClick={() => {
                    setActiveIssue(null);
                    goToPost(post.id);
                  }}
                >
                  {activeIssue?.actionLabel || "Review"}
                </Button>
              </div>
            ))}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

function MetricCard({
  title,
  value,
  suffix,
  tone,
  icon,
  progress,
}: {
  title: string;
  value: string;
  suffix?: string;
  tone: "success" | "warning" | "critical" | "info";
  icon: any;
  progress: number;
}) {
  return (
    <Card padding="400">
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <InlineStack gap="150" blockAlign="center" wrap={false}>
            <Icon source={icon} tone={tone as any} />
            <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
              {title}
            </Text>
          </InlineStack>
        </InlineStack>
        <InlineStack gap="100" blockAlign="end">
          <Text as="span" variant="heading2xl" fontWeight="bold">
            {value}
          </Text>
          {suffix && (
            <Text as="span" variant="bodyMd" tone="subdued">
              {suffix}
            </Text>
          )}
        </InlineStack>
        <ProgressBar progress={Math.max(0, Math.min(100, progress))} tone={tone === "critical" ? "critical" : tone === "warning" ? "primary" : "success"} size="small" />
      </BlockStack>
    </Card>
  );
}

async function fetchShopifyArticles(admin: any): Promise<ArticleInput[]> {
  try {
    return await fetchShopifyArticleList(admin, true);
  } catch (error) {
    console.error("Full SEO article query failed, retrying lightweight query:", error);
    return fetchShopifyArticleList(admin, false);
  }
}

async function fetchShopifyArticleList(admin: any, includeContent: boolean): Promise<ArticleInput[]> {
  const query = includeContent
    ? `#graphql
    query SeoBlogs {
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
              updatedAt
              body
              summary
              image {
                url
                altText
              }
              seoTitle: metafield(namespace: "global", key: "title_tag") {
                value
              }
              seoDescription: metafield(namespace: "global", key: "description_tag") {
                value
              }
              blog {
                id
                title
                handle
              }
            }
          }
        }
      }
    }`
    : `#graphql
    query SeoBlogsLite {
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
              updatedAt
              image {
                url
                altText
              }
              seoTitle: metafield(namespace: "global", key: "title_tag") {
                value
              }
              seoDescription: metafield(namespace: "global", key: "description_tag") {
                value
              }
              blog {
                id
                title
                handle
              }
            }
          }
        }
      }
    }`;
  const response = await admin.graphql(query);
  const result: any = await response.json();

  if (result.errors?.length) {
    throw new Error(result.errors.map((error: any) => error.message).join("; ") || "Could not load Shopify blog posts.");
  }

  const blogs = result.data?.blogs?.nodes || [];
  return blogs.flatMap((blog: any) =>
    (blog.articles?.nodes || []).map((article: any) => ({
      id: article.id,
      title: cleanText(article.title) || "Untitled post",
      handle: cleanText(article.handle),
      body: article.body || "",
      summary: article.summary || "",
      imageUrl: article.image?.url || "",
      imageAlt: article.image?.altText || "",
      updatedAt: article.updatedAt || "",
      seoTitle: article.seoTitle?.value || "",
      seoDescription: article.seoDescription?.value || "",
      blogId: article.blog?.id || blog.id,
      blogTitle: article.blog?.title || blog.title || "Blog",
      blogHandle: article.blog?.handle || blog.handle || "",
    })),
  );
}

function auditArticle(
  article: ArticleInput,
  productCount: number,
  config: { addBlogSchema?: boolean; addProductSchema?: boolean },
  storedSeo?: StoredSeoInput | null,
  shopDomain?: string,
  shopDomains: string[] = [],
) {
  const issues: SeoIssue[] = [];
  const seoTitle = getEffectiveSeoTitle(storedSeo?.metaTitle, article);
  const seoDescription = getEffectiveSeoDescription(storedSeo?.metaDescription, article);
  const body = article.body || "";
  const bodyText = stripHtml(body);
  const wordCount = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;
  const linkStats = analyzeLinks(body, shopDomain, shopDomains);
  const headings = getHeadingTexts(body);
  const hasToc = hasTableOfContents(body) || headings.length >= 3;
  const bodyImageAltText = getBodyImageAltText(body);
  const allImageAltText = `${article.imageAlt || ""} ${bodyImageAltText}`.trim();
  const hasAnyImage = Boolean(article.imageUrl) || /<img\b/i.test(body);
  const hasMediaInBody = productCount > 0 || /<img|<iframe|<video/i.test(body);
  const focusKeyword = textValue(storedSeo?.focusKeyword);
  const keywords = focusKeyword
    .split(",")
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);
  const primaryKeyword = keywords[0] || "";
  const titleLower = seoTitle.toLowerCase();
  const summaryLower = seoDescription.toLowerCase();
  const handleLower = (article.handle || "").toLowerCase();
  const bodyLower = bodyText.toLowerCase();
  const first10Words = bodyText
    .split(/\s+/)
    .slice(0, Math.max(20, Math.floor(wordCount * 0.1)))
    .join(" ")
    .toLowerCase();

  const addIssue = (issue: SeoIssue, _penalty: number) => {
    issues.push(issue);
  };

  if (!seoDescription) {
    addIssue(
      {
        type: "missing_meta_description",
        category: "on_page",
        label: "Missing meta descriptions",
        message: "Meta descriptions help search engines and shoppers understand each post.",
        severity: "critical",
        impact: "High",
        effort: "Low",
        fix: "Add a unique 120-160 character meta description.",
      },
      18,
    );
  } else if (seoDescription.length < 70) {
    addIssue(
      {
        type: "short_meta_description",
        category: "on_page",
        label: "Short meta descriptions",
        message: "Short descriptions may underperform in search results.",
        severity: "warning",
        impact: "Medium",
        effort: "Low",
        fix: "Expand the meta description with a clearer benefit.",
      },
      6,
    );
  } else if (seoDescription.length > 165) {
    addIssue(
      {
        type: "long_meta_description",
        category: "on_page",
        label: "Long meta descriptions",
        message: "Long descriptions can be truncated in search results.",
        severity: "warning",
        impact: "Low",
        effort: "Low",
        fix: "Trim the meta description under 165 characters.",
      },
      4,
    );
  }

  if (!seoTitle) {
    addIssue(
      {
        type: "missing_seo_title",
        category: "on_page",
        label: "Missing SEO titles",
        message: "SEO titles should be unique and descriptive.",
        severity: "warning",
        impact: "Medium",
        effort: "Low",
        fix: "Add a unique SEO title for each post.",
      },
      12,
    );
  } else if (seoTitle.length > 70) {
    addIssue(
      {
        type: "long_seo_title",
        category: "on_page",
        label: "Long SEO titles",
        message: "Long SEO titles can be cut off on search results pages.",
        severity: "warning",
        impact: "Low",
        effort: "Low",
        fix: "Keep SEO titles under 70 characters.",
      },
      4,
    );
  }

  if (article.imageUrl && !article.imageAlt.trim()) {
    addIssue(
      {
        type: "missing_image_alt",
        category: "image",
        label: "Missing image alt text",
        message: "Alt text improves accessibility and image search visibility.",
        severity: "warning",
        impact: "Medium",
        effort: "Low",
        fix: "Add descriptive alt text to blog images.",
      },
      8,
    );
  }

  if (productCount === 0) {
    addIssue(
      {
        type: "no_linked_products",
        category: "product_linking",
        label: "No linked products",
        message: "Posts without products cannot drive shoppable engagement.",
        severity: "critical",
        impact: "High",
        effort: "Medium",
        fix: "Link relevant products to the post.",
      },
      18,
    );
  }

  if (wordCount < 250) {
    addIssue(
      {
        type: "thin_content",
        category: "content",
        label: "Thin content",
        message: `Content is only ${wordCount} words long. Aim for at least 600 words.`,
        severity: "critical",
        impact: "High",
        effort: "Medium",
        fix: "Add more useful sections, examples, or product context.",
      },
      8,
    );
  } else if (wordCount < 600) {
    addIssue(
      {
        type: "short_content",
        category: "content",
        label: "Short content",
        message: `Content is ${wordCount} words long. Consider expanding it to 600+ words.`,
        severity: "warning",
        impact: "Medium",
        effort: "Medium",
        fix: "Add more useful sections, examples, or product context.",
      },
      5,
    );
  }

  if (!hasMediaInBody && !article.imageUrl) {
    addIssue(
      {
        type: "missing_media",
        category: "content",
        label: "Missing media",
        message: "Add images, products, or videos to improve content readability.",
        severity: "warning",
        impact: "Medium",
        effort: "Medium",
        fix: "Add a featured image, inline media, or a linked product block.",
      },
      5,
    );
  }

  const longParagraphs = body.split(/<\/p>/i).filter((paragraph) => stripHtml(paragraph).split(/\s+/).length > 120);
  if (longParagraphs.length > 0) {
    addIssue(
      {
        type: "long_paragraphs",
        category: "content",
        label: "Long paragraphs",
        message: "Some paragraphs are too long. Keep paragraphs short and easy to scan.",
        severity: "warning",
        impact: "Low",
        effort: "Low",
        fix: "Split long paragraphs into shorter sections.",
      },
      3,
    );
  }

  if (!hasToc) {
    addIssue(
      {
        type: "missing_toc",
        category: "content",
        label: "Missing table of contents",
        message: "You don't seem to be using a Table of Contents.",
        severity: "warning",
        impact: "Low",
        effort: "Low",
        fix: "Add a TOC shortcode or enough H2/H3 sections for the article TOC.",
      },
      2,
    );
  }

  if (headings.length === 0) {
    addIssue(
      {
        type: "missing_subheadings",
        category: "content",
        label: "Missing subheadings",
        message: "Subheadings make posts easier to scan and understand.",
        severity: "info",
        impact: "Low",
        effort: "Low",
        fix: "Add clear H2/H3 sections to structure the article.",
      },
      4,
    );
  }

  if (!article.handle || article.handle.length > 75) {
    addIssue(
      {
        type: "long_url",
        category: "on_page",
        label: "URL length",
        message: "URL is too long. Consider shortening it.",
        severity: "warning",
        impact: "Low",
        effort: "Low",
        fix: "Use a short descriptive URL handle.",
      },
      2,
    );
  }

  if (linkStats.external < 1) {
    addIssue(
      {
        type: "missing_external_links",
        category: "content",
        label: "Missing external links",
        message: "Link out to external resources.",
        severity: "warning",
        impact: "Medium",
        effort: "Low",
        fix: "Add a relevant external reference link.",
      },
      3,
    );
  }

  if (linkStats.dofollowExternal < 1) {
    addIssue(
      {
        type: "missing_dofollow_external_links",
        category: "content",
        label: "Missing DoFollow links",
        message: "Add DoFollow links pointing to external resources.",
        severity: "warning",
        impact: "Low",
        effort: "Low",
        fix: "Add at least one relevant external link without nofollow/sponsored/ugc.",
      },
      2,
    );
  }

  if (linkStats.internal < 1) {
    addIssue(
      {
        type: "missing_internal_links",
        category: "content",
        label: "Missing internal links",
        message: "Add internal links in your content.",
        severity: "warning",
        impact: "Medium",
        effort: "Low",
        fix: "Link to another blog post, collection, product, or page on the store.",
      },
      3,
    );
  }

  if (!/\d/.test(seoTitle)) {
    addIssue(
      {
        type: "title_number",
        category: "on_page",
        label: "Number in SEO title",
        message: "Your SEO title doesn't contain a number.",
        severity: "warning",
        impact: "Low",
        effort: "Low",
        fix: "Add a useful number when it fits naturally, like 5 tips or 10 ideas.",
      },
      2,
    );
  }

  if (primaryKeyword) {
    const occurrences = bodyLower.split(primaryKeyword).length - 1;
    const density = wordCount > 0 ? ((occurrences * primaryKeyword.split(" ").length) / wordCount) * 100 : 0;
    const inTitle = titleLower.includes(primaryKeyword);
    const inSummary = summaryLower.includes(primaryKeyword);
    const inHandle = handleLower.includes(slugifyKeyword(primaryKeyword));
    const inFirst10 = first10Words.includes(primaryKeyword);
    const inHeading = headings.some((heading) => heading.toLowerCase().includes(primaryKeyword));
    const inImageAlt = hasAnyImage && allImageAltText.toLowerCase().includes(primaryKeyword);

    if (!inTitle) {
      addIssue(
        {
          type: "focus_keyword_title",
          category: "on_page",
          label: "Focus keyword in title",
          message: "Add Focus Keyword to the SEO title.",
          severity: "critical",
          impact: "High",
          effort: "Low",
          fix: "Add the primary focus keyword to the SEO title.",
        },
        10,
      );
    } else if (titleLower.indexOf(primaryKeyword) >= 20) {
      addIssue(
        {
          type: "focus_keyword_title_position",
          category: "on_page",
          label: "Focus keyword position",
          message: "Use the Focus Keyword near the beginning of SEO title.",
          severity: "warning",
          impact: "Low",
          effort: "Low",
          fix: "Move the focus keyword closer to the start of the SEO title.",
        },
        1,
      );
    }

    if (!inSummary) {
      addIssue(
        {
          type: "focus_keyword_meta",
          category: "on_page",
          label: "Focus keyword in meta",
          message: "Add Focus Keyword to your SEO Meta Description.",
          severity: "warning",
          impact: "Medium",
          effort: "Low",
          fix: "Include the focus keyword naturally in the meta description.",
        },
        5,
      );
    }

    if (!inHandle) {
      addIssue(
        {
          type: "focus_keyword_url",
          category: "on_page",
          label: "Focus keyword in URL",
          message: "Use Focus Keyword in the URL.",
          severity: "warning",
          impact: "Medium",
          effort: "Low",
          fix: "Add the focus keyword to the article handle.",
        },
        5,
      );
    }

    if (!inFirst10) {
      addIssue(
        {
          type: "focus_keyword_beginning",
          category: "content",
          label: "Focus keyword at start",
          message: "Use Focus Keyword at the beginning of your content.",
          severity: "warning",
          impact: "Medium",
          effort: "Low",
          fix: "Mention the focus keyword in the opening paragraph.",
        },
        5,
      );
    }

    if (occurrences === 0) {
      addIssue(
        {
          type: "focus_keyword_content",
          category: "content",
          label: "Focus keyword in content",
          message: "Use Focus Keyword in the content.",
          severity: "critical",
          impact: "High",
          effort: "Medium",
          fix: "Mention the focus keyword naturally in the article body.",
        },
        15,
      );
    } else if (density < 0.5 || density > 2.5) {
      addIssue(
        {
          type: "keyword_density",
          category: "content",
          label: "Keyword density",
          message: `Keyword density is ${density.toFixed(2)}%. Aim for around 1% Keyword Density.`,
          severity: "warning",
          impact: "Low",
          effort: "Medium",
          fix: "Adjust keyword usage so it appears naturally without stuffing.",
        },
        2,
      );
    }

    if (!inHeading) {
      addIssue(
        {
          type: "focus_keyword_heading",
          category: "content",
          label: "Focus keyword in subheadings",
          message: "Use Focus Keyword in subheading(s) like H2, H3, H4, etc.",
          severity: "warning",
          impact: "Low",
          effort: "Medium",
          fix: "Add the focus keyword to one useful H2 or H3.",
        },
        2,
      );
    }

    if (!inImageAlt) {
      addIssue(
        {
          type: "focus_keyword_image_alt",
          category: "image",
          label: "Focus keyword in image alt",
          message: "Add an image with your Focus Keyword as alt text.",
          severity: "warning",
          impact: "Low",
          effort: "Low",
          fix: "Add the focus keyword to a relevant image alt text.",
        },
        2,
      );
    }

    keywords.slice(1).forEach((keyword, index) => {
      if (bodyLower.split(keyword).length - 1 === 0) {
        addIssue(
          {
            type: `secondary_keyword_${index + 1}`,
            category: "content",
            label: "Secondary keyword in content",
            message: `Secondary keyword "${keyword}" does not appear in the content.`,
            severity: "warning",
            impact: "Low",
            effort: "Low",
            fix: "Mention the secondary keyword naturally if it fits the article.",
          },
          3,
        );
      }
    });
  } else {
    addIssue(
      {
        type: "missing_focus_keyword",
        category: "on_page",
        label: "Missing focus keyword",
        message: "Set a Focus Keyword for this content.",
        severity: "critical",
        impact: "High",
        effort: "Low",
        fix: "Add one primary keyword in Blog Detail before running SEO scan.",
      },
      30,
    );
  }

  if (!config.addBlogSchema || (productCount > 0 && !config.addProductSchema)) {
    addIssue(
      {
        type: "schema_disabled",
        category: "schema",
        label: "Schema settings disabled",
        message: "Structured data can help eligible rich results.",
        severity: "info",
        impact: "Low",
        effort: "Low",
        fix: "Enable blog and product schema in Settings.",
      },
      3,
    );
  }

  return {
    score: calculateBlogDetailSeoScore(article, productCount, storedSeo, shopDomain, shopDomains),
    issues,
  };
}

function calculateBlogDetailSeoScore(
  article: ArticleInput,
  productCount: number,
  storedSeo?: StoredSeoInput | null,
  shopDomain?: string,
  shopDomains: string[] = [],
) {
  const title = getEffectiveSeoTitle(storedSeo?.metaTitle, article);
  const summary = getEffectiveSeoDescription(storedSeo?.metaDescription, article);
  return runSeoAudit({
    title,
    handle: article.handle || "",
    summary,
    body: article.body || "",
    hasImage: Boolean(article.imageUrl),
    imageAlt: article.imageAlt || "",
    productCount,
    focusKeyword: textValue(storedSeo?.focusKeyword),
    shopDomain,
    shopDomains,
  }).score;
}

function analyzeLinks(body: string, shopDomain?: string, shopDomains: string[] = []) {
  const stats = { internal: 0, external: 0, dofollowExternal: 0 };
  const shopHosts = buildShopHosts(shopDomain, shopDomains);
  const anchorRegex = /<a\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(body || "")) !== null) {
    const attrs = match[1] || "";
    const href = getHtmlAttribute(attrs, "href").trim();
    if (!href || /^(mailto:|tel:|sms:|javascript:)/i.test(href)) continue;

    const rel = getHtmlAttribute(attrs, "rel").toLowerCase();
    const isNoFollow = /\b(nofollow|sponsored|ugc)\b/i.test(rel);

    if (isInternalHref(href, shopHosts)) {
      stats.internal += 1;
    } else {
      stats.external += 1;
      if (!isNoFollow) stats.dofollowExternal += 1;
    }
  }

  return stats;
}

function getHtmlAttribute(attrs: string, name: string) {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[2] || match?.[3] || match?.[4] || "";
}

function isInternalHref(href: string, shopHosts: Set<string>) {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("/")) return true;

  try {
    const url = new URL(trimmed);
    const host = normalizeHost(url.hostname);
    return Array.from(shopHosts).some((shopHost) => host === shopHost || host.endsWith(`.${shopHost}`));
  } catch {
    return true;
  }
}

function buildShopHosts(shopDomain?: string, shopDomains: string[] = []) {
  const hosts = new Set<string>();

  [shopDomain, ...shopDomains].forEach((domain) => {
    const host = normalizeHost(domain || "");
    if (host) hosts.add(host);
  });

  return hosts;
}

function normalizeHost(value: string) {
  return value
    .replace(/^https?:\/\//i, "")
    .split(/[/?#]/)[0]
    .replace(/^www\./i, "")
    .toLowerCase();
}

function getHeadingTexts(body: string) {
  const headings: string[] = [];
  const headingRegex = /<h[2-6][^>]*>(.*?)<\/h[2-6]>/gi;
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(body || "")) !== null) {
    headings.push(stripHtml(match[1] || ""));
  }

  return headings;
}

function hasTableOfContents(body: string) {
  return /\[\[SBS_TOC(?::[^\]]+)?\]\]/i.test(body) || /data-bp-content-nav=["']toc["']|class=["'][^"']*\bbp-toc\b/i.test(body);
}

function getBodyImageAltText(body: string) {
  const alts: string[] = [];
  const imageRegex = /<img\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = imageRegex.exec(body || "")) !== null) {
    const alt = getHtmlAttribute(match[1] || "", "alt");
    if (alt) alts.push(alt);
  }

  return alts.join(" ");
}

function buildIssueGroups(posts: AuditedPost[]): IssueGroup[] {
  const map = new Map<string, IssueGroup>();

  posts.forEach((post) => {
    post.issues.forEach((issue) => {
      const group = map.get(issue.type) || {
        id: issue.type,
        category: issue.category,
        issue: issue.label,
        affected: 0,
        impact: issue.impact,
        effort: issue.effort,
        status: "Needs review",
        fix: issue.fix,
        actionLabel: getActionLabel(issue.category),
        examples: [],
        targetPostId: post.id,
        affectedPosts: [],
      };

      group.affected += 1;
      if (group.examples.length < 3) group.examples.push(post.title);
      group.affectedPosts.push({ id: post.id, title: post.title, blogTitle: post.blogTitle });
      map.set(issue.type, group);
    });
  });

  return Array.from(map.values()).sort(
    (a, b) => getImpactWeight(b.impact) - getImpactWeight(a.impact) || b.affected - a.affected || a.issue.localeCompare(b.issue),
  );
}

function getIssueStats(issueGroups: IssueGroup[]) {
  return issueGroups.reduce(
    (stats, issue) => {
      stats[issue.impact] += issue.affected;
      stats.total += issue.affected;
      return stats;
    },
    { High: 0, Medium: 0, Low: 0, total: 0 },
  );
}

function getAverageScore(posts: Array<{ score: number }>) {
  if (!posts.length) return 0;
  return Math.round(posts.reduce((sum, post) => sum + post.score, 0) / posts.length);
}

function getActionLabel(category: SeoCategory) {
  if (category === "product_linking") return "Add products";
  if (category === "image") return "Add alt text";
  if (category === "schema") return "Open settings";
  if (category === "content") return "Edit content";
  return "Review";
}

function getPostTarget(postId: string) {
  return `/app/blogs/${encodeURIComponent(postId)}`;
}

function getImpactWeight(impact: Impact) {
  if (impact === "High") return 3;
  if (impact === "Medium") return 2;
  return 1;
}

function getEffortMinutes(effort: Effort) {
  if (effort === "High") return 35;
  if (effort === "Medium") return 20;
  return 8;
}

function getImpactTone(impact: Impact) {
  if (impact === "High") return "critical";
  if (impact === "Medium") return "warning";
  return "success";
}

function getEffortTone(effort: Effort) {
  if (effort === "High") return "critical";
  if (effort === "Medium") return "warning";
  return "success";
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isLikelyStaleAutoMetaTitle(metaTitle: string, articleTitle: string) {
  const meta = metaTitle.trim();
  const title = articleTitle.trim();

  return Boolean(
    meta &&
      title &&
      meta.length <= 2 &&
      meta.length < title.length &&
      title.toLowerCase().startsWith(meta.toLowerCase()),
  );
}

function getEffectiveSeoTitle(metaTitle: unknown, article: ArticleInput) {
  const meta = textValue(metaTitle);
  const title = textValue(article.title);

  if (meta && !isLikelyStaleAutoMetaTitle(meta, title)) return meta;

  const shopifySeoTitle = textValue(article.seoTitle);
  if (shopifySeoTitle && !isLikelyStaleAutoMetaTitle(shopifySeoTitle, title)) return shopifySeoTitle;

  return title;
}

function getEffectiveSeoDescription(metaDescription: unknown, article: ArticleInput) {
  return textValue(metaDescription) || textValue(article.seoDescription) || textValue(article.summary);
}

function slugifyKeyword(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function links() {
  return [
    {
      rel: "stylesheet",
      href:
        "data:text/css," +
        encodeURIComponent(`
          .bp-seo-issue-table {
            max-width: 100%;
            overflow-x: auto;
            overflow-y: hidden;
          }
          .bp-seo-issue-table table {
            min-width: 940px;
          }
          .bp-seo-issue-cell {
            display: grid;
            gap: 2px;
            width: 300px;
            max-width: 300px;
            min-width: 0;
          }
          .bp-seo-fix-cell {
            width: 220px;
            max-width: 220px;
            min-width: 0;
          }
          .bp-seo-affected-post-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            padding: 12px 0;
            border-bottom: 1px solid var(--p-color-border-secondary);
          }
          .bp-seo-affected-post-row:last-child {
            border-bottom: 0;
          }
        `),
    },
  ];
}
