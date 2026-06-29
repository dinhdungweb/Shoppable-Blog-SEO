import fs from 'fs';

const oldFile = fs.readFileSync('app/routes/app.blogs.$blogId.tsx', 'utf-8');

// Extract imports
const imports = `import { useCallback, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate, useSubmit } from "@remix-run/react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack, Box, Badge, Button,
  Divider, Thumbnail, Modal, Select, EmptyState, ProgressBar, InlineGrid,
  Icon, ButtonGroup, Tabs, TextField, Checkbox, ChoiceList, IndexTable
} from "@shopify/polaris";
import {
  DeleteIcon, EditIcon, ImageIcon, ProductIcon, ArrowUpIcon, ArrowDownIcon,
  CheckIcon, ExternalIcon, XIcon, SortIcon, LinkIcon, CashDollarIcon, AlertCircleIcon, ViewIcon
} from "@shopify/polaris-icons";
import { useAppBridge, TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
`;

// Extract loader and action
const loaderMatch = oldFile.match(/export const loader = async.*?};\n};\n/s);
const actionMatch = oldFile.match(/export const action = async.*?};\n};\n/s);

// Note: Because I already added the extra `};` manually, the regex should just match everything up to `export default function`.
const codeBeforeComponent = oldFile.split('export default function ArticleDetail()')[0];

const componentStr = `
export default function ArticleDetail() {
  const { article, embeddedProducts, seoData, stats } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();

  const [selectedTab, setSelectedTab] = useState(0);
  const [showStyleModal, setShowStyleModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState("card");

  // Form states
  const [title, setTitle] = useState(article.title || "");
  const [handle, setHandle] = useState(article.handle || "");
  const [excerpt, setExcerpt] = useState("Learn expert tips on how to style silver rings for any occasion. From minimal looks to statement stacking, find your perfect style.");
  const [isDirty, setIsDirty] = useState(false);

  const handleTitleChange = (val: string) => { setTitle(val); setIsDirty(true); };
  const handleHandleChange = (val: string) => { setHandle(val); setIsDirty(true); };
  const handleExcerptChange = (val: string) => { setExcerpt(val); setIsDirty(true); };

  const isSubmitting = fetcher.state !== "idle";
  const seoScore = (fetcher.data as any)?.score ?? seoData?.seoScore ?? 82;

  const handleAddProducts = useCallback(async () => {
    try {
      const selected = await shopify.resourcePicker({ type: "product", multiple: true, action: "select" });
      if (selected && selected.length > 0) {
        const products = selected.map((product: any) => ({
          id: product.id, title: product.title, handle: product.handle,
          images: product.images, variants: product.variants,
        }));
        fetcher.submit({
          intent: "add_products", products: JSON.stringify(products),
          articleTitle: article.title, articleHandle: article.handle, blogId: article.blog.id,
        }, { method: "POST" });
        shopify.toast.show("Products added");
      }
    } catch (error) { console.error("Resource picker error:", error); }
  }, [shopify, fetcher, article]);

  const handleRemoveProduct = (productId: string) => fetcher.submit({ intent: "remove_product", productId }, { method: "POST" });

  const handleMoveProduct = (index: number, direction: 'up' | 'down') => {
    if (
      (direction === 'up' && index === 0) ||
      (direction === 'down' && index === embeddedProducts.length - 1)
    ) return;
    
    const newProducts = [...embeddedProducts];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    [newProducts[index], newProducts[targetIndex]] = [newProducts[targetIndex], newProducts[index]];
    
    fetcher.submit({
      intent: "reorder",
      order: JSON.stringify(newProducts.map(p => p.productId)),
    }, { method: "POST" });
  };

  const tabs = [
    { id: "content", content: "Content" },
    { id: "products", content: "Products", badge: embeddedProducts.length.toString() },
    { id: "seo", content: "SEO", badge: "2" },
    { id: "performance", content: "Performance" },
    { id: "history", content: "History" },
  ];

  return (
    <Page
      backAction={{ content: "Blog Manager", url: "/app/blogs" }}
      title={article.title}
      titleMetadata={<Badge tone="success">Published</Badge>}
      primaryAction={{ content: "Update post", onAction: () => { setIsDirty(false); shopify.toast.show("Saved successfully"); } }}
      secondaryActions={[
        { content: "Run SEO scan", onAction: () => fetcher.submit({ intent: "analyze_seo", articleTitle: article.title, seoTitle: article.seo?.title || "", seoDescription: article.seo?.description || "", body: article.body || "", hasImage: article.image ? "true" : "false" }, { method: "POST" }) },
        { content: "Preview post", url: \`shopify:admin/articles/\${article.id.split("/").pop()}\` }
      ]}
      fullWidth
    >
      <BlockStack gap="500">
        
        {/* STATS ROW */}
        <InlineGrid columns={{xs: 1, sm: 2, md: 5}} gap="300">
          <Card padding="300">
            <InlineStack align="space-between" blockAlign="start">
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">Status</Text>
                <Text as="p" variant="headingMd" tone="success">Published</Text>
              </BlockStack>
              <div style={{ padding: '8px', backgroundColor: '#E8F5E9', borderRadius: '4px' }}>
                <Icon source={ViewIcon} tone="success" />
              </div>
            </InlineStack>
          </Card>
          
          <Card padding="300">
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="start">
                <Text as="span" variant="bodySm" tone="subdued">SEO score</Text>
                <div style={{ padding: '8px', backgroundColor: '#EBF9FC', borderRadius: '4px' }}>
                  <Icon source={SortIcon} tone="info" />
                </div>
              </InlineStack>
              <InlineStack gap="200" blockAlign="center">
                <Text as="p" variant="headingMd" fontWeight="bold">{seoScore}</Text>
                <Text as="span" variant="bodySm" tone="subdued">/100</Text>
              </InlineStack>
              <ProgressBar progress={seoScore} tone={seoScore >= 80 ? "success" : "warning"} />
            </BlockStack>
          </Card>

          <Card padding="300">
            <InlineStack align="space-between" blockAlign="start">
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">Products linked</Text>
                <Text as="p" variant="headingMd" fontWeight="bold">{embeddedProducts.length}</Text>
              </BlockStack>
              <div style={{ padding: '8px', backgroundColor: '#EBF9FC', borderRadius: '4px' }}>
                <Icon source={LinkIcon} tone="info" />
              </div>
            </InlineStack>
          </Card>

          <Card padding="300">
            <InlineStack align="space-between" blockAlign="start">
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">Product clicks</Text>
                <Text as="p" variant="headingMd" fontWeight="bold">{stats.clicks}</Text>
              </BlockStack>
              <div style={{ padding: '8px', backgroundColor: '#F4F0FF', borderRadius: '4px' }}>
                <Icon source={CheckIcon} tone="magic" />
              </div>
            </InlineStack>
          </Card>

          <Card padding="300">
            <InlineStack align="space-between" blockAlign="start">
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">Revenue</Text>
                <Text as="p" variant="headingMd" fontWeight="bold">$430</Text>
              </BlockStack>
              <div style={{ padding: '8px', backgroundColor: '#E8F5E9', borderRadius: '4px' }}>
                <Icon source={CashDollarIcon} tone="success" />
              </div>
            </InlineStack>
          </Card>
        </InlineGrid>

        {/* TABS & MAIN CONTENT */}
        <Card padding="0">
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
            <div style={{ padding: '20px' }}>
              {selectedTab === 0 && (
                <Layout>
                  <Layout.Section>
                    <BlockStack gap="400">
                      <TextField label="Title" value={title} onChange={handleTitleChange} autoComplete="off" />
                      <TextField label="URL handle" value={handle} prefix="/blogs/news/" onChange={handleHandleChange} autoComplete="off" />
                      <TextField label="Excerpt" value={excerpt} multiline={3} onChange={handleExcerptChange} autoComplete="off" />
                      
                      <BlockStack gap="200">
                        <Text as="span" variant="bodyMd">Featured image</Text>
                        <InlineStack gap="300" blockAlign="center">
                          <Thumbnail source={article.image?.url || "https://burst.shopifycdn.com/photos/silver-stacking-rings.jpg"} alt="featured" size="large" />
                          <ButtonGroup>
                            <Button>Change</Button>
                            <Button>Edit</Button>
                            <Button>Remove</Button>
                          </ButtonGroup>
                        </InlineStack>
                      </BlockStack>

                      <BlockStack gap="200">
                        <Text as="span" variant="bodyMd">Content</Text>
                        <div style={{ border: '1px solid #C9CCCF', borderRadius: '4px' }}>
                          <div style={{ padding: '8px', borderBottom: '1px solid #C9CCCF', display: 'flex', gap: '16px', alignItems: 'center', backgroundColor: '#F9FAFB' }}>
                            <span style={{fontWeight: 'bold', fontSize: '14px'}}>Paragraph <Icon source={SortIcon} tone="base" /></span>
                            <div style={{ display: 'flex', gap: '12px', fontWeight: 'bold' }}>
                              <span>B</span><span style={{fontStyle: 'italic'}}>I</span><span style={{textDecoration: 'underline'}}>U</span>
                            </div>
                          </div>
                          <div style={{ padding: '16px', color: '#202223', minHeight: '300px' }}>
                            <p>Silver rings are timeless, versatile, and perfect for every style. Whether you prefer minimal designs or bold statement pieces, here's how to style them effortlessly.</p>
                            <br />
                            <h3>1. Keep it minimal</h3>
                            <p>For an everyday look, a single silver ring can add just the right touch of elegance. Choose a simple band or a delicate design that complements your outfit.</p>
                            <br />
                            
                            {/* MOCK PRODUCT BLOCK IN EDITOR */}
                            <div style={{ backgroundColor: '#F9F8FD', border: '1px dashed #B8ABF8', borderRadius: '8px', padding: '16px', margin: '16px 0' }}>
                              <BlockStack gap="300">
                                <InlineStack align="space-between">
                                  <BlockStack gap="050">
                                    <Text as="span" variant="bodyMd" fontWeight="semibold">Product block</Text>
                                    <Text as="span" variant="bodySm" tone="subdued">{embeddedProducts.length} products • After this paragraph</Text>
                                  </BlockStack>
                                  <Button size="micro">Change</Button>
                                </InlineStack>
                                
                                <InlineStack gap="300" wrap={false}>
                                  {embeddedProducts.slice(0,3).map(p => (
                                    <div key={p.id} style={{ width: '120px' }}>
                                      <BlockStack gap="100">
                                        <div style={{ border: '1px solid #E1E3E5', borderRadius: '4px', overflow: 'hidden' }}>
                                          <img src={p.productImage} style={{ width: '100%', height: 'auto', display: 'block' }} alt="" />
                                        </div>
                                        <Text as="span" variant="bodySm" fontWeight="bold" truncate>{p.productTitle}</Text>
                                        <Text as="span" variant="bodySm">{p.productPrice}</Text>
                                      </BlockStack>
                                    </div>
                                  ))}
                                  <div style={{ width: '120px', border: '1px dashed #C9CCCF', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} onClick={handleAddProducts}>
                                    <BlockStack gap="100" inlineAlign="center">
                                      <Icon source={ProductIcon} tone="subdued" />
                                      <Text as="span" variant="bodySm" tone="subdued">Add product</Text>
                                    </BlockStack>
                                  </div>
                                </InlineStack>
                              </BlockStack>
                            </div>
                            
                            <h3>2. Stack and layer</h3>
                            <p>Mix different textures and shapes to create a unique stacked ring look. Combine thin bands with statement rings for a balanced and stylish vibe.</p>
                          </div>
                        </div>
                      </BlockStack>
                      
                      {isDirty && (
                        <div style={{ padding: '16px', borderTop: '1px solid #EBEBEB' }}>
                          <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="200" blockAlign="center">
                              <Icon source={AlertCircleIcon} tone="base" />
                              <Text as="span" variant="bodyMd" fontWeight="semibold">You have unsaved changes</Text>
                            </InlineStack>
                            <ButtonGroup>
                              <Button onClick={() => setIsDirty(false)}>Discard changes</Button>
                              <Button variant="primary" onClick={() => { setIsDirty(false); shopify.toast.show("Saved successfully"); }}>Save changes</Button>
                            </ButtonGroup>
                          </InlineStack>
                        </div>
                      )}

                    </BlockStack>
                  </Layout.Section>
                  
                  <Layout.Section variant="oneThird">
                    <BlockStack gap="400">
                      {/* SEO SCORE PANEL */}
                      <Card padding="400">
                        <BlockStack gap="400">
                          <InlineStack align="space-between">
                            <Text as="h3" variant="headingMd">SEO score</Text>
                          </InlineStack>
                          <InlineStack gap="400" wrap={false} blockAlign="center">
                            <div style={{ width: '80px', height: '80px', borderRadius: '50%', border: '8px solid #29845A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <BlockStack gap="0" inlineAlign="center">
                                <Text as="span" variant="headingLg" fontWeight="bold">82</Text>
                                <Text as="span" variant="bodySm" tone="subdued">/100</Text>
                              </BlockStack>
                            </div>
                            
                            <InlineGrid columns={2} gap="200">
                              <BlockStack gap="100">
                                <Text as="span" variant="bodySm" fontWeight="bold">Good</Text>
                                <div style={{display:'flex', gap:'4px'}}><Icon source={CheckIcon} tone="success" /><Text as="span" variant="bodySm">Meta title</Text></div>
                                <div style={{display:'flex', gap:'4px'}}><Icon source={CheckIcon} tone="success" /><Text as="span" variant="bodySm">URL handle</Text></div>
                                <div style={{display:'flex', gap:'4px'}}><Icon source={CheckIcon} tone="success" /><Text as="span" variant="bodySm">Schema</Text></div>
                                <div style={{display:'flex', gap:'4px'}}><Icon source={CheckIcon} tone="success" /><Text as="span" variant="bodySm">Internal links</Text></div>
                              </BlockStack>
                              <BlockStack gap="100">
                                <Text as="span" variant="bodySm" fontWeight="bold">Needs improvement</Text>
                                <div style={{display:'flex', gap:'4px'}}><div style={{width:'8px', height:'8px', borderRadius:'4px', backgroundColor:'#FFC453', marginTop:'6px'}} /><Text as="span" variant="bodySm">Meta description</Text></div>
                                <div style={{display:'flex', gap:'4px'}}><div style={{width:'8px', height:'8px', borderRadius:'4px', backgroundColor:'#FFC453', marginTop:'6px'}} /><Text as="span" variant="bodySm">3 image alt texts</Text></div>
                              </BlockStack>
                            </InlineGrid>
                          </InlineStack>
                          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <Button size="micro" onAction={() => fetcher.submit({ intent: "analyze_seo", articleTitle: article.title, seoTitle: article.seo?.title || "", seoDescription: article.seo?.description || "", body: article.body || "", hasImage: article.image ? "true" : "false" }, { method: "POST" })}>Fix SEO issues</Button>
                          </div>
                        </BlockStack>
                      </Card>

                      {/* RECOMMENDED ACTIONS */}
                      <Card padding="400">
                        <BlockStack gap="400">
                          <Text as="h3" variant="headingMd">Recommended actions</Text>
                          <BlockStack gap="300">
                            <InlineStack gap="200" align="start">
                              <Icon source={SortIcon} tone="magic" />
                              <BlockStack gap="100">
                                <Text as="span" variant="bodyMd">Rewrite meta description</Text>
                                <InlineStack gap="200">
                                  <Badge tone="critical">High impact</Badge>
                                  <Badge tone="success">Low effort</Badge>
                                </InlineStack>
                              </BlockStack>
                            </InlineStack>
                            
                            <InlineStack gap="200" align="start">
                              <Icon source={LinkIcon} tone="magic" />
                              <BlockStack gap="100">
                                <Text as="span" variant="bodyMd">Add 2 internal links</Text>
                                <InlineStack gap="200">
                                  <Badge tone="warning">Medium impact</Badge>
                                  <Badge tone="success">Low effort</Badge>
                                </InlineStack>
                              </BlockStack>
                            </InlineStack>
                          </BlockStack>
                          <Button fullWidth>Apply all suggestions</Button>
                        </BlockStack>
                      </Card>

                      {/* PRODUCTS SUMMARY */}
                      <Card padding="400">
                        <BlockStack gap="400">
                          <Text as="h3" variant="headingMd">Products summary</Text>
                          <InlineGrid columns={3} gap="200">
                            <BlockStack gap="100">
                              <Text as="span" variant="headingMd" fontWeight="bold">{embeddedProducts.length}</Text>
                              <Text as="span" variant="bodySm" tone="subdued">Active products</Text>
                            </BlockStack>
                            <BlockStack gap="100">
                              <Text as="span" variant="headingMd" fontWeight="bold">4.3%</Text>
                              <Text as="span" variant="bodySm" tone="subdued">Product CTR</Text>
                            </BlockStack>
                            <BlockStack gap="100">
                              <Text as="span" variant="headingMd" fontWeight="bold">$430</Text>
                              <Text as="span" variant="bodySm" tone="subdued">Revenue</Text>
                            </BlockStack>
                          </InlineGrid>
                          
                          <BlockStack gap="200">
                            <Text as="span" variant="bodySm" fontWeight="bold">Top product</Text>
                            <InlineStack gap="200" blockAlign="center">
                              <Thumbnail source={embeddedProducts[0]?.productImage || ImageIcon} alt="prod" size="small" />
                              <BlockStack gap="0">
                                <Text as="span" variant="bodySm" fontWeight="bold">{embeddedProducts[0]?.productTitle || "Product"}</Text>
                                <Text as="span" variant="bodySm" tone="subdued">42 clicks • $240 revenue</Text>
                              </BlockStack>
                            </InlineStack>
                          </BlockStack>
                          
                          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <Button size="micro" onClick={() => setSelectedTab(1)}>Manage products</Button>
                          </div>
                        </BlockStack>
                      </Card>

                      {/* PUBLISHING */}
                      <Card padding="400">
                        <BlockStack gap="400">
                          <Text as="h3" variant="headingMd">Publishing</Text>
                          <InlineGrid columns={2} gap="400">
                            <BlockStack gap="100">
                              <Text as="span" variant="bodySm" tone="subdued">Status</Text>
                              <Badge tone="success">Published</Badge>
                            </BlockStack>
                            <BlockStack gap="100">
                              <Text as="span" variant="bodySm" tone="subdued">Visibility</Text>
                              <Text as="span" variant="bodyMd">Online Store</Text>
                            </BlockStack>
                            <BlockStack gap="100">
                              <Text as="span" variant="bodySm" tone="subdued">Author</Text>
                              <Text as="span" variant="bodyMd">Store admin</Text>
                            </BlockStack>
                            <BlockStack gap="100">
                              <Text as="span" variant="bodySm" tone="subdued">Last updated</Text>
                              <Text as="span" variant="bodyMd">May 20, 2024 at 10:30 AM</Text>
                            </BlockStack>
                          </InlineGrid>
                          <Button fullWidth icon={ExternalIcon}>Preview live post</Button>
                        </BlockStack>
                      </Card>

                    </BlockStack>
                  </Layout.Section>
                </Layout>
              )}

              {selectedTab === 1 && (
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingLg">Embedded Products</Text>
                    <Button variant="primary" onClick={handleAddProducts}>Add product</Button>
                  </InlineStack>

                  <Card padding="0">
                    <IndexTable
                      resourceName={{ singular: "product", plural: "products" }}
                      itemCount={embeddedProducts.length}
                      headings={[
                        { title: "" },
                        { title: "Product" },
                        { title: "Price" },
                        { title: "Style" },
                        { title: "Actions" },
                      ]}
                      selectable={false}
                    >
                      {embeddedProducts.map((product, index) => (
                        <IndexTable.Row id={product.id} key={product.id} position={index}>
                          <IndexTable.Cell>
                            <Thumbnail source={product.productImage || ImageIcon} alt={product.productTitle} size="small" />
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Text as="span" variant="bodyMd" fontWeight="bold">{product.productTitle}</Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            {product.productPrice}
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Badge tone={product.displayStyle === "card" ? "info" : "success"}>
                              {product.displayStyle}
                            </Badge>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <InlineStack wrap={false} gap="200" blockAlign="center">
                              <ButtonGroup segmented>
                                <Button size="micro" icon={ArrowUpIcon} disabled={index === 0} onClick={() => handleMoveProduct(index, 'up')} />
                                <Button size="micro" icon={ArrowDownIcon} disabled={index === embeddedProducts.length - 1} onClick={() => handleMoveProduct(index, 'down')} />
                              </ButtonGroup>
                              <Button size="micro" icon={DeleteIcon} tone="critical" onClick={() => handleRemoveProduct(product.productId)} />
                            </InlineStack>
                          </IndexTable.Cell>
                        </IndexTable.Row>
                      ))}
                    </IndexTable>
                    {embeddedProducts.length === 0 && (
                      <EmptyState
                        heading="No products linked yet"
                        action={{ content: "Add products", onAction: handleAddProducts }}
                        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                      >
                        <p>Link products to this article to make it shoppable.</p>
                      </EmptyState>
                    )}
                  </Card>
                </BlockStack>
              )}

              {selectedTab > 1 && (
                <EmptyState
                  heading="Coming Soon"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>This tab is currently under development.</p>
                </EmptyState>
              )}
            </div>
          </Tabs>
        </Card>
      </BlockStack>
    </Page>
  );
}
`;

fs.writeFileSync('app/routes/app.blogs.$blogId.tsx', codeBeforeComponent + componentStr);
console.log("SUCCESS");
