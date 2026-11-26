import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { unstable_usePrompt, useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import {
  Banner,
  Card,
  Text,
  BlockStack,
  InlineStack,
  TextField,
  Select,
  Button,
  InlineGrid,
  Badge,
  Checkbox,
  Layout,
} from "@shopify/polaris";
import {
  SettingsIcon,
  LayoutColumns3Icon,
  ListBulletedIcon,
  ChartVerticalIcon,
  MagicIcon,
  ConnectIcon,
  ThemeIcon,
  CreditCardIcon,
  NoteIcon,
} from "@shopify/polaris-icons";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import { SearchConsoleCard } from "../components/SearchConsoleCard";
import { loadSearchConsoleView } from "../search-console-view.server";
import { getAiUsageStatus } from "../ai-usage.server";
import { checkWebPixel, loadTrackingActivity } from "../setup-status.server";
import { SETTINGS_TAB_DEFAULTS, isResettableSettingsTab } from "../settings-defaults";
import { ATTRIBUTION_WINDOW_OPTIONS } from "../analytics-core";
import { isNineRouterConfigured } from "../ai-seo.server";
import {
  BRAND_TONES,
  CONTENT_LANGUAGES,
  DEFAULT_CONTENT_STRUCTURE,
  DEFAULT_META_DESCRIPTION_TEMPLATE,
  DEFAULT_META_TITLE_TEMPLATE,
  META_TEMPLATE_TOKENS,
  parseForbiddenWords,
  renderMetaTemplate,
  suggestedLanguageForCountry,
  type BrandTone,
} from "../ai-writing-rules";

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
import { AppPage } from "../components/AppPage";
import { IconTile } from "../components/rm";

const META_TEMPLATE_PREVIEW = {
  title: "How to choose trail running shoes",
  blog: "Guides",
  store: "Peak Outfitters",
  excerpt: "Fit, grip and cushioning explained so you can pick the right pair.",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
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

  const [searchConsole, aiUsage, webPixelEnabled, trackingActivity, suggestedLanguage] = await Promise.all([
    loadSearchConsoleView(shop, limits.canSearchConsole),
    getAiUsageStatus(shop, limits.aiRequestsPerMonth),
    checkWebPixel(admin),
    loadTrackingActivity(shop),
    // Only suggest while the language is still the untouched default.
    config.language === "English" ? loadSuggestedLanguage(admin) : Promise.resolve(null),
  ]);
  // Internal bookkeeping columns are not settings and never round-trip through the form.
  const { planKey: _planKey, planCheckedAt: _planCheckedAt, uninstalledAt: _uninstalledAt, markersMigratedAt: _markersMigratedAt, timezone: _timezone, currencyCode: _currencyCode, ...settings } = config;

  return {
    config: { ...settings, ...normalizeContentNavConfig(settings) },
    tracking: { webPixelEnabled, ...trackingActivity },
    suggestedLanguage,
    searchConsole,
    aiStatus: { configured: isNineRouterConfigured(), usage: aiUsage },
    canContentNavigation: limits.canContentNavigation,
    canCustomCss: limits.canCustomCss,
    section: getSettingsSection(url.searchParams.get("tab")),
    planKey,
  };
};

async function loadSuggestedLanguage(admin: any) {
  try {
    const response = await admin.graphql(`#graphql
      query SettingsShopCountry { shop { billingAddress { countryCodeV2 } } }`);
    const payload: any = await response.json();
    const language = suggestedLanguageForCountry(String(payload.data?.shop?.billingAddress?.countryCodeV2 || ""));
    return language && language !== "English" ? language : null;
  } catch {
    return null;
  }
}

/** Settings index when no section is requested. "toc" is an old alias. */
function getSettingsSection(tab: string | null): SettingsSectionId | null {
  if (tab === "toc") return "content-navigation";
  return SETTINGS_SECTIONS.some((section) => section.id === tab) ? (tab as SettingsSectionId) : null;
}

const SETTINGS_SECTIONS = [
  { id: "general", title: "General", description: "App status and how your data is kept." },
  { id: "display", title: "Storefront display", description: "How products appear inside blog posts: layout, cards, colors and buttons." },
  { id: "content-navigation", title: "Breadcrumbs & table of contents", description: "Breadcrumb navigation and the automatic table of contents." },
  { id: "tracking", title: "Tracking & attribution", description: "Checkout pixel, attribution window and UTM links." },
  { id: "rules", title: "Titles, meta & AI rules", description: "Meta tag templates, content language, brand tone and words AI must avoid." },
  { id: "integrations", title: "Integrations", description: "Google Search Console and the AI assistant." },
] as const;
type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/** Pages outside this route that belong to Settings. */
const SETTINGS_LINKS = [
  { url: "/app/theme-setup", title: "Theme setup", description: "Install the app embed and blocks on your theme and see what is installed." },
  { url: "/app/pricing", title: "Plan & billing", description: "Your plan, AI allowance and upgrades." },
  { url: "/app/changelog", title: "What's new", description: "Recent improvements to the app." },
];

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
      attributionWindow: pickSettingChoice(formData, "attributionWindow", ATTRIBUTION_WINDOW_OPTIONS, "7 days"),
      language: pickSettingChoice(formData, "language", CONTENT_LANGUAGES, "English"),
      brandTone: pickSettingChoice(formData, "brandTone", BRAND_TONES, "Professional"),
      forbiddenWords: parseForbiddenWords(String(formData.get("forbiddenWords") || "")).join(", "),
      defaultContentStructure: cleanSettingText(formData.get("defaultContentStructure"), 300, DEFAULT_CONTENT_STRUCTURE),
      metaTitleTemplate: cleanSettingText(formData.get("metaTitleTemplate"), 200, DEFAULT_META_TITLE_TEMPLATE),
      metaDescriptionTemplate: cleanSettingText(formData.get("metaDescriptionTemplate"), 300, DEFAULT_META_DESCRIPTION_TEMPLATE),
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
/** Polaris checkbox with the old toggle's props, so every call site stays the same. */
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
  <Checkbox label={label} labelHidden={hideLabel} helpText={hideLabel ? undefined : description} checked={checked} disabled={disabled} onChange={(value) => onChange(value)} />
);

export default function SettingsRoute() {
  const { section } = useLoaderData<typeof loader>();
  return section ? <Settings key={section} section={section} /> : <SettingsIndex />;
}

/** Settings index, like Shopify's own Settings: one list of sections. */
/** Visual identity of each settings entry on the index. */
const SETTINGS_ICONS: Record<string, { icon: any; tone: "plain" | "brand" | "good" | "warn" | "dark" }> = {
  general: { icon: SettingsIcon, tone: "plain" },
  display: { icon: LayoutColumns3Icon, tone: "brand" },
  "content-navigation": { icon: ListBulletedIcon, tone: "good" },
  tracking: { icon: ChartVerticalIcon, tone: "warn" },
  rules: { icon: MagicIcon, tone: "brand" },
  integrations: { icon: ConnectIcon, tone: "plain" },
  "/app/theme-setup": { icon: ThemeIcon, tone: "good" },
  "/app/pricing": { icon: CreditCardIcon, tone: "dark" },
  "/app/changelog": { icon: NoteIcon, tone: "plain" },
};

function SettingsIndex() {
  const navigate = useNavigate();
  const items = [
    ...SETTINGS_SECTIONS.map((section) => ({ key: section.id, url: `/app/settings?tab=${section.id}`, title: section.title, description: section.description })),
    ...SETTINGS_LINKS.map((link) => ({ key: link.url, ...link })),
  ];
  return (
    <AppPage title="Settings" subtitle="How the app looks on your storefront, what it tracks and how AI writes.">
      <div className="rm-setting-grid">
        {items.map((item) => {
          const look = SETTINGS_ICONS[item.key] || { icon: SettingsIcon, tone: "plain" as const };
          return (
            <button key={item.key} type="button" className="rm-setting" onClick={() => navigate(item.url)}>
              <IconTile icon={look.icon} tone={look.tone} />
              <span>
                <span className="rm-setting__title">{item.title}</span>
                <span className="rm-setting__text">{item.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </AppPage>
  );
}

function Settings({ section }: { section: SettingsSectionId }) {
  const { config, tracking, suggestedLanguage, searchConsole, aiStatus, canContentNavigation, canCustomCss, planKey } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const pixelFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const pixelConnected = tracking.webPixelEnabled === true || Boolean(pixelFetcher.data?.success);
  useEffect(() => {
    if (pixelFetcher.state !== "idle" || !pixelFetcher.data) return;
    if (pixelFetcher.data.success) shopify.toast.show("Tracking pixel connected");
    else if (pixelFetcher.data.error) shopify.toast.show(pixelFetcher.data.error, { isError: true });
  }, [pixelFetcher.state, pixelFetcher.data, shopify]);

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

  // Fills the tab with default values; nothing is saved until the merchant clicks Save.
  const handleResetTab = (tab: string) => {
    if (!isResettableSettingsTab(tab)) return;
    setFormState((previous) => ({ ...previous, ...SETTINGS_TAB_DEFAULTS[tab] }));
    shopify.toast.show("Defaults applied. Review and save to keep them.");
  };

  const selectedTabId = section;
  const sectionMeta = SETTINGS_SECTIONS.find((item) => item.id === section) || SETTINGS_SECTIONS[0];
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
    <AppPage
      title={sectionMeta.title}
      subtitle={sectionMeta.description}
      fullWidth={section === 'display' || section === 'content-navigation'}
      backAction={{ content: "Settings", url: "/app/settings" }}
      titleMetadata={hasChanges ? <Badge tone="attention">Unsaved changes</Badge> : undefined}
      secondaryActions={isResettableSettingsTab(section) ? [{ content: "Reset to defaults", onAction: () => handleResetTab(section), disabled: section === 'content-navigation' && contentNavigationLocked }] : []}
    >
          <div>
          {selectedTabId === 'general' && (
            <Layout>
              <Layout.AnnotatedSection
                title="App status"
                description="When the app is inactive, products, breadcrumbs and the table of contents are hidden on your storefront and no tracking data is collected. Settings and data are kept."
              >
                <Card>
                  <InlineStack align="space-between" blockAlign="center" gap="300">
                    <Checkbox label="App is active on the storefront" checked={formState.appStatus} onChange={(value) => handleChange('appStatus', value)} />
                    <Badge tone={formState.appStatus ? 'success' : undefined}>{formState.appStatus ? 'Active' : 'Inactive'}</Badge>
                  </InlineStack>
                </Card>
              </Layout.AnnotatedSection>
              <Layout.AnnotatedSection title="Your data" description="How plan changes and uninstalling affect what the app stores.">
                <Card>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd">Changing plans never deletes settings: features outside your plan stop applying and come back when you upgrade.</Text>
                    <Text as="p" variant="bodyMd">If you uninstall the app, your data is kept for 48 hours so reinstalling restores everything, then it is permanently deleted.</Text>
                    <InlineStack><Button variant="plain" url="/privacy" target="_blank">Privacy policy</Button></InlineStack>
                  </BlockStack>
                </Card>
              </Layout.AnnotatedSection>
            </Layout>
          )}

          {selectedTabId === 'display' && (
            <BlockStack gap="300">
            <Banner tone="info">
              <p>These settings style products placed inside post content. A Product Carousel or Product Grid block added in the theme editor uses its own block settings (for example, grid columns) and these settings for everything else.</p>
            </Banner>
            <InlineGrid columns={{ xs: 1, lg: 'minmax(380px, 1fr) minmax(420px, 1fr)' }} gap="400">
              <BlockStack gap="400">
                <Card padding="400">
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">Display mode</Text>
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
            </BlockStack>
          )}

          {selectedTabId === 'content-navigation' && (
            <BlockStack gap="300">
            {!contentNavigationLocked && (
              <Banner tone="info">
                <p>These settings apply to the automatic table of contents and to navigation placed inside post content. Breadcrumbs or Table of Contents blocks added in the theme editor use their own block settings first.</p>
              </Banner>
            )}
            <InlineGrid columns={{ xs: 1, lg: 'minmax(380px, 1fr) minmax(420px, 1fr)' }} gap="400">
              <BlockStack gap="400">
                {contentNavigationLocked && (
                  <Banner tone="info" title="Content navigation requires Pro or Growth">
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
                    <Text as="h2" variant="headingMd">Breadcrumbs</Text>
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
                      <Text as="h2" variant="headingMd">Table of contents</Text>
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
            </BlockStack>
          )}

          {selectedTabId === 'tracking' && (
            <Layout>
              <Layout.AnnotatedSection title="Status" description="Whether tracking is on, the checkout pixel is connected, and data is arriving.">
                <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
                  <TrackingFact
                    label="Conversion tracking"
                    ok={formState.enableConversionTracking && formState.appStatus}
                    value={!formState.appStatus ? 'Paused (app is inactive)' : formState.enableConversionTracking ? 'On' : 'Off'}
                  />
                  <TrackingFact
                    label="Checkout pixel"
                    ok={pixelConnected}
                    value={pixelConnected ? 'Connected' : tracking.webPixelEnabled === null ? 'Could not check' : 'Not connected'}
                    hint={pixelConnected ? undefined : 'Needed to credit add-to-carts and orders to posts.'}
                    action={pixelConnected ? undefined : <Button size="slim" loading={pixelFetcher.state !== 'idle'} onClick={() => pixelFetcher.submit({ intent: 'activate_pixel' }, { method: 'post', action: '/app/dashboard-status' })}>Connect pixel</Button>}
                  />
                  <TrackingFact
                    label="Last event received"
                    ok={Boolean(tracking.lastEventAt)}
                    value={tracking.lastEventAt ? formatRelative(tracking.lastEventAt) : 'None yet'}
                    hint={tracking.lastPurchaseAt ? `Last order credited ${formatRelative(tracking.lastPurchaseAt)}` : 'Events appear after readers visit a post with linked products.'}
                  />
                </InlineGrid>
              </Layout.AnnotatedSection>
              <Layout.AnnotatedSection title="Conversion tracking" description="Credit product clicks, add-to-carts and orders to the post that sent the shopper.">
                <Card>
                  <BlockStack gap="400">
                    <Checkbox
                      label="Track conversions and revenue from blog traffic"
                      checked={formState.enableConversionTracking}
                      onChange={(value) => handleChange('enableConversionTracking', value)}
                    />
                    <Select
                      label="Attribution window"
                      options={ATTRIBUTION_WINDOW_OPTIONS.map((option) => ({ label: option, value: option }))}
                      value={ATTRIBUTION_WINDOW_OPTIONS.includes(formState.attributionWindow as (typeof ATTRIBUTION_WINDOW_OPTIONS)[number]) ? formState.attributionWindow : '7 days'}
                      onChange={(v) => handleChange('attributionWindow', v)}
                      helpText="How long after a product click an add-to-cart or order is credited to that post. Applies to new clicks."
                    />
                  </BlockStack>
                </Card>
              </Layout.AnnotatedSection>
              <Layout.AnnotatedSection title="UTM links" description="Campaign parameters for your own analytics tools.">
                <Card>
                  <Select label="UTM rules" options={['Auto-append to product links', 'Do not append']} value={formState.utmRules} onChange={(v) => handleChange('utmRules', v)} helpText="UTMs are added only when a shopper clicks. Search engines always see clean product links, and conversion tracking works either way." />
                </Card>
              </Layout.AnnotatedSection>
            </Layout>
          )}

          {selectedTabId === 'rules' && (
            <BlockStack gap="400">
              <Card padding="400">
                <BlockStack gap="400">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd" fontWeight="bold">AI writing rules</Text>
                    <Text as="p" variant="bodyMd" tone="subdued">Applied to every AI generation in the app: post drafts, rewrites, SEO fixes, FAQs, briefs, catalog copy, alt text and internal link anchors.</Text>
                  </BlockStack>
                  {suggestedLanguage && formState.language === 'English' && (
                    <Banner tone="info" title={`Write new content in ${suggestedLanguage}?`} action={{ content: `Use ${suggestedLanguage}`, onAction: () => handleChange('language', suggestedLanguage) }}>
                      <p>Your store's address suggests your shoppers read {suggestedLanguage}. AI currently writes new posts in English.</p>
                    </Banner>
                  )}
                  <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
                    <Select
                      label="Content language"
                      options={CONTENT_LANGUAGES.map((language) => ({ label: language, value: language }))}
                      value={CONTENT_LANGUAGES.includes(formState.language as (typeof CONTENT_LANGUAGES)[number]) ? formState.language : 'English'}
                      onChange={(value) => handleChange('language', value)}
                      helpText="For new posts and drafts. Rewrites keep the post's existing language."
                    />
                    <Select
                      label="Brand tone"
                      options={BRAND_TONES.map((tone) => ({ label: tone, value: tone }))}
                      value={BRAND_TONES.includes(formState.brandTone as BrandTone) ? formState.brandTone : 'Professional'}
                      onChange={(value) => handleChange('brandTone', value)}
                    />
                    <TextField
                      label="Article structure"
                      value={formState.defaultContentStructure || ''}
                      onChange={(value) => handleChange('defaultContentStructure', value)}
                      maxLength={300}
                      autoComplete="off"
                      helpText="Used when AI writes a full article draft."
                    />
                  </InlineGrid>
                  <TextField
                    label="Words and phrases AI must never use"
                    value={formState.forbiddenWords || ''}
                    onChange={(value) => handleChange('forbiddenWords', value)}
                    multiline={3}
                    maxLength={1000}
                    autoComplete="off"
                    helpText={`Separate with commas or new lines. ${parseForbiddenWords(formState.forbiddenWords).length} of 50 used.`}
                  />
                </BlockStack>
              </Card>

              <Card padding="400">
                <BlockStack gap="400">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd" fontWeight="bold">Meta tag templates</Text>
                    <Text as="p" variant="bodyMd" tone="subdued">Starting suggestions in SEO Analyzer → Meta tags. Available tokens: {META_TEMPLATE_TOKENS.join(', ')}. Empty tokens are removed with their separator.</Text>
                  </BlockStack>
                  <TextField
                    label="SEO title template"
                    value={formState.metaTitleTemplate || ''}
                    onChange={(value) => handleChange('metaTitleTemplate', value)}
                    maxLength={200}
                    autoComplete="off"
                    helpText={`Preview: ${renderMetaTemplate(formState.metaTitleTemplate || DEFAULT_META_TITLE_TEMPLATE, META_TEMPLATE_PREVIEW) || '—'}`}
                  />
                  <TextField
                    label="Meta description template"
                    value={formState.metaDescriptionTemplate || ''}
                    onChange={(value) => handleChange('metaDescriptionTemplate', value)}
                    maxLength={300}
                    autoComplete="off"
                    helpText={`Preview: ${renderMetaTemplate(formState.metaDescriptionTemplate || DEFAULT_META_DESCRIPTION_TEMPLATE, META_TEMPLATE_PREVIEW) || '—'}`}
                  />
                </BlockStack>
              </Card>
            </BlockStack>
          )}

          {selectedTabId === 'integrations' && (
            <BlockStack gap="400">
              <SearchConsoleCard data={searchConsole} mode="connection" planKey={planKey} />
              <Card padding="400">
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd" fontWeight="bold">AI assistant</Text>
                    <div style={{ backgroundColor: aiStatus.configured ? '#E8F5E9' : '#F1F2F3', color: aiStatus.configured ? '#29845A' : '#6D7175', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }}>
                      {aiStatus.configured ? 'Connected' : 'Not configured'}
                    </div>
                  </InlineStack>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {aiStatus.usage.limit === null
                      ? `${aiStatus.usage.used} AI generations used this month.`
                      : `${aiStatus.usage.used} of ${aiStatus.usage.limit} AI generations used this month · resets ${new Date(aiStatus.usage.resetsAt).toLocaleDateString()}.`}
                  </Text>
                  <InlineStack gap="200">
                    <Button onClick={() => navigate('/app/settings?tab=rules')}>Edit AI writing rules</Button>
                    <Button variant="plain" url="/app/pricing">Get more AI generations</Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </BlockStack>
          )}

          </div>

      <SaveBar id="settings-save-bar" open={hasChanges}>
        <button variant="primary" onClick={handleSave} loading={fetcher.state !== 'idle' ? '' : undefined}>Save</button>
        <button onClick={handleDiscard}>Discard</button>
      </SaveBar>
    </AppPage>
  );
}

function TrackingFact({ label, value, ok, hint, action }: { label: string; value: string; ok: boolean; hint?: string; action?: React.ReactNode }) {
  return (
    <Card padding="300">
      <BlockStack gap="100">
        <Text as="span" variant="bodySm" tone="subdued">{label}</Text>
        <InlineStack gap="100" blockAlign="center">
          <div style={{ width: '8px', height: '8px', borderRadius: '4px', backgroundColor: ok ? '#29845A' : '#B98900' }} />
          <Text as="span" fontWeight="semibold">{value}</Text>
        </InlineStack>
        {hint && <Text as="p" variant="bodySm" tone="subdued">{hint}</Text>}
        {action}
      </BlockStack>
    </Card>
  );
}

function formatRelative(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
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
