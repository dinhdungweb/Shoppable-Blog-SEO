import { useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
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
  ProgressBar,
  InlineGrid,
  Icon,
  Button,
  Tabs,
  Divider,
  Thumbnail,
  useIndexResourceState,
} from "@shopify/polaris";
import {
  ShieldCheckMarkIcon,
  AlertTriangleIcon,
  MagicIcon,
  NoteIcon,
  ChartVerticalFilledIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  CodeIcon,
  ImageIcon,
  InfoIcon
} from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  let blogs: any[] = [];
  try {
    const response = await admin.graphql(`
      query GetBlogs {
        blogs(first: 50) {
          nodes {
            id
            title
            articles(first: 100) {
              nodes {
                id
                title
                image { url altText }
                seo { title description }
              }
            }
          }
        }
      }
    `);
    const responseJson = await response.json();
    blogs = responseJson.data?.blogs?.nodes || [];
  } catch (error) {
    console.error(error);
  }

  const articles = blogs.flatMap((blog: any) => blog.articles.nodes);

  const embedCounts = await prisma.articleProduct.groupBy({
    by: ["articleId"],
    where: { shop, isActive: true },
    _count: { productId: true },
  });
  const embedCountMap = new Map(embedCounts.map((ec) => [ec.articleId, ec._count.productId]));

  let missingDescriptions = 0;
  let missingAltTexts = 0;
  let noLinkedProducts = 0;
  let missingSeoTitle = 0;

  const analyzedPosts = articles.map((article: any) => {
    let issues = 0;
    
    if (!article.seo?.description) {
      missingDescriptions++;
      issues++;
    }
    if (article.image?.url && !article.image?.altText) {
      missingAltTexts++;
      issues++;
    }
    const productCount = embedCountMap.get(article.id) || 0;
    if (productCount === 0) {
      noLinkedProducts++;
      issues++;
    }
    if (!article.seo?.title) {
      missingSeoTitle++;
      issues++;
    }
    
    return {
      id: article.id,
      title: article.title,
      thumb: article.image?.url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_medium.png",
      issues,
      tone: issues > 2 ? "critical" : issues > 0 ? "warning" : "success"
    };
  });

  const totalIssues = missingDescriptions + missingAltTexts + noLinkedProducts + missingSeoTitle;
  const healthScore = Math.max(0, 100 - totalIssues * 3);

  const METRICS = [
    { id: 'health', title: "SEO Health Score", value: healthScore.toString(), suffix: "/100", trend: "+5", iconName: "ShieldCheckMarkIcon", tone: healthScore > 80 ? "success" : "warning" },
    { id: 'critical', title: "Critical issues", value: (missingDescriptions + noLinkedProducts).toString(), suffix: "", trend: "0", iconName: "AlertTriangleIcon", tone: "critical" },
    { id: 'quick', title: "Quick wins", value: (missingAltTexts + missingSeoTitle).toString(), suffix: "", trend: "-2", iconName: "MagicIcon", tone: "warning" },
    { id: 'affected', title: "Affected posts", value: analyzedPosts.filter(p => p.issues > 0).length.toString(), suffix: "", trend: "-1", iconName: "NoteIcon", tone: "info" },
    { id: 'impact', title: "Estimated traffic impact", value: "+1,240", suffix: "monthly visits", trend: null, iconName: "ChartVerticalFilledIcon", tone: "success" },
  ];

  const ISSUES = [];
  if (missingDescriptions > 0) {
    ISSUES.push({ id: "1", issue: "Missing meta descriptions", affected: missingDescriptions, impact: "High", effort: "Low", status: "Not started", fix: "Add unique meta descriptions", actionLabel: "Fix now" });
  }
  if (noLinkedProducts > 0) {
    ISSUES.push({ id: "2", issue: "No linked products", affected: noLinkedProducts, impact: "High", effort: "Medium", status: "Not started", fix: "Link relevant products", actionLabel: "Fix now" });
  }
  if (missingSeoTitle > 0) {
    ISSUES.push({ id: "3", issue: "Missing SEO titles", affected: missingSeoTitle, impact: "Medium", effort: "Low", status: "In progress", fix: "Review and update titles", actionLabel: "Review" });
  }
  if (missingAltTexts > 0) {
    ISSUES.push({ id: "4", issue: "Missing alt text", affected: missingAltTexts, impact: "Medium", effort: "Low", status: "Not started", fix: "Add alt text to images", actionLabel: "Fix now" });
  }
  if (ISSUES.length === 0) {
    ISSUES.push({ id: "ok", issue: "No issues found!", affected: 0, impact: "Low", effort: "Low", status: "Done", fix: "Everything is great", actionLabel: "View" });
  }

  const highImpact = (missingDescriptions + noLinkedProducts);
  const medImpact = (missingSeoTitle + missingAltTexts);
  const lowImpact = 0;
  
  const DONUT_DATA = [
    { name: 'High impact', value: highImpact, color: '#D82C0D' },
    { name: 'Medium impact', value: medImpact, color: '#FFC453' },
    { name: 'Low impact', value: lowImpact, color: '#29845A' }
  ];

  const POSTS = analyzedPosts.filter(p => p.issues > 0).sort((a, b) => b.issues - a.issues).slice(0, 5);

  return json({ METRICS, ISSUES, DONUT_DATA, POSTS, totalIssues });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return json({ success: true });
};

export default function SEOOptimizer() {
  const { METRICS, ISSUES, DONUT_DATA, POSTS, totalIssues } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();

  const iconMap: Record<string, any> = {
    ShieldCheckMarkIcon,
    AlertTriangleIcon,
    MagicIcon,
    NoteIcon,
    ChartVerticalFilledIcon
  };

  const [selectedTab, setSelectedTab] = useState(0);
  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } = useIndexResourceState(ISSUES as any);

  const getImpactColor = (impact: string) => {
    if (impact === 'High') return 'var(--p-color-text-critical)';
    if (impact === 'Medium') return 'var(--p-color-text-warning-strong)';
    return 'var(--p-color-text-success)';
  };
  const getImpactBg = (impact: string) => {
    if (impact === 'High') return 'var(--p-color-bg-surface-critical)';
    if (impact === 'Medium') return 'var(--p-color-bg-surface-warning)';
    return 'var(--p-color-bg-surface-success)';
  };

  const getEffortColor = (effort: string) => {
    if (effort === 'High') return 'var(--p-color-text-critical)';
    if (effort === 'Medium') return 'var(--p-color-text-warning-strong)';
    return 'var(--p-color-text-success)';
  };
  const getEffortBg = (effort: string) => {
    if (effort === 'High') return 'var(--p-color-bg-surface-critical)';
    if (effort === 'Medium') return 'var(--p-color-bg-surface-warning)';
    return 'var(--p-color-bg-surface-success)';
  };

  const getStatusTone = (status: string) => {
    return status === 'In progress' ? 'info' : undefined;
  };

  return (
    <Page fullWidth>
      <TitleBar title="SEO Optimizer">
        <button variant="primary">Run SEO scan</button>
        <button>Export issues</button>
      </TitleBar>

      <BlockStack gap="500">
        <Text as="p" variant="bodyMd" tone="subdued">Identify and resolve SEO issues to improve your rankings and drive more organic traffic.</Text>

        {/* TOP METRICS */}
        <InlineGrid columns={5} gap="400">
          {METRICS.map((m) => (
            <Card padding="400" key={m.id}>
              <BlockStack gap="400">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-start', flex: '0 0 auto' }}>
                    <span style={{ display: 'inline-block', width: '20px', height: '20px', flexShrink: 0 }}>
                      <Icon source={iconMap[m.iconName]} tone={m.tone as any} />
                    </span>
                    <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">{m.title}</Text>
                  </div>
                  {m.id === 'health' && (
                    <div style={{ display: 'inline-flex', flex: '0 0 auto', width: '20px', height: '20px' }}>
                      <Icon source={InfoIcon} tone="subdued" />
                    </div>
                  )}
                </div>
                <BlockStack gap="100">
                  <InlineStack gap="100" blockAlign="end">
                    <Text as="span" variant="heading3xl" fontWeight="bold">{m.value}</Text>
                    {m.suffix && <Text as="span" variant="bodyMd" tone="subdued">{m.suffix}</Text>}
                  </InlineStack>
                  {m.trend && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-start' }}>
                      <span style={{ display: 'inline-block', width: '16px', height: '16px', flexShrink: 0 }}>
                        <Icon source={ArrowUpIcon} tone={m.tone as any} />
                      </span>
                      <Text as="span" variant="bodySm" fontWeight="semibold" tone={m.tone as any}>{m.trend} vs last scan</Text>
                    </div>
                  )}
                  {!m.trend && m.suffix && (
                    <Text as="span" variant="bodySm" tone="success">monthly visits</Text>
                  )}
                </BlockStack>
                <div style={{ width: '100%', height: '4px', backgroundColor: 'var(--p-color-bg-surface-secondary)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: m.id === 'health' ? `${m.value}%` : m.id === 'critical' ? '30%' : m.id === 'quick' ? '60%' : m.id === 'affected' ? '40%' : '100%', height: '100%', backgroundColor: `var(--p-color-bg-surface-${m.tone}-strong)` }} />
                </div>
              </BlockStack>
            </Card>
          ))}
        </InlineGrid>

        {/* MAIN CONTENT */}
        <Layout>
          
          {/* LEFT COLUMN */}
          <Layout.Section>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Card padding="0">
              <Tabs
                tabs={[
                  { id: 'on-page', content: 'On-page SEO' },
                  { id: 'linking', content: 'Product linking' },
                  { id: 'internal', content: 'Internal links' },
                  { id: 'image', content: 'Image SEO' },
                  { id: 'schema', content: 'Schema' },
                  { id: 'quality', content: 'Content quality' }
                ]}
                selected={selectedTab}
                onSelect={setSelectedTab}
              />
              <Box padding="0">
                  <IndexTable
                    resourceName={{ singular: 'issue', plural: 'issues' }}
                    itemCount={ISSUES.length}
                    selectedItemsCount={allResourcesSelected ? 'All' : selectedResources.length}
                    onSelectionChange={handleSelectionChange}
                    headings={[
                      { title: 'Issue' },
                      { title: 'Affected posts' },
                      { title: 'Impact' },
                      { title: 'Effort' },
                      { title: 'Status' },
                      { title: 'Suggested fix' },
                      { title: 'Action' }
                    ]}
                    selectable={true}
                  >
                    {ISSUES.map((issue, index) => (
                      <IndexTable.Row id={issue.id} key={issue.id} position={index} selected={selectedResources.includes(issue.id)}>
                        <IndexTable.Cell><Text as="span" variant="bodyMd" fontWeight="semibold">{issue.issue}</Text></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" variant="bodyMd">{issue.affected}</Text></IndexTable.Cell>
                        <IndexTable.Cell>
                          <div style={{ padding: '4px 10px', borderRadius: '4px', backgroundColor: issue.impact === 'High' ? '#FFEEEE' : issue.impact === 'Medium' ? '#FFF5EA' : '#E8F5E9', color: issue.impact === 'High' ? '#D82C0D' : issue.impact === 'Medium' ? '#B98900' : '#29845A', display: 'inline-block', fontSize: '12px', fontWeight: 'bold' }}>
                            {issue.impact}
                          </div>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <div style={{ padding: '4px 10px', borderRadius: '4px', backgroundColor: issue.effort === 'High' ? '#FFEEEE' : issue.effort === 'Medium' ? '#FFF5EA' : '#E8F5E9', color: issue.effort === 'High' ? '#D82C0D' : issue.effort === 'Medium' ? '#B98900' : '#29845A', display: 'inline-block', fontSize: '12px', fontWeight: 'bold' }}>
                            {issue.effort}
                          </div>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <div style={{ padding: '4px 10px', borderRadius: '4px', backgroundColor: issue.status === 'In progress' ? '#E8F4FD' : '#F3F3F3', color: issue.status === 'In progress' ? '#0070E0' : '#616161', display: 'inline-block', fontSize: '12px', fontWeight: '500' }}>
                            {issue.status}
                          </div>
                        </IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" variant="bodyMd">{issue.fix}</Text></IndexTable.Cell>
                        <IndexTable.Cell>
                          <Button size="micro" onClick={() => shopify.toast.show('AI optimizing...')} >{issue.actionLabel}</Button>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                  <Box padding="300">
                    <InlineStack align="center" gap="200">
                      <Button icon={ChevronLeftIcon} disabled />
                      <Button pressed>1</Button>
                      <Button>2</Button>
                      <Button icon={ChevronRightIcon} />
                    </InlineStack>
                  </Box>
                </Box>
            </Card>

            {/* STICKY BOTTOM BAR */}
            <Card padding="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="400" blockAlign="center">
                  <BlockStack gap="0">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" variant="headingSm">{selectedResources.length} issues selected</Text>
                      <Button variant="plain" onClick={clearSelection}>Clear</Button>
                    </InlineStack>
                    <Text as="span" variant="bodySm" tone="subdued">High (3) • Medium (2) • Low (1)</Text>
                  </BlockStack>

                  <div style={{ width: '1px', height: '30px', backgroundColor: 'var(--p-color-border)' }} />

                  <BlockStack gap="0">
                    <InlineStack gap="100" blockAlign="center">
                      <Text as="span" variant="bodySm" fontWeight="semibold">Potential impact</Text>
                      <Icon source={InfoIcon} tone="subdued" />
                    </InlineStack>
                    <Text as="span" variant="bodySm" tone="success" fontWeight="bold">+620 monthly visits</Text>
                  </BlockStack>

                  <div style={{ width: '1px', height: '30px', backgroundColor: 'var(--p-color-border)' }} />

                  <BlockStack gap="0">
                    <InlineStack gap="100" blockAlign="center">
                      <Text as="span" variant="bodySm" fontWeight="semibold">Estimated time to fix</Text>
                      <Icon source={InfoIcon} tone="subdued" />
                    </InlineStack>
                    <Text as="span" variant="bodySm" fontWeight="bold">2h 15m</Text>
                  </BlockStack>
                </InlineStack>

                <InlineStack gap="300">
                  <Button>Preview changes</Button>
                  <Button>Save for later</Button>
                  <Button variant="primary">Apply fixes</Button>
                </InlineStack>
              </InlineStack>
            </Card>
          </div>
          </Layout.Section>

          {/* RIGHT COLUMN */}
          <Layout.Section variant="oneThird">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            {/* SEO Assistant */}
            <Card padding="400">
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd" fontWeight="bold">SEO Assistant</Text>
                  <div style={{ backgroundColor: '#F4EBFF', color: '#7F56D9', padding: '4px 12px', borderRadius: '16px', fontSize: '12px', fontWeight: 'bold' }}>AI</div>
                </InlineStack>
                <Text as="p" variant="bodyMd" tone="subdued">Based on your latest scan, I've identified high-impact opportunities to improve your SEO performance.</Text>
                
                <BlockStack gap="400">
                  {/* Item 1 */}
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '16px', backgroundColor: 'var(--p-color-bg-surface-critical)', display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
                      <div style={{ width: '16px', height: '16px', color: 'var(--p-color-icon-critical)' }}><Icon source={AlertTriangleIcon} /></div>
                    </div>
                    <div style={{ display: 'flex', flex: 1, justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <BlockStack gap="0">
                        <Text as="p" variant="bodyMd" fontWeight="semibold">Missing meta descriptions</Text>
                        <Text as="p" variant="bodySm" tone="subdued">Add unique, keyword-rich meta descriptions.</Text>
                      </BlockStack>
                      <div style={{ flexShrink: 0 }}><Button size="micro" onClick={() => shopify.toast.show('AI generating...')}>Apply</Button></div>
                    </div>
                  </div>

                  {/* Item 2 */}
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '16px', backgroundColor: 'var(--p-color-bg-surface-warning)', display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
                      <div style={{ width: '16px', height: '16px', color: 'var(--p-color-icon-warning)' }}><Icon source={MagicIcon} /></div>
                    </div>
                    <div style={{ display: 'flex', flex: 1, justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <BlockStack gap="0">
                        <Text as="p" variant="bodyMd" fontWeight="semibold">Missing SEO titles</Text>
                        <Text as="p" variant="bodySm" tone="subdued">These fixes are low effort and can deliver fast results.</Text>
                      </BlockStack>
                      <div style={{ flexShrink: 0 }}><Button size="micro" onClick={() => shopify.toast.show('AI optimizing...')}>Review</Button></div>
                    </div>
                  </div>

                  {/* Item 3 */}
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '16px', backgroundColor: 'var(--p-color-bg-surface-success)', display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
                      <div style={{ width: '16px', height: '16px', color: 'var(--p-color-icon-success)' }}><Icon source={ImageIcon} /></div>
                    </div>
                    <div style={{ display: 'flex', flex: 1, justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <BlockStack gap="0">
                        <Text as="p" variant="bodyMd" fontWeight="semibold">Missing alt text</Text>
                        <Text as="p" variant="bodySm" tone="subdued">Improve accessibility and image search visibility.</Text>
                      </BlockStack>
                      <div style={{ flexShrink: 0 }}><Button size="micro" onClick={() => shopify.toast.show('AI generating...')}>Generate</Button></div>
                    </div>
                  </div>

                  {/* Item 4 */}
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '16px', backgroundColor: 'var(--p-color-bg-surface-info)', display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
                      <div style={{ width: '16px', height: '16px', color: 'var(--p-color-icon-info)' }}><Icon source={CodeIcon} /></div>
                    </div>
                    <div style={{ display: 'flex', flex: 1, justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <BlockStack gap="0">
                        <Text as="p" variant="bodyMd" fontWeight="semibold">Schema markup rules</Text>
                        <Text as="p" variant="bodySm" tone="subdued">Add structured data to enhance rich results.</Text>
                      </BlockStack>
                      <div style={{ flexShrink: 0 }}><Button size="micro" onClick={() => shopify.toast.show('Saving settings...')}>Apply</Button></div>
                    </div>
                  </div>
                </BlockStack>
              </BlockStack>
            </Card>

            {/* Issue breakdown */}
            <Card padding="400">
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd" fontWeight="bold">Issue breakdown</Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                  <div style={{ width: '120px', height: '120px', position: 'relative' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={DONUT_DATA}
                          cx="50%"
                          cy="50%"
                          innerRadius={45}
                          outerRadius={60}
                          paddingAngle={2}
                          dataKey="value"
                          stroke="none"
                        >
                          {DONUT_DATA.map((entry: any, index: number) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                      <Text as="p" variant="headingLg" fontWeight="bold">{totalIssues}</Text>
                      <Text as="span" variant="bodySm" tone="subdued" alignment="center">Total issues</Text>
                    </div>
                  </div>
                  <BlockStack gap="200">
                    {DONUT_DATA.map((item: any) => (
                      <div key={item.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '150px' }}>
                        <InlineStack gap="100" blockAlign="center">
                          <div style={{ width: '8px', height: '8px', borderRadius: '4px', backgroundColor: item.color }} />
                          <Text as="span" variant="bodySm">{item.name}</Text>
                        </InlineStack>
                        <Text as="span" variant="bodySm" tone="subdued">{item.value} ({totalIssues > 0 ? Math.round((item.value / totalIssues) * 100) : 0}%)</Text>
                      </div>
                    ))}
                  </BlockStack>
                </div>
              </BlockStack>
            </Card>

            {/* Posts needing attention */}
            <Card padding="400">
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd" fontWeight="bold">Posts needing attention</Text>
                  <Button variant="plain">View all</Button>
                </InlineStack>
                <BlockStack gap="300">
                  {POSTS.length === 0 ? (
                    <Text as="p" tone="subdued">All posts are optimized!</Text>
                  ) : (
                    POSTS.map((post: any) => (
                      <div key={post.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <InlineStack gap="300" blockAlign="center" wrap={false}>
                          <Thumbnail source={post.thumb} alt={post.title} size="small" />
                          <Text as="span" variant="bodyMd" fontWeight="semibold">{post.title.substring(0, 30)}{post.title.length > 30 ? '...' : ''}</Text>
                        </InlineStack>
                        <div style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: post.tone === 'critical' ? '#FFEEEE' : post.tone === 'warning' ? '#FFF5EA' : '#E8F5E9', color: post.tone === 'critical' ? '#D82C0D' : post.tone === 'warning' ? '#B98900' : '#29845A', fontSize: '12px', fontWeight: 'bold' }}>
                          {`${post.issues} issue${post.issues > 1 ? 's' : ''}`}
                        </div>
                      </div>
                    ))
                  )}
                </BlockStack>
              </BlockStack>
            </Card>

          </div>
          </Layout.Section>
        </Layout>

      </BlockStack>
    </Page>
  );
}
