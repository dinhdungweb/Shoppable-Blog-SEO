import { useCallback, useState, useEffect } from "react";
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
  Badge,
  Divider,
  TextField,
  Select,
  Icon,
  Button,
  InlineGrid,
} from "@shopify/polaris";
import {
  SettingsIcon,
  SearchIcon,
  MagicIcon,
  AlertTriangleIcon,
  StoreIcon,
  ChartVerticalIcon,
  CheckCircleIcon,
  RefreshIcon,
  ExitIcon,
  DeleteIcon,
} from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let config = await prisma.shopConfig.findUnique({
    where: { shop },
  });

  if (!config) {
    config = await prisma.shopConfig.create({
      data: { shop },
    });
  }

  return { config };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  const updates = {
    defaultBlog: formData.get("defaultBlog") as string,
    language: formData.get("language") as string,
    market: formData.get("market") as string,
    appStatus: formData.get("appStatus") === "true",
    productCardLayout: formData.get("productCardLayout") as string,
    cardPosition: formData.get("cardPosition") as string,
    buttonText: formData.get("buttonText") as string,
    showPrice: formData.get("showPrice") === "true",
    showVariantSelector: formData.get("showVariantSelector") === "true",
    openInNewTab: formData.get("openInNewTab") === "true",
    metaTitleTemplate: formData.get("metaTitleTemplate") as string,
    metaDescriptionTemplate: formData.get("metaDescriptionTemplate") as string,
    urlHandleRules: formData.get("urlHandleRules") as string,
    canonicalRules: formData.get("canonicalRules") as string,
    addBlogSchema: formData.get("addBlogSchema") === "true",
    addProductSchema: formData.get("addProductSchema") === "true",
    attributionWindow: formData.get("attributionWindow") as string,
    utmRules: formData.get("utmRules") as string,
    enableConversionTracking: formData.get("enableConversionTracking") === "true",
    brandTone: formData.get("brandTone") as string,
    defaultContentStructure: formData.get("defaultContentStructure") as string,
    autoGenerateAltText: formData.get("autoGenerateAltText") === "true",
    requireApproval: formData.get("requireApproval") === "true",
    forbiddenWords: formData.get("forbiddenWords") as string,
  };

  await prisma.shopConfig.update({
    where: { shop },
    data: updates,
  });

  return json({ success: true, updates });
};

// --- CUSTOM TOGGLE COMPONENT ---
const CustomToggle = ({ checked, label, description, onChange }: { checked: boolean, label: string, description?: string, onChange: (val: boolean) => void }) => (
  <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
    <div 
      onClick={() => onChange(!checked)}
      style={{ width: '36px', height: '20px', borderRadius: '10px', backgroundColor: checked ? '#29845A' : '#C9CCCF', position: 'relative', flexShrink: 0, marginTop: '2px', cursor: 'pointer' }}
    >
       <div style={{ width: '16px', height: '16px', borderRadius: '8px', backgroundColor: '#fff', position: 'absolute', top: '2px', right: checked ? '2px' : 'auto', left: checked ? 'auto' : '2px', transition: 'all 0.2s' }} />
    </div>
    <BlockStack gap="0">
      <Text as="span" variant="bodyMd" fontWeight="semibold">{label}</Text>
      {description && <Text as="p" variant="bodySm" tone="subdued">{description}</Text>}
    </BlockStack>
  </div>
);

export default function Settings() {
  const { config } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [formState, setFormState] = useState(config);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    // Check if formState differs from original config
    let changed = false;
    for (const key in formState) {
      if (key !== 'id' && key !== 'shop' && key !== 'createdAt' && key !== 'updatedAt') {
        if (formState[key as keyof typeof formState] !== config[key as keyof typeof config]) {
          changed = true;
          break;
        }
      }
    }
    setHasChanges(changed);
  }, [formState, config]);

  const handleChange = (key: string, value: any) => {
    setFormState(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    // Submit the formState to the action
    const data = new FormData();
    for (const key in formState) {
      if (key !== 'id' && key !== 'shop' && key !== 'createdAt' && key !== 'updatedAt') {
        data.append(key, String(formState[key as keyof typeof formState]));
      }
    }
    fetcher.submit(data, { method: 'POST' });
    shopify.toast.show('Settings saved');
  };

  const handleDiscard = () => {
    setFormState(config);
  };

  return (
    <Page fullWidth>
      <BlockStack gap="500">
        
        {/* HEADER */}
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text as="h1" variant="headingLg" fontWeight="bold">Settings</Text>
            <Text as="p" variant="bodyMd" tone="subdued">Configure how the app works for your store, including SEO rules, tracking, and AI content preferences.</Text>
          </BlockStack>
          <InlineStack gap="300" blockAlign="center">
            {!hasChanges && (
              <InlineStack gap="100" blockAlign="center">
                <Icon source={CheckCircleIcon} tone="success" />
                <Text as="span" tone="success">All changes saved</Text>
              </InlineStack>
            )}
            <Button onClick={handleDiscard}>Reset to defaults</Button>
          </InlineStack>
        </InlineStack>

        {/* MAIN GRID */}
        <Layout>
          {/* LEFT COLUMN */}
          <Layout.Section variant="oneHalf">
            <BlockStack gap="400">
              
              {/* CARD 1: General */}
              <Card padding="400">
                <BlockStack gap="400">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ flexShrink: 0, display: 'flex' }}><Icon source={SettingsIcon} tone="base" /></div>
                    <Text as="h2" variant="headingMd" fontWeight="bold">General</Text>
                  </div>
                  <Text as="p" variant="bodyMd" tone="subdued">Basic app configuration and defaults.</Text>
                  
                  <InlineGrid columns={2} gap="400">
                    <Select label="Default blog" options={['News & Articles']} value={formState.defaultBlog} onChange={(v) => handleChange('defaultBlog', v)} />
                    <Select label="Language" options={['English']} value={formState.language} onChange={(v) => handleChange('language', v)} />
                  </InlineGrid>
                  <Select label="Market" options={['United States']} value={formState.market} onChange={(v) => handleChange('market', v)} />
                  
                  <Divider />
                  
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="0">
                       <Text as="h3" variant="bodyMd" fontWeight="bold">App status</Text>
                       <Text as="p" variant="bodySm" tone="subdued">The app is working properly.</Text>
                    </BlockStack>
                    <InlineStack gap="200" blockAlign="center">
                      <div style={{ backgroundColor: formState.appStatus ? '#E8F5E9' : '#F1F2F3', color: formState.appStatus ? '#29845A' : '#6D7175', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }}>
                        {formState.appStatus ? 'Active' : 'Inactive'}
                      </div>
                      <div 
                        onClick={() => handleChange('appStatus', !formState.appStatus)}
                        style={{ width: '36px', height: '20px', borderRadius: '10px', backgroundColor: formState.appStatus ? '#29845A' : '#C9CCCF', position: 'relative', cursor: 'pointer' }}
                      >
                         <div style={{ width: '16px', height: '16px', borderRadius: '8px', backgroundColor: '#fff', position: 'absolute', top: '2px', right: formState.appStatus ? '2px' : 'auto', left: formState.appStatus ? 'auto' : '2px', transition: 'all 0.2s' }} />
                      </div>
                    </InlineStack>
                  </InlineStack>
                </BlockStack>
              </Card>

              {/* CARD 3: SEO rules */}
              <Card padding="400">
                <BlockStack gap="400">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ flexShrink: 0, display: 'flex' }}><Icon source={SearchIcon} tone="base" /></div>
                    <Text as="h2" variant="headingMd" fontWeight="bold">SEO rules</Text>
                  </div>
                  <Text as="p" variant="bodyMd" tone="subdued">Define how SEO metadata and structure are generated.</Text>
                  
                  <TextField 
                    label="Meta title template" 
                    value={formState.metaTitleTemplate} 
                    connectedRight={<Button disclosure>Insert variable</Button>} 
                    onChange={(v) => handleChange('metaTitleTemplate', v)} 
                    autoComplete="off" 
                  />
                  <TextField 
                    label="Meta description template" 
                    value={formState.metaDescriptionTemplate} 
                    connectedRight={<Button disclosure>Insert variable</Button>} 
                    onChange={(v) => handleChange('metaDescriptionTemplate', v)} 
                    autoComplete="off" 
                  />
                  
                  <InlineGrid columns={2} gap="400">
                    <Select label="URL handle rules" options={['Use post title']} value={formState.urlHandleRules} onChange={(v) => handleChange('urlHandleRules', v)} />
                    <Select label="Canonical rules" options={['Use default canonical (self)']} value={formState.canonicalRules} onChange={(v) => handleChange('canonicalRules', v)} />
                  </InlineGrid>

                  <BlockStack gap="300">
                    <CustomToggle checked={formState.addBlogSchema} onChange={(v) => handleChange('addBlogSchema', v)} label="Add Blog schema (Article)" />
                    <CustomToggle checked={formState.addProductSchema} onChange={(v) => handleChange('addProductSchema', v)} label="Add Product schema (Product)" />
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* CARD 5: AI writing rules */}
              <Card padding="400">
                <BlockStack gap="400">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ flexShrink: 0, display: 'flex' }}><Icon source={MagicIcon} tone="base" /></div>
                    <Text as="h2" variant="headingMd" fontWeight="bold">AI writing rules</Text>
                  </div>
                  <Text as="p" variant="bodyMd" tone="subdued">Guide AI content generation to match your brand.</Text>
                  
                  <InlineGrid columns={2} gap="400">
                    <Select label="Brand tone" options={['Professional', 'Casual', 'Friendly']} value={formState.brandTone} onChange={(v) => handleChange('brandTone', v)} />
                    <Select label="Default content structure" options={['Introduction, H2 sections, Conclusion']} value={formState.defaultContentStructure} onChange={(v) => handleChange('defaultContentStructure', v)} />
                  </InlineGrid>

                  <BlockStack gap="300">
                    <CustomToggle checked={formState.autoGenerateAltText} onChange={(v) => handleChange('autoGenerateAltText', v)} label="Auto-generate alt text for images" description="Generate descriptive alt text for all images" />
                    <CustomToggle checked={formState.requireApproval} onChange={(v) => handleChange('requireApproval', v)} label="Require approval before publish" description="Review AI-suggested content before publishing" />
                  </BlockStack>

                  <TextField label="Forbidden words" placeholder="Enter words to avoid (comma separated)" helpText="These words will be avoided in AI-generated content" value={formState.forbiddenWords} onChange={(v) => handleChange('forbiddenWords', v)} autoComplete="off" />
                </BlockStack>
              </Card>

            </BlockStack>
          </Layout.Section>

          {/* RIGHT COLUMN */}
          <Layout.Section variant="oneHalf">
            <BlockStack gap="400">
              
              {/* CARD 2: Shoppable blog display */}
              <Card padding="400">
                <BlockStack gap="400">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ flexShrink: 0, display: 'flex' }}><Icon source={StoreIcon} tone="base" /></div>
                    <Text as="h2" variant="headingMd" fontWeight="bold">Shoppable blog display</Text>
                  </div>
                  <Text as="p" variant="bodyMd" tone="subdued">Control how products appear in your blog posts.</Text>
                  
                  <InlineGrid columns={2} gap="400">
                    <BlockStack gap="400">
                      <Select label="Product card layout" options={['Standard', 'Compact']} value={formState.productCardLayout} onChange={(v) => handleChange('productCardLayout', v)} />
                      <Select label="Card position in article" options={['After paragraph', 'End of article']} value={formState.cardPosition} onChange={(v) => handleChange('cardPosition', v)} />
                      <TextField label="Button text" value={formState.buttonText} onChange={(v) => handleChange('buttonText', v)} autoComplete="off" />
                      
                      <BlockStack gap="300">
                        <CustomToggle checked={formState.showPrice} onChange={(v) => handleChange('showPrice', v)} label="Show price" />
                        <CustomToggle checked={formState.showVariantSelector} onChange={(v) => handleChange('showVariantSelector', v)} label="Show variant selector" />
                        <CustomToggle checked={formState.openInNewTab} onChange={(v) => handleChange('openInNewTab', v)} label="Open product in new tab" description="Links will open in a new browser tab" />
                      </BlockStack>
                    </BlockStack>

                    <BlockStack gap="200">
                      <Text as="span" variant="bodyMd" fontWeight="semibold">Live preview</Text>
                      <div style={{ padding: '16px', backgroundColor: '#F9FAFB', borderRadius: '8px', border: '1px solid #EBEBEB' }}>
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                          <div style={{ width: '80px', height: '80px', backgroundColor: '#EBEBEB', borderRadius: '8px', overflow: 'hidden', flexShrink: 0 }}>
                            <img src="https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_medium.png" alt="Ring" style={{width: '100%', height: '100%', objectFit: 'cover'}} />
                          </div>
                          <BlockStack gap="100">
                            <Text as="span" variant="bodyMd" fontWeight="bold">14k Gold Solitaire Ring</Text>
                            {formState.showPrice && <Text as="span" variant="bodyMd">$1,250.00</Text>}
                            <Text as="p" tone="subdued" variant="bodySm">Timeless 14k gold ring with a brilliant-cut diamond.</Text>
                            <div style={{ marginTop: '8px' }}><Button size="micro">{formState.buttonText || "View product"}</Button></div>
                          </BlockStack>
                        </div>
                      </div>
                    </BlockStack>
                  </InlineGrid>
                </BlockStack>
              </Card>

              {/* CARD 4: Tracking & attribution */}
              <Card padding="400">
                <BlockStack gap="400">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ flexShrink: 0, display: 'flex' }}><Icon source={ChartVerticalIcon} tone="base" /></div>
                    <Text as="h2" variant="headingMd" fontWeight="bold">Tracking & attribution</Text>
                  </div>
                  <Text as="p" variant="bodyMd" tone="subdued">Track performance and attribute revenue.</Text>
                  
                  <BlockStack gap="100">
                    <Text as="span" variant="bodyMd" fontWeight="semibold">Tracking status</Text>
                    <InlineStack gap="100" blockAlign="center">
                      <div style={{ width: '8px', height: '8px', borderRadius: '4px', backgroundColor: formState.enableConversionTracking ? '#29845A' : '#6D7175' }} />
                      <Text as="span" fontWeight="bold" tone={formState.enableConversionTracking ? "success" : "subdued"}>{formState.enableConversionTracking ? 'Active' : 'Inactive'}</Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">{formState.enableConversionTracking ? 'Tracking is collecting data' : 'Tracking is paused'}</Text>
                  </BlockStack>

                  <InlineGrid columns={2} gap="400">
                    <BlockStack gap="100">
                      <Select label="UTM rules" options={['Auto-append to product links']} value={formState.utmRules} onChange={(v) => handleChange('utmRules', v)} />
                      <Text as="p" variant="bodySm" tone="subdued">Appends UTM parameters to outbound links</Text>
                    </BlockStack>
                    <Select label="Attribution window" options={['7 days', '30 days']} value={formState.attributionWindow} onChange={(v) => handleChange('attributionWindow', v)} />
                  </InlineGrid>

                  <div style={{ padding: '16px', border: '1px solid #EBEBEB', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                     <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                        <div style={{ width: '32px', height: '32px', backgroundColor: '#F9AB00', borderRadius: '4px', position: 'relative' }}>
                          <div style={{ width: '8px', height: '20px', backgroundColor: '#fff', position: 'absolute', bottom: '4px', left: '6px', borderRadius: '2px' }} />
                          <div style={{ width: '8px', height: '14px', backgroundColor: '#fff', position: 'absolute', bottom: '4px', left: '18px', borderRadius: '2px' }} />
                        </div>
                        <BlockStack gap="0">
                           <Text as="span" fontWeight="bold">Google Analytics 4</Text>
                           <Text as="span" tone="success" variant="bodySm">Connected</Text>
                        </BlockStack>
                     </div>
                     <Button size="micro">Manage</Button>
                  </div>

                  <Divider />
                  
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="0">
                      <Text as="span" fontWeight="bold">Enable conversion tracking</Text>
                      <Text as="p" variant="bodySm" tone="subdued">Track conversions and revenue from blog traffic</Text>
                    </BlockStack>
                    <CustomToggle checked={formState.enableConversionTracking} onChange={(v) => handleChange('enableConversionTracking', v)} label="" />
                  </InlineStack>

                </BlockStack>
              </Card>

              {/* CARD 6: Danger zone */}
              <Card padding="400">
                <BlockStack gap="400">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ flexShrink: 0, display: 'flex' }}><Icon source={AlertTriangleIcon} tone="critical" /></div>
                    <Text as="h2" variant="headingMd" fontWeight="bold">Danger zone</Text>
                  </div>
                  <Text as="p" variant="bodyMd" tone="subdued">Irreversible actions that affect your data and settings.</Text>
                  
                  <Divider />
                  
                  <InlineStack align="space-between" blockAlign="center">
                     <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <Icon source={RefreshIcon} tone="critical" />
                        <BlockStack gap="0">
                           <Text as="span" fontWeight="bold">Reset settings</Text>
                           <Text as="span" variant="bodySm" tone="subdued">Reset all settings to their default values.</Text>
                        </BlockStack>
                     </div>
                     <Button>Reset settings</Button>
                  </InlineStack>

                  <Divider />
                  
                  <InlineStack align="space-between" blockAlign="center">
                     <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <Icon source={ExitIcon} tone="critical" />
                        <BlockStack gap="0">
                           <Text as="span" fontWeight="bold">Disconnect app</Text>
                           <Text as="span" variant="bodySm" tone="subdued">Disconnect the app from your store. Data will be retained.</Text>
                        </BlockStack>
                     </div>
                     <Button>Disconnect</Button>
                  </InlineStack>

                  <Divider />
                  
                  <InlineStack align="space-between" blockAlign="center">
                     <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <Icon source={DeleteIcon} tone="critical" />
                        <BlockStack gap="0">
                           <Text as="span" fontWeight="bold">Delete generated data</Text>
                           <Text as="span" variant="bodySm" tone="subdued">Permanently delete all AI-generated content and metadata.</Text>
                        </BlockStack>
                     </div>
                     <Button tone="critical" variant="plain">Delete data</Button>
                  </InlineStack>

                </BlockStack>
              </Card>

            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* FLOATING CONTEXTUAL SAVE BAR */}
      {hasChanges && (
        <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', width: '90%', maxWidth: '900px', backgroundColor: '#fff', borderRadius: '12px', padding: '16px 24px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', border: '1px solid #EBEBEB', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 100 }}>
           <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <Icon source={AlertTriangleIcon} tone="warning" />
              <Text as="span" fontWeight="bold">You have unsaved changes</Text>
           </div>
           <InlineStack gap="200">
              <Button onClick={handleDiscard}>Discard changes</Button>
              <Button variant="primary" tone="critical" onClick={handleSave} loading={fetcher.state === 'submitting'}>Save changes</Button> 
           </InlineStack>
        </div>
      )}

      {/* Spacing at bottom to ensure save bar doesn't cover content */}
      <div style={{ height: '100px' }} />
    </Page>
  );
}
