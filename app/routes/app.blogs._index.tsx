import { useEffect, useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Link,
  Outlet,
  useLoaderData,
  useNavigate,
  useParams,
  useFetcher,
} from "@remix-run/react";
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
  Banner,
  Layout,
  Icon,
  Button,
  TextField,
  Select,
  Modal,
  Checkbox
} from "@shopify/polaris";
import { 
  SearchIcon, 
  SortIcon, 
  EditIcon, 
  MenuIcon, 
  ImageIcon, 
  AlertTriangleIcon, 
  CheckIcon 
} from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

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

  const finalArticles = articles.map((article) => ({
    ...article,
    productCount: embedCountMap.get(article.id) || 0,
  }));

  return { articles: finalArticles, error: shopifyError, shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  
  const intent = formData.get("intent");

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

  return json({ error: "Invalid intent" }, { status: 400 });
};

const TabBadge = ({ label, count, isActive }: { label: string, count: number, isActive?: boolean }) => (
  <div style={{ padding: '6px 12px', borderRadius: '8px', backgroundColor: isActive ? '#EBEBEB' : 'transparent', cursor: 'pointer', display: 'flex', gap: '8px', alignItems: 'center' }}>
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
  const [isCreatePostOpen, setIsCreatePostOpen] = useState(false);
  const [isBulkOptimizeOpen, setIsBulkOptimizeOpen] = useState(false);
  const [isConfirmBulkOpen, setIsConfirmBulkOpen] = useState(false);

  // Table selection state
  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } = useIndexResourceState(articles as any);

  // Pagination state (visual only)
  const [page, setPage] = useState(1);

  const handleLinkProducts = async (article: any) => {
    const selected = await shopify.resourcePicker({ type: 'product', multiple: true, action: 'select' });
    if (selected && selected.length > 0) {
      const formData = new FormData();
      formData.append('intent', 'link_products');
      formData.append('articleId', article.id);
      formData.append('articleTitle', article.title);
      formData.append('articleHandle', article.handle);
      formData.append('blogId', article.blogId);
      formData.append('products', JSON.stringify(selected));

      fetcher.submit(formData, { method: 'post' });
      shopify.toast.show('Products linked successfully');
    }
  };

  return (
    <Page fullWidth>
      <BlockStack gap="500">
        
        {/* HEADER */}
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text as="h1" variant="headingLg" fontWeight="bold">Blog Manager</Text>
            <Text as="p" variant="bodyMd" tone="subdued">Manage and optimize all your blog posts in one place.</Text>
          </BlockStack>
          <InlineStack gap="300">
            <Button disclosure>Import posts</Button>
            <Button onClick={() => setIsBulkOptimizeOpen(true)}>Bulk optimize</Button>
            <Button variant="primary" onClick={() => setIsCreatePostOpen(true)}>Create post</Button>
          </InlineStack>
        </InlineStack>

        <Card padding="0">
          <BlockStack gap="0">
            {/* TABS */}
            <div style={{ padding: '16px', borderBottom: '1px solid #EBEBEB' }}>
              <InlineStack gap="200" wrap={false}>
                <TabBadge label="All" count={128} isActive={true} />
                <TabBadge label="Published" count={92} />
                <TabBadge label="Draft" count={16} />
                <TabBadge label="Needs SEO" count={23} />
                <TabBadge label="No products linked" count={15} />
                <TabBadge label="High traffic" count={12} />
              </InlineStack>
            </div>

            {/* FILTERS */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #EBEBEB' }}>
              <InlineStack align="space-between" blockAlign="center" wrap={false}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <div style={{ width: '250px' }}>
                    <TextField labelHidden label="Search" prefix={<Icon source={SearchIcon} tone="subdued" />} placeholder="Search posts" value="" onChange={() => {}} autoComplete="off" />
                  </div>
                  <Select labelHidden label="Status" options={['Status']} value="Status" onChange={() => {}} />
                  <Select labelHidden label="SEO score" options={['SEO score']} value="SEO score" onChange={() => {}} />
                  <Select labelHidden label="Product linked" options={['Product linked']} value="Product linked" onChange={() => {}} />
                  <Select labelHidden label="Blog" options={['Blog']} value="Blog" onChange={() => {}} />
                </div>
                <InlineStack gap="200">
                  <Button>More filters</Button>
                  <Button icon={SortIcon}>Sort</Button>
                </InlineStack>
              </InlineStack>
            </div>

            {/* TABLE */}
            <IndexTable
              resourceName={{ singular: 'post', plural: 'posts' }}
              itemCount={articles.length}
              selectedItemsCount={allResourcesSelected ? 'All' : selectedResources.length}
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: 'Post title' },
                { title: 'Status' },
                { title: 'SEO score' },
                { title: 'Products linked' },
                { title: 'Clicks' },
                { title: 'Revenue' },
                { title: 'Updated' },
                { title: 'Actions' }
              ]}
              selectable={true}
            >
              {articles.map((post: any, index: number) => {
                const seoScore = post.seoScore || 0;
                return (
                <IndexTable.Row
                  id={post.id}
                  position={index}
                  selected={selectedResources.includes(post.id)}
                  onClick={() => navigate(`/app/blogs/${encodeURIComponent(post.id)}`)}
                >
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">{post.title}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <div style={{ padding: '4px 10px', borderRadius: '4px', backgroundColor: '#E8F5E9', color: '#29845A', display: 'inline-block', fontSize: '12px', fontWeight: 'bold' }}>
                      Published
                    </div>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">{seoScore || '-'}</Text>
                      <div style={{ width: '6px', height: '6px', borderRadius: '3px', backgroundColor: seoScore >= 80 ? '#29845A' : seoScore >= 60 ? '#B98900' : '#D82C0D' }} />
                    </div>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd">{post.productCount || 0}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd">{post.clicks || 0}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd">{post.revenue || '$0'}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd">{new Date(post.publishedAt || Date.now()).toLocaleDateString()}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <div onClick={(e) => e.stopPropagation()}>
                      <InlineStack gap="100">
                        <Button icon={EditIcon} size="micro" onClick={() => navigate(`/app/blogs/${encodeURIComponent(post.id)}`)} />
                        <Button icon={MenuIcon} size="micro" onClick={() => handleLinkProducts(post)} />
                      </InlineStack>
                    </div>
                  </IndexTable.Cell>
                </IndexTable.Row>
              )})}
            </IndexTable>

            {/* PAGINATION */}
            <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text as="span" variant="bodySm" tone="subdued">Showing 1 to 8 of 128 results</Text>
              <div style={{ display: 'flex', gap: '4px' }}>
                <Button size="micro" disabled>‹</Button>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', backgroundColor: '#F3F3F3', borderRadius: '4px', fontSize: '14px', fontWeight: '500' }}>1</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', fontSize: '14px' }}>2</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', fontSize: '14px' }}>3</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', fontSize: '14px' }}>...</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', fontSize: '14px' }}>16</div>
                <Button size="micro">›</Button>
              </div>
            </div>
          </BlockStack>
        </Card>
      </BlockStack>

      {/* MODAL 1: Create post */}
      <Modal 
        open={isCreatePostOpen} 
        onClose={() => setIsCreatePostOpen(false)} 
        title="Create post"
        primaryAction={{content: 'Create post', onAction: () => setIsCreatePostOpen(false)}}
        secondaryActions={[{content: 'Cancel', onAction: () => setIsCreatePostOpen(false)}]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Select label="Blog" options={['News & Articles']} value="News & Articles" onChange={() => {}} />
            <TextField label="Title" placeholder="e.g. How to choose the perfect ring" value="" onChange={() => {}} autoComplete="off" />
            <BlockStack gap="200">
              <Text as="span" variant="bodyMd">Content</Text>
              <div style={{ border: '1px solid #C9CCCF', borderRadius: '4px' }}>
                <div style={{ padding: '8px', borderBottom: '1px solid #C9CCCF', display: 'flex', gap: '16px', alignItems: 'center' }}>
                   <span style={{fontWeight: 'bold', fontSize: '14px'}}>Paragraph <Icon source={SortIcon} tone="base" /></span>
                   <div style={{ display: 'flex', gap: '12px', fontWeight: 'bold' }}>
                     <span>B</span>
                     <span style={{fontStyle: 'italic'}}>I</span>
                     <span style={{textDecoration: 'underline'}}>U</span>
                   </div>
                </div>
                <div style={{ padding: '16px', color: '#6D7175', height: '120px' }}>Start writing your post...</div>
              </div>
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* MODAL 2: Bulk optimize */}
      <Modal 
        open={isBulkOptimizeOpen} 
        onClose={() => setIsBulkOptimizeOpen(false)} 
        title="Bulk optimize"
        primaryAction={{content: 'Optimize', onAction: () => { setIsBulkOptimizeOpen(false); setIsConfirmBulkOpen(true); }}}
        secondaryActions={[{content: 'Cancel', onAction: () => setIsBulkOptimizeOpen(false)}]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" variant="bodyMd">This will apply SEO optimizations to multiple posts.</Text>
            
            <BlockStack gap="200">
              <Text as="span" variant="bodyMd" fontWeight="semibold">Posts to optimize</Text>
              <ChoiceList
                titleHidden
                title="Posts to optimize"
                choices={[
                  {label: 'All 128 posts', value: 'all'},
                  {label: 'Selected posts (3)', value: 'selected'},
                  {label: 'Filtered posts (23)', value: 'filtered'}
                ]}
                selected={['all']}
                onChange={() => {}}
              />
            </BlockStack>

            <BlockStack gap="200">
              <Text as="span" variant="bodyMd" fontWeight="semibold">Optimize</Text>
              <Checkbox label="Add missing meta descriptions" checked={true} onChange={() => {}} />
              <Checkbox label="Add image alt text" checked={true} onChange={() => {}} />
              <Checkbox label="Optimize titles" checked={true} onChange={() => {}} />
              <Checkbox label="Optimize URLs" checked={true} onChange={() => {}} />
              <Checkbox label="Set canonical URLs" checked={true} onChange={() => {}} />
            </BlockStack>
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
