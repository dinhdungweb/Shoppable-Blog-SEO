import { useState, useEffect, useMemo } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { unstable_usePrompt, useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Banner,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Divider,
  TextField,
  Select,
  Icon,
  Button,
  InlineGrid,
  Tabs,
} from "@shopify/polaris";
import {
  SettingsIcon,
  AlertTriangleIcon,
  StoreIcon,
  ChartVerticalIcon,
  CheckCircleIcon,
  ListBulletedIcon,
  HomeIcon,
} from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import prisma from "../db.server";
import {
  ShoppableDisplayPreview,
  normalizeHexColor as normalizeWidgetHexColor,
} from "../components/ShoppableDisplayPreview";
import {
  BREADCRUMB_STYLE_OPTIONS,
  CONTENT_NAV_DEFAULTS,
  TOC_AUTO_INSERT_POSITION_OPTIONS,
  TOC_LAYOUT_OPTIONS,
  TOC_LEVEL_OPTIONS,
  TOC_STYLE_OPTIONS,
  clampNumber as clampContentNavNumber,
  normalizeContentNavConfig,
  normalizeHexColor as normalizeContentNavHexColor,
  pickValue,
} from "../content-navigation";
import {
  clampSettingNumber,
  cleanSettingText,
  pickSettingChoice,
} from "../settings-validation";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const { limits, planKey } = await getActivePlanAndLimits(billing, shop);

  let config = await prisma.shopConfig.findUnique({
    where: { shop },
  });

  if (!config) {
    config = await prisma.shopConfig.create({
      data: { shop },
    });
  }

  return {
    config: { ...config, ...normalizeContentNavConfig(config) },
    canContentNavigation: limits.canContentNavigation,
    canCustomCss: limits.canCustomCss,
    initialTab: getInitialSettingsTab(url.searchParams.get("tab")),
    planKey,
  };
};

function getInitialSettingsTab(tab: string | null) {
  if (tab === "display") return 1;
  if (tab === "content-navigation" || tab === "toc") return 2;
  if (tab === "tracking") return 3;
  return 0;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const { limits } = await getActivePlanAndLimits(billing, shop);
  const formData = await request.formData();
  const maxProducts = clampSettingNumber(formData.get("maxProducts"), 1, 12, 6);
  const gridColumns = clampSettingNumber(formData.get("gridColumns"), 2, 4, 3);
  const carouselItemsVisible = clampSettingNumber(formData.get("carouselItemsVisible"), 1, 5, 4);

  try {
    const updates = {
      appStatus: formData.get("appStatus") === "true",
      widgetStyle: pickSettingChoice(formData, "widgetStyle", ["carousel", "grid"], "carousel"),
      primaryColor: normalizeWidgetHexColor(formData.get("primaryColor")),
      productCardLayout: pickSettingChoice(formData, "productCardLayout", ["Standard", "Compact", "Minimal", "Featured"], "Standard"),
      buttonText: cleanSettingText(formData.get("buttonText"), 80, "View product"),
      showPrice: formData.get("showPrice") === "true",
      showAddToCart: formData.get("showAddToCart") === "true",
      openInNewTab: formData.get("openInNewTab") === "true",
      maxProducts,
      imageAspectRatio: pickSettingChoice(formData, "imageAspectRatio", ["Square", "Portrait", "Wide"], "Square"),
      imageFit: pickSettingChoice(formData, "imageFit", ["Cover", "Contain"], "Cover"),
      cardDensity: pickSettingChoice(formData, "cardDensity", ["Compact", "Comfortable", "Spacious"], "Comfortable"),
      gridColumns,
      textAlignment: pickSettingChoice(formData, "textAlignment", ["Left", "Center"], "Left"),
      buttonStyle: pickSettingChoice(formData, "buttonStyle", ["Solid", "Outline", "Subtle", "Link"], "Solid"),
      shadowStyle: pickSettingChoice(formData, "shadowStyle", ["None", "Soft", "Lifted"], "Soft"),
      showCarouselArrows: formData.get("showCarouselArrows") === "true",
      showCarouselDots: formData.get("showCarouselDots") === "true",
      carouselItemsVisible,
      borderRadius: pickSettingChoice(formData, "borderRadius", ["4px", "8px", "12px", "20px"], "8px"),
      ...(limits.canCustomCss ? { customCss: cleanSettingText(formData.get("customCss"), 20000, "") } : {}),
      utmRules: pickSettingChoice(formData, "utmRules", ["Auto-append to product links", "Do not append"], "Auto-append to product links"),
      enableConversionTracking: formData.get("enableConversionTracking") === "true",
      ...(limits.canContentNavigation
        ? {
          breadcrumbsEnabled: formData.get("breadcrumbsEnabled") === "true",
          breadcrumbsStyle: pickValue(
            formData.get("breadcrumbsStyle"),
            BREADCRUMB_STYLE_OPTIONS,
            CONTENT_NAV_DEFAULTS.breadcrumbsStyle,
          ),
          breadcrumbsShowHome: formData.get("breadcrumbsShowHome") === "true",
          breadcrumbsHomeLabel: cleanSettingText(formData.get("breadcrumbsHomeLabel"), 80, "Home"),
          breadcrumbsShowBlog: formData.get("breadcrumbsShowBlog") === "true",
          breadcrumbsCurrentClickable: formData.get("breadcrumbsCurrentClickable") === "true",
          breadcrumbsSeparator: String(formData.get("breadcrumbsSeparator") || "/").trim().slice(0, 8) || "/",
          tocEnabled: formData.get("tocEnabled") === "true",
          tocAutoInsertEnabled: formData.get("tocAutoInsertEnabled") === "true",
          tocAutoInsertPosition: pickValue(
            formData.get("tocAutoInsertPosition"),
            TOC_AUTO_INSERT_POSITION_OPTIONS,
            CONTENT_NAV_DEFAULTS.tocAutoInsertPosition,
          ),
          tocTitle: cleanSettingText(formData.get("tocTitle"), 120, "Table of contents"),
          tocLevels: pickValue(formData.get("tocLevels"), TOC_LEVEL_OPTIONS, CONTENT_NAV_DEFAULTS.tocLevels),
          tocStyle: pickValue(formData.get("tocStyle"), TOC_STYLE_OPTIONS, CONTENT_NAV_DEFAULTS.tocStyle),
          tocLayout: pickValue(formData.get("tocLayout"), TOC_LAYOUT_OPTIONS, CONTENT_NAV_DEFAULTS.tocLayout),
          tocNumbering: formData.get("tocNumbering") === "true",
          tocSmoothScroll: formData.get("tocSmoothScroll") === "true",
          tocMobileCollapsed: formData.get("tocMobileCollapsed") === "true",
          tocStickyOffset: clampContentNavNumber(formData.get("tocStickyOffset"), 0, 240, CONTENT_NAV_DEFAULTS.tocStickyOffset),
          contentNavPrimaryColor: normalizeContentNavHexColor(formData.get("contentNavPrimaryColor")),
          ...(limits.canCustomCss ? { contentNavCustomCss: cleanSettingText(formData.get("contentNavCustomCss"), 20000, "") } : {}),
          }
        : {}),
    };

    await prisma.shopConfig.update({
      where: { shop },
      data: updates,
    });

    return json({ success: true as const, updates });
  } catch (error) {
    console.error("Settings update failed", { shop, error });
    return json({ success: false as const, error: "Settings could not be saved. Please try again." }, { status: 500 });
  }
};

// --- CUSTOM TOGGLE COMPONENT ---
const CustomToggle = ({
  checked,
  label,
  description,
  disabled = false,
  hideLabel = false,
  onChange,
}: {
  checked: boolean;
  label: string;
  description?: string;
  disabled?: boolean;
  hideLabel?: boolean;
  onChange: (val: boolean) => void;
}) => (
  <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', opacity: disabled ? 0.6 : 1 }}>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      style={{ width: '36px', height: '20px', padding: 0, border: 0, borderRadius: '10px', backgroundColor: checked ? '#29845A' : '#C9CCCF', position: 'relative', flexShrink: 0, marginTop: '2px', cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
       <div style={{ width: '16px', height: '16px', borderRadius: '8px', backgroundColor: '#fff', position: 'absolute', top: '2px', right: checked ? '2px' : 'auto', left: checked ? 'auto' : '2px', transition: 'all 0.2s' }} />
    </button>
    {!hideLabel && (
      <BlockStack gap="0">
        <Text as="span" variant="bodyMd" fontWeight="semibold">{label}</Text>
        {description && <Text as="p" variant="bodySm" tone="subdued">{description}</Text>}
      </BlockStack>
    )}
  </div>
);

export default function Settings() {
  const { config, canContentNavigation, canCustomCss, initialTab, planKey } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [formState, setFormState] = useState(config);
  const [savedState, setSavedState] = useState(config);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    // Check if formState differs from original config
    let changed = false;
    for (const key in formState) {
      if (key !== 'id' && key !== 'shop' && key !== 'createdAt' && key !== 'updatedAt') {
        if (formState[key as keyof typeof formState] !== savedState[key as keyof typeof savedState]) {
          changed = true;
          break;
        }
      }
    }
    setHasChanges(changed);
  }, [formState, savedState]);

  useEffect(() => {
    const result = fetcher.data;
    if (fetcher.state !== "idle" || !result) return;
    if (result.success && "updates" in result) {
      setSavedState((previous) => ({ ...previous, ...result.updates }));
      setFormState((previous) => ({ ...previous, ...result.updates }));
      shopify.toast.show("Settings saved");
    } else if ("error" in result && result.error) {
      shopify.toast.show(result.error, { isError: true });
    }
  }, [fetcher.state, fetcher.data, shopify]);

  useEffect(() => {
    if (!hasChanges) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasChanges]);

  unstable_usePrompt({
    when: hasChanges,
    message: "You have unsaved settings. Leave this page and discard them?",
  });

  const handleChange = (key: string, value: any) => {
    setFormState(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    // Submit the formState to the action
    const data = new FormData();
    for (const key in formState) {
      if (key !== 'id' && key !== 'shop' && key !== 'createdAt' && key !== 'updatedAt') {
        const value = formState[key as keyof typeof formState];
        data.append(key, value == null ? '' : String(value));
      }
    }
    fetcher.submit(data, { method: 'POST' });
  };

  const handleDiscard = () => {
    setFormState(savedState);
  };

  const [selectedTab, setSelectedTab] = useState(initialTab);
  const settingsTabs = useMemo(
    () => [
      { id: 'general', content: 'General', panelID: 'general-panel' },
      { id: 'display', content: 'Shoppable display', panelID: 'display-panel' },
      { id: 'content-navigation', content: 'Content navigation', panelID: 'content-navigation-panel' },
      { id: 'tracking', content: 'Tracking', panelID: 'tracking-panel' },
    ],
    [],
  );
  const selectedTabId = settingsTabs[selectedTab]?.id || 'general';
  useEffect(() => {
    setSelectedTab(settingsTabs[initialTab] ? initialTab : 0);
  }, [initialTab, settingsTabs]);
  useEffect(() => {
    if (!settingsTabs[selectedTab]) {
      setSelectedTab(0);
    }
  }, [selectedTab, settingsTabs]);
  const isCarouselMode = (formState.widgetStyle || 'carousel') === 'carousel';
  const primaryColor = normalizeWidgetHexColor(formState.primaryColor);
  const contentNavPrimaryColor = normalizeContentNavHexColor(formState.contentNavPrimaryColor);
  const contentNavigationLocked = !canContentNavigation;
  const breadcrumbsSettingsDisabled = contentNavigationLocked || !formState.breadcrumbsEnabled;
  const tocSettingsDisabled = contentNavigationLocked || !formState.tocEnabled;
  const contentNavigationPreviewConfig = contentNavigationLocked
    ? {
        ...formState,
        breadcrumbsEnabled: false,
        tocEnabled: false,
        tocAutoInsertEnabled: false,
      }
    : formState;
  const tocStickyOffsetVisible = ['left-rail', 'right-rail'].includes(String(formState.tocLayout || ''));

  return (
    <Page fullWidth>
      <BlockStack gap="500">
        
        {/* HEADER */}
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text as="h1" variant="headingLg" fontWeight="bold">Settings</Text>
            <Text as="p" variant="bodyMd" tone="subdued">Configure storefront display, content navigation, and first-party conversion tracking for this Shopify store.</Text>
          </BlockStack>
          <InlineStack gap="300" blockAlign="center">
            {!hasChanges && (
              <InlineStack gap="100" blockAlign="center">
                <Icon source={CheckCircleIcon} tone="success" />
                <Text as="span" tone="success">All changes saved</Text>
              </InlineStack>
            )}
            <Button onClick={handleDiscard} disabled={!hasChanges}>Discard changes</Button>
          </InlineStack>
        </InlineStack>

        <style>
          {`
            .bp-settings-tabs .Polaris-Box {
              --pc-box-padding-block-start-xs: 0 !important;
              --pc-box-padding-block-start-sm: 0 !important;
              --pc-box-padding-block-start-md: 0 !important;
              --pc-box-padding-block-start-lg: 0 !important;
              --pc-box-padding-block-start-xl: 0 !important;
              --pc-box-padding-block-end-xs: 0 !important;
              --pc-box-padding-block-end-sm: 0 !important;
              --pc-box-padding-block-end-md: 0 !important;
              --pc-box-padding-block-end-lg: 0 !important;
              --pc-box-padding-block-end-xl: 0 !important;
              --pc-box-padding-inline-start-xs: 0 !important;
              --pc-box-padding-inline-start-sm: 0 !important;
              --pc-box-padding-inline-start-md: 0 !important;
              --pc-box-padding-inline-start-lg: 0 !important;
              --pc-box-padding-inline-start-xl: 0 !important;
              --pc-box-padding-inline-end-xs: 0 !important;
              --pc-box-padding-inline-end-sm: 0 !important;
              --pc-box-padding-inline-end-md: 0 !important;
              --pc-box-padding-inline-end-lg: 0 !important;
              --pc-box-padding-inline-end-xl: 0 !important;
              padding: 0 !important;
            }

            .bp-settings-tabs .Polaris-Tabs__Wrapper {
              padding: 0 !important;
            }

            .bp-settings-tabs .Polaris-Tabs {
              padding: 0 !important;
            }
          `}
        </style>
        <BlockStack gap="300">
          <div className="bp-settings-tabs">
            <Tabs tabs={settingsTabs} selected={selectedTab} onSelect={setSelectedTab} />
          </div>

          <div id={settingsTabs[selectedTab]?.panelID || 'general-panel'}>
          {selectedTabId === 'general' && (
            <Card padding="400">
              <BlockStack gap="400">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ flexShrink: 0, display: 'flex' }}><Icon source={SettingsIcon} tone="base" /></div>
                  <Text as="h2" variant="headingMd" fontWeight="bold">General</Text>
                </div>
                <Text as="p" variant="bodyMd" tone="subdued">Basic app configuration and defaults.</Text>

                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="0">
                    <Text as="h3" variant="bodyMd" fontWeight="bold">App status</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Controls storefront widget output and tracking collection.</Text>
                  </BlockStack>
                  <InlineStack gap="200" blockAlign="center">
                    <div style={{ backgroundColor: formState.appStatus ? '#E8F5E9' : '#F1F2F3', color: formState.appStatus ? '#29845A' : '#6D7175', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }}>
                      {formState.appStatus ? 'Active' : 'Inactive'}
                    </div>
                    <CustomToggle checked={formState.appStatus} onChange={(value) => handleChange('appStatus', value)} label="App status" hideLabel />
                  </InlineStack>
                </InlineStack>
              </BlockStack>
            </Card>
          )}

          {selectedTabId === 'display' && (
            <InlineGrid columns={{ xs: 1, lg: 'minmax(380px, 1fr) minmax(420px, 1fr)' }} gap="400">
              <BlockStack gap="400">
                <Card padding="400">
                  <BlockStack gap="400">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ flexShrink: 0, display: 'flex' }}><Icon source={StoreIcon} tone="base" /></div>
                      <Text as="h2" variant="headingMd" fontWeight="bold">Display mode</Text>
                    </div>
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <Select
                        label="Display mode"
                        options={[
                          { label: 'Carousel', value: 'carousel' },
                          { label: 'Grid', value: 'grid' },
                        ]}
                        value={formState.widgetStyle || 'carousel'}
                        onChange={(v) => handleChange('widgetStyle', v)}
                      />
                      <Select
                        label="Product card layout"
                        options={[
                          { label: 'Standard card', value: 'Standard' },
                          { label: 'Compact media row', value: 'Compact' },
                          { label: 'Minimal text link', value: 'Minimal' },
                          { label: 'Featured editorial', value: 'Featured' },
                        ]}
                        value={formState.productCardLayout}
                        onChange={(v) => handleChange('productCardLayout', v)}
                      />
                    </InlineGrid>
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <TextField
                        label="Max products"
                        type="number"
                        min={1}
                        max={12}
                        value={String(formState.maxProducts || 6)}
                        onChange={(v) => handleChange('maxProducts', Number(v))}
                        autoComplete="off"
                      />
                      {isCarouselMode ? (
                        <Select
                          label="Carousel visible products"
                          options={[
                            { label: '1 product', value: '1' },
                            { label: '2 products', value: '2' },
                            { label: '3 products', value: '3' },
                            { label: '4 products', value: '4' },
                            { label: '5 products', value: '5' },
                          ]}
                          value={String(formState.carouselItemsVisible || 4)}
                          onChange={(v) => handleChange('carouselItemsVisible', Number(v))}
                        />
                      ) : (
                        <Select
                          label="Grid columns"
                          options={[
                            { label: '2 columns', value: '2' },
                            { label: '3 columns', value: '3' },
                            { label: '4 columns', value: '4' },
                          ]}
                          value={String(formState.gridColumns || 3)}
                          onChange={(v) => handleChange('gridColumns', Number(v))}
                        />
                      )}
                    </InlineGrid>
                    {isCarouselMode && (
                      <BlockStack gap="300">
                        <CustomToggle checked={formState.showCarouselArrows !== false} onChange={(v) => handleChange('showCarouselArrows', v)} label="Show carousel arrows" />
                        <CustomToggle checked={formState.showCarouselDots !== false} onChange={(v) => handleChange('showCarouselDots', v)} label="Show carousel dots" />
                      </BlockStack>
                    )}
                  </BlockStack>
                </Card>

                <Card padding="400">
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd" fontWeight="bold">Card style</Text>
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <Select
                        label="Image ratio"
                        options={[
                          { label: 'Square', value: 'Square' },
                          { label: 'Portrait', value: 'Portrait' },
                          { label: 'Wide', value: 'Wide' },
                        ]}
                        value={formState.imageAspectRatio || 'Square'}
                        onChange={(v) => handleChange('imageAspectRatio', v)}
                      />
                      <Select
                        label="Image fit"
                        options={[
                          { label: 'Cover', value: 'Cover' },
                          { label: 'Contain', value: 'Contain' },
                        ]}
                        value={formState.imageFit || 'Cover'}
                        onChange={(v) => handleChange('imageFit', v)}
                      />
                    </InlineGrid>
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <Select
                        label="Card spacing"
                        options={[
                          { label: 'Compact', value: 'Compact' },
                          { label: 'Comfortable', value: 'Comfortable' },
                          { label: 'Spacious', value: 'Spacious' },
                        ]}
                        value={formState.cardDensity || 'Comfortable'}
                        onChange={(v) => handleChange('cardDensity', v)}
                      />
                      <Select
                        label="Text alignment"
                        options={[
                          { label: 'Left', value: 'Left' },
                          { label: 'Center', value: 'Center' },
                        ]}
                        value={formState.textAlignment || 'Left'}
                        onChange={(v) => handleChange('textAlignment', v)}
                      />
                    </InlineGrid>
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <Select
                        label="Border radius"
                        options={[
                          { label: 'Sharp (4px)', value: '4px' },
                          { label: 'Soft (8px)', value: '8px' },
                          { label: 'Rounded (12px)', value: '12px' },
                          { label: 'Pill (20px)', value: '20px' },
                        ]}
                        value={formState.borderRadius || '8px'}
                        onChange={(v) => handleChange('borderRadius', v)}
                      />
                      <Select
                        label="Shadow"
                        options={[
                          { label: 'None', value: 'None' },
                          { label: 'Soft', value: 'Soft' },
                          { label: 'Lifted', value: 'Lifted' },
                        ]}
                        value={formState.shadowStyle || 'Soft'}
                        onChange={(v) => handleChange('shadowStyle', v)}
                      />
                    </InlineGrid>
                  </BlockStack>
                </Card>

                <Card padding="400">
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd" fontWeight="bold">Product actions</Text>
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <Select
                        label="Button style"
                        options={[
                          { label: 'Solid', value: 'Solid' },
                          { label: 'Outline', value: 'Outline' },
                          { label: 'Subtle', value: 'Subtle' },
                          { label: 'Text link', value: 'Link' },
                        ]}
                        value={formState.buttonStyle || 'Solid'}
                        onChange={(v) => handleChange('buttonStyle', v)}
                      />
                      <TextField label="Button text" value={formState.buttonText} onChange={(v) => handleChange('buttonText', v)} autoComplete="off" />
                    </InlineGrid>
                    <BlockStack gap="200">
                      <Text as="span" variant="bodyMd">Primary color</Text>
                      <div style={{ display: 'grid', gridTemplateColumns: '48px minmax(0, 1fr)', gap: '12px', alignItems: 'center' }}>
                        <input
                          aria-label="Choose primary color"
                          type="color"
                          value={primaryColor}
                          onChange={(event) => handleChange('primaryColor', event.currentTarget.value)}
                          style={{ width: '48px', height: '48px', border: 0, padding: 0, cursor: 'pointer' }}
                        />
                        <TextField
                          label="Hex value"
                          labelHidden
                          value={formState.primaryColor || '#6366f1'}
                          onChange={(v) => handleChange('primaryColor', v)}
                          autoComplete="off"
                        />
                      </div>
                    </BlockStack>
                    <BlockStack gap="300">
                      <CustomToggle checked={formState.showPrice !== false} onChange={(v) => handleChange('showPrice', v)} label="Show price" />
                      <CustomToggle checked={formState.showAddToCart !== false} onChange={(v) => handleChange('showAddToCart', v)} label="Show product button" />
                      <CustomToggle checked={formState.openInNewTab !== false} onChange={(v) => handleChange('openInNewTab', v)} label="Open product in new tab" />
                    </BlockStack>
                    {canCustomCss && (
                      <TextField
                        label="Custom widget CSS"
                        value={formState.customCss || ''}
                        onChange={(v) => handleChange('customCss', v)}
                        autoComplete="off"
                        multiline={4}
                      />
                    )}
                  </BlockStack>
                </Card>
              </BlockStack>

              <Card padding="400">
                <ShoppableDisplayPreview config={formState} />
              </Card>
            </InlineGrid>
          )}

          {selectedTabId === 'content-navigation' && (
            <InlineGrid columns={{ xs: 1, lg: 'minmax(380px, 1fr) minmax(420px, 1fr)' }} gap="400">
              <BlockStack gap="400">
                {contentNavigationLocked && (
                  <Banner tone="info" title="Content navigation is locked on the Free plan">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodyMd">
                        Breadcrumbs and table of contents settings are available on Pro and Growth plans.
                      </Text>
                      <InlineStack>
                        <Button url={`/app/pricing?reason=content_navigation&plan=${planKey}`}>
                          Upgrade plan
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Banner>
                )}

                <Card padding="400">
                  <BlockStack gap="400">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ flexShrink: 0, display: 'flex' }}><Icon source={HomeIcon} tone="base" /></div>
                      <Text as="h2" variant="headingMd" fontWeight="bold">Breadcrumbs</Text>
                    </div>
                    <CustomToggle
                      checked={formState.breadcrumbsEnabled}
                      label="Enable visual breadcrumbs"
                      description="Rendered by block or shortcode on blog article pages."
                      disabled={contentNavigationLocked}
                      onChange={(value) => handleChange('breadcrumbsEnabled', value)}
                    />
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <Select
                        label="Breadcrumb style"
                        disabled={breadcrumbsSettingsDisabled}
                        options={[
                          { label: 'Minimal', value: 'minimal' },
                          { label: 'Slash', value: 'slash' },
                          { label: 'Pills', value: 'pills' },
                          { label: 'Boxed', value: 'boxed' },
                        ]}
                        value={formState.breadcrumbsStyle}
                        onChange={(value) => handleChange('breadcrumbsStyle', value)}
                      />
                      <TextField
                        label="Separator"
                        disabled={breadcrumbsSettingsDisabled}
                        value={formState.breadcrumbsSeparator}
                        maxLength={8}
                        onChange={(value) => handleChange('breadcrumbsSeparator', value)}
                        autoComplete="off"
                      />
                    </InlineGrid>
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <TextField
                        label="Home label"
                        disabled={breadcrumbsSettingsDisabled}
                        value={formState.breadcrumbsHomeLabel}
                        onChange={(value) => handleChange('breadcrumbsHomeLabel', value)}
                        autoComplete="off"
                      />
                      <TextField
                        label="Primary color"
                        disabled={breadcrumbsSettingsDisabled}
                        value={formState.contentNavPrimaryColor}
                        onChange={(value) => handleChange('contentNavPrimaryColor', value)}
                        autoComplete="off"
                        connectedLeft={
                          <input
                            aria-label="Choose content navigation primary color"
                            type="color"
                            disabled={breadcrumbsSettingsDisabled}
                            value={contentNavPrimaryColor}
                            onChange={(event) => handleChange('contentNavPrimaryColor', event.currentTarget.value)}
                            style={{
                              width: '44px',
                              height: '36px',
                              border: 0,
                              padding: 0,
                              cursor: breadcrumbsSettingsDisabled ? 'not-allowed' : 'pointer',
                              opacity: breadcrumbsSettingsDisabled ? 0.6 : 1,
                            }}
                          />
                        }
                      />
                    </InlineGrid>
                <BlockStack gap="300">
                      <CustomToggle disabled={breadcrumbsSettingsDisabled} checked={formState.breadcrumbsShowHome} label="Show home link" onChange={(value) => handleChange('breadcrumbsShowHome', value)} />
                      <CustomToggle disabled={breadcrumbsSettingsDisabled} checked={formState.breadcrumbsShowBlog} label="Show blog link" onChange={(value) => handleChange('breadcrumbsShowBlog', value)} />
                      <CustomToggle disabled={breadcrumbsSettingsDisabled} checked={formState.breadcrumbsCurrentClickable} label="Make current article clickable" onChange={(value) => handleChange('breadcrumbsCurrentClickable', value)} />
                    </BlockStack>
                  </BlockStack>
                </Card>

                <div id="toc-settings">
                  <Card padding="400">
                    <BlockStack gap="400">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ flexShrink: 0, display: 'flex' }}><Icon source={ListBulletedIcon} tone="base" /></div>
                        <Text as="h2" variant="headingMd" fontWeight="bold">Table of contents</Text>
                      </div>
                      <CustomToggle
                        checked={formState.tocEnabled}
                        label="Enable table of contents"
                        description="Generated from H2/H3/H4 headings in the article body."
                        disabled={contentNavigationLocked}
                        onChange={(value) => handleChange('tocEnabled', value)}
                      />
                      <BlockStack gap="500">
                        <CustomToggle
                          disabled={tocSettingsDisabled}
                          checked={formState.tocAutoInsertEnabled}
                          label="Auto insert TOC"
                          description="Automatically place the TOC on article pages when no TOC shortcode or TOC block already exists."
                          onChange={(value) => handleChange('tocAutoInsertEnabled', value)}
                        />
                        {formState.tocAutoInsertEnabled && (
                          <Select
                            label="Auto insert position"
                            disabled={tocSettingsDisabled}
                            options={[
                              { label: 'Under article title', value: 'after-title' },
                              { label: 'After paragraph 1', value: 'after-paragraph-1' },
                              { label: 'After paragraph 2', value: 'after-paragraph-2' },
                              { label: 'After paragraph 3', value: 'after-paragraph-3' },
                            ]}
                            value={formState.tocAutoInsertPosition}
                            onChange={(value) => handleChange('tocAutoInsertPosition', value)}
                          />
                        )}
                      </BlockStack>
                      <TextField
                        label="TOC title"
                        disabled={tocSettingsDisabled}
                        value={formState.tocTitle}
                        onChange={(value) => handleChange('tocTitle', value)}
                        autoComplete="off"
                      />
                      <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                        <Select
                          label="TOC layout"
                          disabled={tocSettingsDisabled}
                          options={[
                            { label: 'Vertical', value: 'vertical' },
                            { label: 'Horizontal', value: 'horizontal' },
                            { label: 'Multi-column', value: 'multicolumn' },
                            { label: 'Left rail (sticky)', value: 'left-rail' },
                            { label: 'Right rail (sticky)', value: 'right-rail' },
                          ]}
                          value={formState.tocLayout || CONTENT_NAV_DEFAULTS.tocLayout}
                          onChange={(value) => handleChange('tocLayout', value)}
                        />
                        <Select
                          label="TOC style"
                          disabled={tocSettingsDisabled}
                          options={[
                            { label: 'Simple', value: 'simple' },
                            { label: 'Boxed', value: 'boxed' },
                            { label: 'Collapsible', value: 'collapsible' },
                          ]}
                          value={formState.tocStyle}
                          onChange={(value) => handleChange('tocStyle', value)}
                        />
                      </InlineGrid>
                      {tocStickyOffsetVisible && (
                        <TextField
                          label="Rail sticky offset"
                          disabled={tocSettingsDisabled}
                          type="number"
                          min={0}
                          max={240}
                          value={String(formState.tocStickyOffset)}
                          onChange={(value) => handleChange('tocStickyOffset', Number(value))}
                          autoComplete="off"
                          helpText="Pixels from the top when left or right rail layout is active."
                        />
                      )}
                      <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                        <Select
                          label="Heading levels"
                          disabled={tocSettingsDisabled}
                          options={[
                            { label: 'H2 only', value: 'h2' },
                            { label: 'H2 and H3', value: 'h2,h3' },
                            { label: 'H2, H3 and H4', value: 'h2,h3,h4' },
                          ]}
                          value={formState.tocLevels}
                          onChange={(value) => handleChange('tocLevels', value)}
                        />
                      </InlineGrid>
                  <BlockStack gap="300">
                        <CustomToggle disabled={tocSettingsDisabled} checked={formState.tocNumbering} label="Show numbering" onChange={(value) => handleChange('tocNumbering', value)} />
                        <CustomToggle disabled={tocSettingsDisabled} checked={formState.tocSmoothScroll} label="Smooth scroll to headings" onChange={(value) => handleChange('tocSmoothScroll', value)} />
                        <CustomToggle disabled={tocSettingsDisabled} checked={formState.tocMobileCollapsed} label="Collapse on mobile" onChange={(value) => handleChange('tocMobileCollapsed', value)} />
                      </BlockStack>
                    </BlockStack>
                  </Card>
                </div>

                <Card padding="400">
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd" fontWeight="bold">Shortcodes</Text>
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <Snippet label="Breadcrumbs" value="[[SBS_BREADCRUMBS]]" />
                      <Snippet label="TOC" value="[[SBS_TOC]]" />
                      <Snippet label="Left rail TOC" value="[[SBS_TOC:left-rail]]" />
                      <Snippet label="Right rail TOC" value="[[SBS_TOC:right-rail]]" />
                      <Snippet label="Collapsible TOC" value="[[SBS_TOC:collapsible]]" />
                    </InlineGrid>
                  </BlockStack>
                </Card>

                {canCustomCss && (
                  <Card padding="400">
                    <TextField
                      label="Custom content navigation CSS"
                      value={formState.contentNavCustomCss || ''}
                      onChange={(value) => handleChange('contentNavCustomCss', value)}
                      autoComplete="off"
                      multiline={5}
                      helpText="Injected only with breadcrumbs and table of contents."
                    />
                  </Card>
                )}
              </BlockStack>

              <Card padding="400">
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd" fontWeight="bold">Preview</Text>
                  <BreadcrumbPreview config={contentNavigationPreviewConfig} />
                  <TocPreview config={contentNavigationPreviewConfig} />
                </BlockStack>
              </Card>
            </InlineGrid>
          )}

          {selectedTabId === 'tracking' && (
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

                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                  <BlockStack gap="100">
                    <Select label="UTM rules" options={['Auto-append to product links', 'Do not append']} value={formState.utmRules} onChange={(v) => handleChange('utmRules', v)} />
                    <Text as="p" variant="bodySm" tone="subdued">Appends UTM parameters to outbound links</Text>
                  </BlockStack>
                </InlineGrid>

                <Divider />

                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="0">
                    <Text as="span" fontWeight="bold">Enable conversion tracking</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Track conversions and revenue from blog traffic</Text>
                  </BlockStack>
                  <CustomToggle checked={formState.enableConversionTracking} onChange={(v) => handleChange('enableConversionTracking', v)} label="Enable conversion tracking" hideLabel />
                </InlineStack>
              </BlockStack>
            </Card>
          )}

          </div>
        </BlockStack>
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

function Snippet({ label, value }: { label: string; value: string }) {
  return (
    <BlockStack gap="100">
      <Text as="span" variant="bodySm" tone="subdued">
        {label}
      </Text>
      <code style={{ display: 'block', padding: '10px 12px', border: '1px solid #D4D4D4', borderRadius: '6px', backgroundColor: '#F6F6F7', overflowWrap: 'anywhere' }}>
        {value}
      </code>
    </BlockStack>
  );
}

function BreadcrumbPreview({ config }: { config: any }) {
  const style = config.breadcrumbsStyle || CONTENT_NAV_DEFAULTS.breadcrumbsStyle;
  const primary = normalizeContentNavHexColor(config.contentNavPrimaryColor);
  const primarySoft = previewColorWithAlpha(primary, 0.1);
  const disabled = !config.breadcrumbsEnabled;
  const parts = [
    config.breadcrumbsShowHome ? config.breadcrumbsHomeLabel || 'Home' : '',
    config.breadcrumbsShowBlog ? 'Journal' : '',
    'How to style summer linen',
  ].filter(Boolean);

  return (
    <div style={{ border: '1px solid #E3E3E3', borderRadius: '8px', padding: '16px', backgroundColor: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', opacity: disabled ? 0.55 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '12px' }}>
        <Text as="h3" variant="headingSm" fontWeight="semibold">Breadcrumbs</Text>
        <span style={{ border: '1px solid #E3E3E3', borderRadius: '999px', padding: '2px 8px', color: '#616161', fontSize: '12px', lineHeight: '18px' }}>
          {style}
        </span>
      </div>
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: style === 'pills' ? '8px' : '4px',
          flexWrap: 'wrap',
          padding: style === 'boxed' ? '10px 12px' : 0,
          border: style === 'boxed' ? '1px solid #E3E3E3' : 0,
          borderRadius: '8px',
          backgroundColor: style === 'boxed' ? '#FAFAFA' : 'transparent',
        }}
      >
        {parts.map((part, index) => {
          const isCurrent = index === parts.length - 1;
          return (
            <span key={part} style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', minWidth: 0 }}>
              {index > 0 && <span style={{ color: primary, fontSize: '12px', fontWeight: 700 }}>{config.breadcrumbsSeparator || '/'}</span>}
              <span
                style={{
                  border: style === 'pills' ? '1px solid #E3E3E3' : '1px solid transparent',
                  borderRadius: style === 'pills' ? '999px' : '6px',
                  backgroundColor: !isCurrent && style === 'pills' ? primarySoft : 'transparent',
                  padding: style === 'pills' ? '5px 10px' : '3px 6px',
                  color: isCurrent ? '#616161' : primary,
                  fontSize: '13px',
                  fontWeight: isCurrent ? 500 : 700,
                  lineHeight: '18px',
                  overflowWrap: 'anywhere',
                }}
              >
                {part}
              </span>
            </span>
          );
        })}
      </nav>
    </div>
  );
}

function TocPreview({ config }: { config: any }) {
  const items = ['Choose the right products', 'Build the article outline', 'Place shoppable sections'];
  const primary = normalizeContentNavHexColor(config.contentNavPrimaryColor);
  const primarySoft = previewColorWithAlpha(primary, 0.1);
  const boxed = (config.tocStyle || CONTENT_NAV_DEFAULTS.tocStyle) !== 'simple';
  const layout = config.tocLayout || CONTENT_NAV_DEFAULTS.tocLayout;
  const isRail = layout === 'left-rail' || layout === 'right-rail';
  const disabled = !config.tocEnabled;
  const tocPanel = (
    <div
      style={{
        border: boxed || isRail ? "1px solid #E5E7EB" : 0,
        borderRadius: "8px",
        padding: boxed || isRail ? "20px" : 0,
        backgroundColor: boxed || isRail ? "#fff" : "transparent",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
        <span style={{ fontSize: "14px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#374151" }}>
          {config.tocTitle || CONTENT_NAV_DEFAULTS.tocTitle}
        </span>
        {config.tocAutoInsertEnabled && !isRail && (
          <span style={{ border: `1px solid ${primarySoft}`, borderRadius: "4px", color: primary, backgroundColor: "transparent", padding: "2px 6px", fontSize: "11px", fontWeight: 500, lineHeight: "16px", whiteSpace: "nowrap" }}>
            Auto: {formatTocAutoInsertPosition(config.tocAutoInsertPosition)}
          </span>
        )}
      </div>
      <div
        style={{
          display: layout === "horizontal" ? "flex" : "flex",
          flexDirection: layout === "horizontal" ? "row" : "column",
          flexWrap: layout === "horizontal" ? "wrap" : undefined,
          gap: layout === "horizontal" ? "12px" : "10px",
        }}
      >
        {items.map((item, index) => {
          const active = index === 0;
          return (
            <div
              key={item}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
                flex: layout === "horizontal" ? "0 1 auto" : undefined,
                border: "none",
                borderRadius: "0",
                padding: "0",
                backgroundColor: "transparent",
                color: active ? primary : "#6B7280",
                fontSize: "14px",
                fontWeight: active ? 600 : 400,
                lineHeight: "1.5",
              }}
            >
              {config.tocNumbering ? (
                <span style={{ minWidth: "18px", color: active ? primary : "#9CA3AF", fontSize: "14px", fontWeight: active ? 600 : 400, fontVariantNumeric: "tabular-nums" }}>
                  {index + 1}.
                </span>
              ) : (
                <span style={{ width: "5px", height: "5px", borderRadius: "50%", backgroundColor: active ? primary : "transparent", border: `1px solid ${active ? primary : "#D1D5DB"}`, flex: "0 0 auto", marginTop: "8px" }} />
              )}
              <span style={{ overflowWrap: "anywhere" }}>{item}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
  const articleMock = (
    <div style={{ display: 'grid', gap: '8px', padding: '8px 4px', minWidth: 0 }}>
      {[72, 92, 84, 64, 88, 74, 58].map((width, index) => (
        <span key={index} style={{ width: `${width}%`, height: index === 0 ? '10px' : '8px', borderRadius: '999px', backgroundColor: index === 0 ? '#D4D4D4' : '#E3E3E3' }} />
      ))}
    </div>
  );

  return (
    <div style={{ border: '1px solid #E3E3E3', borderRadius: '8px', padding: '16px', backgroundColor: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', opacity: disabled ? 0.55 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '12px' }}>
        <Text as="h3" variant="headingSm" fontWeight="semibold">Table of contents</Text>
        <span style={{ border: '1px solid #E3E3E3', borderRadius: '999px', padding: '2px 8px', color: '#616161', fontSize: '12px', lineHeight: '18px' }}>
          {config.tocStyle || CONTENT_NAV_DEFAULTS.tocStyle} / {layout}
        </span>
      </div>
      {isRail ? (
        <div
          style={{
            border: '1px solid #E3E3E3',
            borderRadius: '8px',
            padding: '14px',
            backgroundColor: '#FAFAFA',
            display: 'grid',
            gridTemplateColumns: layout === 'left-rail' ? 'minmax(145px, 0.62fr) minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(145px, 0.62fr)',
            gap: '14px',
            alignItems: 'start',
          }}
        >
          {layout === 'left-rail' ? tocPanel : articleMock}
          {layout === 'left-rail' ? articleMock : tocPanel}
        </div>
      ) : (
        tocPanel
      )}
    </div>
  );
}

function previewColorWithAlpha(hex: string, alpha: number) {
  const normalized = normalizeContentNavHexColor(hex).replace('#', '');
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function formatTocAutoInsertPosition(value: string) {
  switch (value) {
    case 'after-paragraph-1':
      return 'after paragraph 1';
    case 'after-paragraph-2':
      return 'after paragraph 2';
    case 'after-paragraph-3':
      return 'after paragraph 3';
    default:
      return 'under article title';
  }
}
