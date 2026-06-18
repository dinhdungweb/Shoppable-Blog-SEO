import { useEffect, useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useNavigate,
  useFetcher,
} from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  IndexTable,
  ProgressBar,
  useIndexResourceState,
  ChoiceList,
  Icon,
  Button,
  TextField,
  Select,
  Modal,
  Checkbox,
} from "@shopify/polaris";
import { 
  SearchIcon, 
  EditIcon, 
  AlertTriangleIcon, 
} from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

function parseMoney(value: string) {
  const number = Number((value || "0").replace(/[^0-9.]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  let blogs: any[] = [];
  let shopifyError: string | null = null;

  try {
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
    blogs = responseJson.data?.blogs?.nodes || [];
  } catch (error) {
    shopifyError = "Failed to load articles from Shopify.";
  }

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

  const embedCounts = await prisma.articleProduct.groupBy({
    by: ["articleId"],
    where: { shop, isActive: true },
    _count: { productId: true },
  });

  const embedCountMap = new Map(
    embedCounts.map((ec) => [ec.articleId, ec._count.productId]),
  );

  const seoData = await prisma.articleSEO.findMany({
    where: { shop },
    select: { articleId: true, seoScore: true },
  });
  const seoMap = new Map(seoData.map((seo) => [seo.articleId, seo.seoScore]));

  const clickCounts = await prisma.widgetEvent.groupBy({
    by: ["articleId"],
    where: { shop, eventType: "click" },
    _count: { id: true },
  });
  const clickMap = new Map(clickCounts.map((c) => [c.articleId, c._count.id]));

  const articleProducts = await prisma.articleProduct.findMany({
    where: { shop, isActive: true },
    select: { articleId: true, productId: true, productPrice: true }
  });
  const priceMap = new Map<string, number>();
  articleProducts.forEach(ap => {
    priceMap.set(`${ap.articleId}_${ap.productId}`, parseMoney(ap.productPrice || "0"));
  });

  const purchaseCounts = await prisma.widgetEvent.groupBy({
    by: ["articleId", "productId"],
    where: { shop, eventType: { in: ["purchase", "order"] } },
    _count: { id: true },
  });

  const revenueMap = new Map<string, number>();
  purchaseCounts.forEach(pc => {
    const key = `${pc.articleId}_${pc.productId}`;
    const price = priceMap.get(key) || 0;
    const rev = price * pc._count.id;
    const existingRev = revenueMap.get(pc.articleId) || 0;
    revenueMap.set(pc.articleId, existingRev + rev);
  });

  const finalArticles = articles.map((article) => ({
    ...article,
    productCount: embedCountMap.get(article.id) || 0,
    seoScore: seoMap.has(article.id) ? seoMap.get(article.id) : null,
    clicks: clickMap.get(article.id) || 0,
    revenue: revenueMap.get(article.id) || 0,
  }));

  const blogChoices = blogs.map((blog) => ({
    id: blog.id,
    title: blog.title,
    handle: blog.handle,
  }));

  return { articles: finalArticles, blogs: blogChoices, error: shopifyError, shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  
  const intent = formData.get("intent");

  if (intent === "bulk_draft" || intent === "bulk_publish") {
    const idsJson = formData.get("ids") as string;
    if (!idsJson) return json({ error: "No ids provided" }, { status: 400 });
    const ids = JSON.parse(idsJson);
    
    for (const id of ids) {
      await admin.graphql(
        `#graphql
        mutation UpdateArticle($id: ID!, $article: ArticleUpdateInput!) {
          articleUpdate(id: $id, article: $article) {
            article { id }
          }
        }`,
        {
          variables: {
            id,
            article: { isPublished: intent === "bulk_publish" },
          },
        }
      );
    }
    return json({ success: true, count: ids.length });
  }

  if (intent === "bulk_delete") {
    const idsJson = formData.get("ids") as string;
    if (!idsJson) return json({ error: "No ids provided" }, { status: 400 });
    const ids = JSON.parse(idsJson);
    
    for (const id of ids) {
      await admin.graphql(
        `#graphql
        mutation DeleteArticle($id: ID!) {
          articleDelete(id: $id) {
            deletedArticleId
          }
        }`,
        {
          variables: { id },
        }
      );
    }
    return json({ success: true, count: ids.length });
  }

  if (intent === "link_products") {
    const articleId = formData.get("articleId") as string;
    const articleTitle = formData.get("articleTitle") as string;
    const articleHandle = formData.get("articleHandle") as string;
    const blogId = formData.get("blogId") as string;
    const productsJson = formData.get("products") as string;

    if (!articleId || !productsJson) return json({ error: "Missing data" }, { status: 400 });

    const products = JSON.parse(productsJson);

    // Save each linked product to Prisma
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      await prisma.articleProduct.upsert({
        where: {
          articleId_blockId_productId: {
            articleId,
            blockId: "default",
            productId: product.id,
          },
        },
        update: {
          position: i,
          isActive: true,
        },
        create: {
          shop,
          articleId,
          articleTitle,
          articleHandle,
          blogId,
          blockId: "default",
          productId: product.id,
          productTitle: product.title,
          productHandle: product.handle,
          productImage: product.images?.[0]?.originalSrc || "",
          productPrice: "0",
          position: i,
        },
      });
    }

    return json({ success: true, linkedCount: products.length });
  }

  if (intent === "bulk_optimize_batch") {
    const idsJson = formData.get("ids") as string;
    const optionsJson = formData.get("options") as string;
    if (!idsJson || !optionsJson) return json({ error: "Missing data" }, { status: 400 });
    
    const ids = JSON.parse(idsJson);
    const options = JSON.parse(optionsJson);

    for (const id of ids) {
      const articleRes = await admin.graphql(`
        query GetArticle($id: ID!) {
          node(id: $id) {
            ... on Article {
              id
              title
              handle
              body
            }
          }
        }
      `, { variables: { id } });
      const articleParsed = await articleRes.json();
      const article = articleParsed.data?.node;
      
      if (!article) continue;
      
      let newHandle = article.handle;
      let newBodyHtml = article.body;
      
      if (options.alt_text && newBodyHtml) {
        newBodyHtml = newBodyHtml.replace(/<img\s+(?!.*alt=)[^>]*>/gi, (match: string) => {
          return match.replace('<img ', `<img alt="${article.title.replace(/"/g, '&quot;')}" `);
        });
      }
      
      if (options.url) {
        newHandle = article.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      }
      
      await admin.graphql(`
        mutation UpdateArticle($id: ID!, $article: ArticleUpdateInput!) {
          articleUpdate(id: $id, article: $article) {
            article { id }
            userErrors { field message }
          }
        }
      `, {
        variables: {
          id,
          article: {
            handle: newHandle,
            body: newBodyHtml
          }
        }
      });
      
      const metafields = [];
      if (options.meta_description && article.body) {
        const text = article.body.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().substring(0, 160);
        metafields.push({
          namespace: "global",
          key: "description_tag",
          type: "single_line_text_field",
          value: text || article.title
        });
      }
      
      if (options.title) {
        metafields.push({
          namespace: "global",
          key: "title_tag",
          type: "single_line_text_field",
          value: article.title.substring(0, 70)
        });
      }
      
      if (metafields.length > 0) {
        await admin.graphql(`
          mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields { id }
              userErrors { field message }
            }
          }
        `, {
          variables: {
            metafields: metafields.map((m: any) => ({ ...m, ownerId: id }))
          }
        });
      }
      
      // Respect rate limits slightly
      await new Promise(r => setTimeout(r, 200));
    }

    return json({ success_batch: true, count: ids.length });
  }

  return json({ error: "Invalid intent" }, { status: 400 });
};

const TabBadge = ({ label, count, isActive, onClick }: { label: string, count: number, isActive?: boolean, onClick?: () => void }) => (
  <div onClick={onClick} style={{ padding: '6px 12px', borderRadius: '8px', backgroundColor: isActive ? '#EBEBEB' : 'transparent', cursor: 'pointer', display: 'flex', gap: '8px', alignItems: 'center' }}>
    <Text as="span" variant="bodyMd" fontWeight={isActive ? 'semibold' : 'regular'}>{label}</Text>
    <Text as="span" variant="bodySm" tone="subdued">{count}</Text>
  </div>
);

export default function BlogManager() {
  const { articles } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  
  // Modals state
  const [isBulkOptimizeOpen, setIsBulkOptimizeOpen] = useState(false);
  const [isConfirmBulkOpen, setIsConfirmBulkOpen] = useState(false);

  // Bulk optimize chunking state
  const [optimizeTarget, setOptimizeTarget] = useState<string[]>(['all']);
  const [optimizeOptions, setOptimizeOptions] = useState({
    meta_description: true,
    alt_text: true,
    title: true,
    url: true,
    canonical_url: true
  });
  
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizedCount, setOptimizedCount] = useState(0);
  const [totalToOptimize, setTotalToOptimize] = useState(0);
  const [batchQueue, setBatchQueue] = useState<string[][]>([]);

  // Filters state
  const [searchValue, setSearchValue] = useState("");
  const [blogFilter, setBlogFilter] = useState("Blog");
  const [tabIndex, setTabIndex] = useState(0);

  // Sorting state
  const [sortValue, setSortValue] = useState("date_desc");

  // Pagination state
  const [page, setPage] = useState(1);

  // Data processing
  const uniqueBlogs = Array.from(new Set(articles.map((a: any) => a.blogTitle || 'Default'))).filter(Boolean);
  const blogOptions = ['Blog', ...uniqueBlogs.map(b => String(b))];
  
  const filteredArticles = articles.filter((article: any) => {
    if (searchValue && !article.title.toLowerCase().includes(searchValue.toLowerCase())) return false;
    
    const isPublished = !!article.publishedAt;
    
    const blogTitle = article.blogTitle || 'Default';
    if (blogFilter !== 'Blog' && blogTitle !== blogFilter) return false;

    if (tabIndex === 1 && !isPublished) return false;
    if (tabIndex === 2 && isPublished) return false;
    if (tabIndex === 3 && (article.seoScore !== null && article.seoScore >= 60)) return false;
    if (tabIndex === 4 && article.productCount > 0) return false;
    if (tabIndex === 5 && article.clicks < 100) return false;
    
    return true;
  });

  const sortedArticles = [...filteredArticles].sort((a: any, b: any) => {
    const timeA = new Date(a.publishedAt || 0).getTime();
    const timeB = new Date(b.publishedAt || 0).getTime();
    if (sortValue === 'date_desc') return timeB - timeA;
    if (sortValue === 'date_asc') return timeA - timeB;
    if (sortValue === 'title_asc') return a.title.localeCompare(b.title);
    if (sortValue === 'title_desc') return b.title.localeCompare(a.title);
    return 0;
  });

  const itemsPerPage = 10;
  const totalPages = Math.max(1, Math.ceil(sortedArticles.length / itemsPerPage));
  const paginatedArticles = sortedArticles.slice((page - 1) * itemsPerPage, page * itemsPerPage);

  const allCount = articles.length;
  const publishedCount = articles.filter((a: any) => a.publishedAt).length;
  const draftCount = articles.filter((a: any) => !a.publishedAt).length;
  const needsSeoCount = articles.filter((a: any) => a.seoScore === null || a.seoScore < 60).length;
  const noProductsCount = articles.filter((a: any) => !a.productCount).length;
  const highTrafficCount = articles.filter((a: any) => a.clicks >= 100).length;

  // Table selection state
  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } = useIndexResourceState(paginatedArticles as any);

  const selectedArticlesData = paginatedArticles.filter((a: any) => selectedResources.includes(a.id));
  const hasPublishedSelected = selectedArticlesData.some((a: any) => a.publishedAt);
  const hasDraftSelected = selectedArticlesData.some((a: any) => !a.publishedAt);

  const startOptimization = () => {
    let targetArticles = [];
    if (optimizeTarget[0] === 'selected') {
      targetArticles = articles.filter((a: any) => selectedResources.includes(a.id));
    } else if (optimizeTarget[0] === 'filtered') {
      targetArticles = filteredArticles;
    } else {
      targetArticles = articles;
    }

    if (targetArticles.length === 0) {
      shopify.toast.show('No posts found to optimize');
      return;
    }

    const CHUNK_SIZE = 5;
    const chunks = [];
    for (let i = 0; i < targetArticles.length; i += CHUNK_SIZE) {
      chunks.push(targetArticles.slice(i, i + CHUNK_SIZE).map((a: any) => a.id));
    }
    
    setBatchQueue(chunks);
    setTotalToOptimize(targetArticles.length);
    setOptimizedCount(0);
    setIsOptimizing(true);
    
    // submit first chunk
    const firstChunk = chunks[0];
    fetcher.submit(
      { intent: 'bulk_optimize_batch', ids: JSON.stringify(firstChunk), options: JSON.stringify(optimizeOptions) },
      { method: "POST" }
    );
  };

  useEffect(() => {
    if (isOptimizing && fetcher.state === 'idle' && fetcher.data && (fetcher.data as any).success_batch) {
      const remainingChunks = batchQueue.slice(1);
      setOptimizedCount(prev => prev + batchQueue[0].length);
      
      if (remainingChunks.length > 0) {
        setBatchQueue(remainingChunks);
        fetcher.submit(
          { intent: 'bulk_optimize_batch', ids: JSON.stringify(remainingChunks[0]), options: JSON.stringify(optimizeOptions) },
          { method: "POST" }
        );
      } else {
        setIsOptimizing(false);
        setBatchQueue([]);
        setIsBulkOptimizeOpen(false);
        shopify.toast.show('Bulk optimization completed');
        clearSelection();
        fetcher.load('/app/blogs');
      }
    }
  }, [batchQueue, clearSelection, fetcher, fetcher.data, fetcher.state, isOptimizing, optimizeOptions, shopify]);

  return (
    <Page fullWidth>
      <BlockStack gap="500">
        
        {/* HEADER */}
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text as="h1" variant="headingLg" fontWeight="bold">Blog Manager</Text>
            <Text as="p" variant="bodyMd" tone="subdued">Manage and optimize all your blog posts in one place.</Text>
          </BlockStack>
          <InlineStack gap="200">
            <Button disclosure>Import posts</Button>
            <Button onClick={() => setIsBulkOptimizeOpen(true)}>Bulk optimize</Button>
            <Button variant="primary" onClick={() => navigate("/app/blogs/new")}>Create post</Button>
          </InlineStack>
        </InlineStack>

        <Card padding="0">
          <BlockStack gap="0">
            {/* TABS & FILTERS COMBINED */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #EBEBEB', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              
              {/* TABS (Left) */}
              <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', flexWrap: 'nowrap' }}>
                <TabBadge label="All" count={allCount} isActive={tabIndex === 0} onClick={() => { setTabIndex(0); setPage(1); }} />
                <TabBadge label="Published" count={publishedCount} isActive={tabIndex === 1} onClick={() => { setTabIndex(1); setPage(1); }} />
                <TabBadge label="Draft" count={draftCount} isActive={tabIndex === 2} onClick={() => { setTabIndex(2); setPage(1); }} />
                <TabBadge label="Needs SEO" count={needsSeoCount} isActive={tabIndex === 3} onClick={() => { setTabIndex(3); setPage(1); }} />
                <TabBadge label="No products linked" count={noProductsCount} isActive={tabIndex === 4} onClick={() => { setTabIndex(4); setPage(1); }} />
                <TabBadge label="High traffic" count={highTrafficCount} isActive={tabIndex === 5} onClick={() => { setTabIndex(5); setPage(1); }} />
              </div>

              {/* FILTERS (Right) */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ width: '250px' }}>
                  <TextField labelHidden label="Search" prefix={<Icon source={SearchIcon} tone="subdued" />} placeholder="Search posts" value={searchValue} onChange={(v) => { setSearchValue(v); setPage(1); }} autoComplete="off" />
                </div>
                <Select labelHidden label="Blog" options={blogOptions} value={blogFilter} onChange={(v) => { setBlogFilter(v); setPage(1); }} />
                <Select labelHidden label="Sort" options={[{label: 'Newest', value: 'date_desc'}, {label: 'Oldest', value: 'date_asc'}, {label: 'A-Z', value: 'title_asc'}, {label: 'Z-A', value: 'title_desc'}]} value={sortValue} onChange={(v) => { setSortValue(v); setPage(1); }} />
              </div>

            </div>

            {/* TABLE */}
            <IndexTable
              resourceName={{ singular: 'post', plural: 'posts' }}
              itemCount={paginatedArticles.length}
              selectedItemsCount={allResourcesSelected ? 'All' : selectedResources.length}
              onSelectionChange={handleSelectionChange}
              pagination={totalPages > 1 ? {
                hasNext: page < totalPages,
                onNext: () => setPage(page + 1),
                hasPrevious: page > 1,
                onPrevious: () => setPage(page - 1),
                label: `Showing ${sortedArticles.length === 0 ? 0 : ((page - 1) * itemsPerPage) + 1} to ${Math.min(page * itemsPerPage, sortedArticles.length)} of ${sortedArticles.length} results`
              } : undefined}
              promotedBulkActions={[
                {
                  content: 'Bulk edit',
                  onAction: () => {
                    const ids = selectedResources.map(id => id.split('/').pop()).join(',');
                    navigate(`/app/blogs/bulk_edit?ids=${ids}`);
                  },
                },
                ...(hasPublishedSelected ? [{
                  content: 'Set as draft',
                  onAction: () => {
                    fetcher.submit({ intent: "bulk_draft", ids: JSON.stringify(selectedResources) }, { method: "POST" });
                    clearSelection();
                  },
                }] : []),
                ...(hasDraftSelected ? [{
                  content: 'Publish posts',
                  onAction: () => {
                    fetcher.submit({ intent: "bulk_publish", ids: JSON.stringify(selectedResources) }, { method: "POST" });
                    clearSelection();
                  },
                }] : []),
              ]}
              bulkActions={[
                {
                  content: 'Delete posts',
                  onAction: () => {
                    if (confirm("Are you sure you want to delete the selected posts?")) {
                      fetcher.submit({ intent: "bulk_delete", ids: JSON.stringify(selectedResources) }, { method: "POST" });
                      clearSelection();
                    }
                  },
                },
              ]}
              headings={[
                { title: 'Post title' },
                { title: 'Status' },
                { title: 'SEO score' },
                { title: 'Products linked' },
                { title: 'Clicks' },
                { title: 'Revenue' },
                { title: 'Updated' },
                { title: 'Actions', alignment: 'end' }
              ]}
              selectable={true}
            >
              {paginatedArticles.map((post: any, index: number) => {
                const seoScore = post.seoScore;
                return (
                <IndexTable.Row
                  id={post.id}
                  key={post.id}
                  position={index}
                  selected={selectedResources.includes(post.id)}
                  onClick={() => navigate(`/app/blogs/${encodeURIComponent(post.id)}`)}
                >
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">{post.title}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {post.publishedAt ? (
                      <div style={{ padding: '4px 10px', borderRadius: '100px', backgroundColor: '#E8F5E9', color: '#29845A', display: 'inline-block', fontSize: '12px', fontWeight: 'bold' }}>
                        Published
                      </div>
                    ) : (
                      <div style={{ padding: '4px 10px', borderRadius: '100px', backgroundColor: '#F4F6F8', color: '#5C5F62', display: 'inline-block', fontSize: '12px', fontWeight: 'bold' }}>
                        Draft
                      </div>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {seoScore !== null && seoScore !== undefined ? (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <Text as="span" variant="bodyMd" fontWeight="semibold">{seoScore}</Text>
                        <div style={{ width: '6px', height: '6px', borderRadius: '3px', backgroundColor: seoScore >= 80 ? '#29845A' : seoScore >= 60 ? '#B98900' : '#D82C0D' }} />
                      </div>
                    ) : (
                      <Text as="span" variant="bodyMd" fontWeight="semibold" tone="subdued">-</Text>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd">{post.productCount}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd">{post.clicks || 0}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd">{formatMoney(post.revenue || 0)}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd" tone="subdued">
                      {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString('vi-VN') : '-'}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="200" wrap={false} align="end">
                      <div style={{ cursor: 'pointer', padding: '6px', borderRadius: '4px' }} onClick={(e) => { e.stopPropagation(); navigate(`/app/blogs/${encodeURIComponent(post.id)}`); }}>
                        <Icon source={EditIcon} tone="base" />
                      </div>
                    </InlineStack>
                  </IndexTable.Cell>
                </IndexTable.Row>
                );
              })}
            </IndexTable>
          </BlockStack>
        </Card>
      </BlockStack>

      {/* MODAL 2: Bulk optimize */}
      <Modal 
        open={isBulkOptimizeOpen} 
        onClose={() => !isOptimizing && setIsBulkOptimizeOpen(false)} 
        title="Bulk optimize"
        primaryAction={{
          content: isOptimizing ? 'Optimizing...' : 'Optimize', 
          onAction: startOptimization,
          loading: isOptimizing,
          disabled: isOptimizing || (optimizeTarget[0] === 'selected' && selectedResources.length === 0)
        }}
        secondaryActions={[{
          content: 'Cancel', 
          onAction: () => setIsBulkOptimizeOpen(false),
          disabled: isOptimizing
        }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {isOptimizing ? (
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">Optimizing {optimizedCount} of {totalToOptimize} posts...</Text>
                <ProgressBar progress={(optimizedCount / totalToOptimize) * 100} tone="success" />
              </BlockStack>
            ) : (
              <>
                <Text as="p" variant="bodyMd">This will apply SEO optimizations to multiple posts.</Text>
                
                <BlockStack gap="200">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">Posts to optimize</Text>
                  <ChoiceList
                    titleHidden
                    title="Posts to optimize"
                    choices={[
                      {label: `All ${articles.length} posts`, value: 'all'},
                      {label: `Selected posts (${selectedResources.length})`, value: 'selected'},
                      {label: `Filtered posts (${filteredArticles.length})`, value: 'filtered'}
                    ]}
                    selected={optimizeTarget}
                    onChange={setOptimizeTarget}
                  />
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">Optimize</Text>
                  <Checkbox 
                    label="Add missing meta descriptions" 
                    checked={optimizeOptions.meta_description} 
                    onChange={(val) => setOptimizeOptions(prev => ({...prev, meta_description: val}))} 
                  />
                  <Checkbox 
                    label="Add image alt text" 
                    checked={optimizeOptions.alt_text} 
                    onChange={(val) => setOptimizeOptions(prev => ({...prev, alt_text: val}))} 
                  />
                  <Checkbox 
                    label="Optimize titles" 
                    checked={optimizeOptions.title} 
                    onChange={(val) => setOptimizeOptions(prev => ({...prev, title: val}))} 
                  />
                  <Checkbox 
                    label="Optimize URLs" 
                    checked={optimizeOptions.url} 
                    onChange={(val) => setOptimizeOptions(prev => ({...prev, url: val}))} 
                  />
                  <Checkbox 
                    label="Set canonical URLs" 
                    checked={optimizeOptions.canonical_url} 
                    onChange={(val) => setOptimizeOptions(prev => ({...prev, canonical_url: val}))} 
                  />
                </BlockStack>
              </>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>


      {/* MODAL 4: Confirm bulk action */}
      <Modal 
        open={isConfirmBulkOpen} 
        onClose={() => setIsConfirmBulkOpen(false)} 
        title="Confirm bulk action"
        primaryAction={{content: 'Continue', destructive: true, onAction: () => setIsConfirmBulkOpen(false)}}
        secondaryActions={[{content: 'Cancel', onAction: () => setIsConfirmBulkOpen(false)}]}
      >
        <Modal.Section>
           <BlockStack gap="400">
              <div style={{ padding: '16px', backgroundColor: '#FFF5EA', borderLeft: '3px solid #B98900', borderRadius: '4px' }}>
                <BlockStack gap="200">
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <div style={{ width: '20px' }}><Icon source={AlertTriangleIcon} tone="caution" /></div>
                    <Text as="p" variant="bodyMd" fontWeight="bold">You are about to optimize 23 posts.</Text>
                  </div>
                  <div style={{ paddingLeft: '28px' }}>
                    <Text as="p" variant="bodyMd">This action will:</Text>
                    <ul style={{ paddingLeft: '20px', margin: '8px 0', lineHeight: '2' }}>
                      <li><span style={{ color: '#29845A', fontWeight: 'bold', marginRight: '4px' }}>✓</span> Add or update meta descriptions</li>
                      <li><span style={{ color: '#29845A', fontWeight: 'bold', marginRight: '4px' }}>✓</span> Add missing image alt text</li>
                      <li><span style={{ color: '#29845A', fontWeight: 'bold', marginRight: '4px' }}>✓</span> Optimize titles and URLs</li>
                      <li><span style={{ color: '#29845A', fontWeight: 'bold', marginRight: '4px' }}>✓</span> Set canonical URLs</li>
                    </ul>
                  </div>
                  
                  <div style={{ backgroundColor: '#FFF5EA', padding: '12px', borderRadius: '4px', marginTop: '12px', border: '1px solid #FFE4B5' }}>
                     <InlineStack gap="200">
                       <Icon source={AlertTriangleIcon} tone="caution" />
                       <Text as="span" variant="bodyMd" tone="caution" fontWeight="semibold">This action cannot be undone.</Text>
                     </InlineStack>
                  </div>
                </BlockStack>
              </div>
           </BlockStack>
        </Modal.Section>
      </Modal>

    </Page>
  );
}
