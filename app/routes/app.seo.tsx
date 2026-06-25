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
  CheckIcon,
  CodeIcon,
  ImageIcon,
  MagicIcon,
  NoteIcon,
  ProductIcon,
  SearchIcon,
  ShieldCheckMarkIcon,
} from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

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
  seoTitle: string;
  seoDescription: string;
  blogId: string;
  blogTitle: string;
  blogHandle: string;
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
      const audit = auditArticle(article, productCount, config);
      const stored = storedSeoMap.get(article.id);

      return {
        ...article,
        productCount,
        score: stored?.seoScore ?? audit.score,
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

  const [articles, linkedProducts, config] = await Promise.all([
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
  ]);

  const productCountMap = new Map<string, number>();
  linkedProducts.forEach((product) => {
    productCountMap.set(product.articleId, (productCountMap.get(product.articleId) || 0) + 1);
  });

  const audits = articles.map((article) => {
    const audit = auditArticle(article, productCountMap.get(article.id) || 0, config);
    return { article, audit };
  });

  await Promise.all(
    audits.map(({ article, audit }) =>
      prisma.articleSEO.upsert({
        where: { articleId: article.id },
        update: {
          shop,
          articleTitle: article.title,
          seoScore: audit.score,
          metaTitle: article.seoTitle || null,
          metaDescription: article.seoDescription || null,
          issues: JSON.stringify(audit.issues),
          lastAnalyzedAt: new Date(),
        },
        create: {
          shop,
          articleId: article.id,
          articleTitle: article.title,
          seoScore: audit.score,
          metaTitle: article.seoTitle || null,
          metaDescription: article.seoDescription || null,
          issues: JSON.stringify(audit.issues),
          lastAnalyzedAt: new Date(),
        },
      }),
    ),
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
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd" fontWeight="bold">
                      SEO Assistant
                    </Text>
                    <Badge tone="attention">Coming soon</Badge>
                  </InlineStack>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    AI guidance is not connected yet. The recommendations below are rule-based from the current scan and linked product data.
                  </Text>
                  <BlockStack gap="300">
                    {issueGroups.slice(0, 4).map((issue) => (
                      <AssistantItem key={issue.id} issue={issue} onAction={() => handleIssueAction(issue)} />
                    ))}
                    {!issueGroups.length && (
                      <InlineStack gap="200" blockAlign="center">
                        <Icon source={CheckIcon} tone="success" />
                        <Text as="p" variant="bodyMd">
                          No SEO issues found right now.
                        </Text>
                      </InlineStack>
                    )}
                  </BlockStack>
                </BlockStack>
              </Card>

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

function AssistantItem({ issue, onAction }: { issue: IssueGroup; onAction: () => void }) {
  const icon = issue.category === "product_linking" ? ProductIcon : issue.category === "image" ? ImageIcon : issue.category === "schema" ? CodeIcon : issue.category === "content" ? NoteIcon : SearchIcon;

  return (
    <InlineStack gap="300" blockAlign="center" wrap={false}>
      <Box background={`bg-surface-${getImpactSurface(issue.impact)}` as any} padding="150" borderRadius="100">
        <Icon source={icon} tone={getImpactTone(issue.impact)} />
      </Box>
      <div style={{ flex: 1, minWidth: 0 }}>
        <BlockStack gap="050">
          <Text as="p" variant="bodyMd" fontWeight="semibold" truncate>
            {issue.issue}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {issue.fix}
          </Text>
        </BlockStack>
      </div>
      <Button size="micro" onClick={onAction}>
        {issue.actionLabel}
      </Button>
    </InlineStack>
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
      seoTitle: article.seoTitle?.value || "",
      seoDescription: article.seoDescription?.value || "",
      blogId: article.blog?.id || blog.id,
      blogTitle: article.blog?.title || blog.title || "Blog",
      blogHandle: article.blog?.handle || blog.handle || "",
    })),
  );
}

function auditArticle(article: ArticleInput, productCount: number, config: { addBlogSchema?: boolean; addProductSchema?: boolean }) {
  const issues: SeoIssue[] = [];
  let score = 100;
  const seoTitle = article.seoTitle.trim();
  const seoDescription = article.seoDescription.trim();
  const bodyText = stripHtml(`${article.summary || ""} ${article.body || ""}`);
  const wordCount = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;

  const addIssue = (issue: SeoIssue, penalty: number) => {
    issues.push(issue);
    score -= penalty;
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

  if (wordCount > 0 && wordCount < 300) {
    addIssue(
      {
        type: "thin_content",
        category: "content",
        label: "Thin content",
        message: "Short posts can be harder to rank for competitive topics.",
        severity: "warning",
        impact: "Medium",
        effort: "Medium",
        fix: "Add more useful sections, examples, or product context.",
      },
      8,
    );
  }

  if (article.body && !/<h[2-6][^>]*>/i.test(article.body)) {
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
    score: Math.max(0, Math.min(100, Math.round(score))),
    issues,
  };
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

function getImpactSurface(impact: Impact) {
  if (impact === "High") return "critical";
  if (impact === "Medium") return "warning";
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
