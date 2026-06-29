import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import {
  BlockStack,
  Button,
  Card,
  Icon,
  InlineGrid,
  InlineStack,
  Page,
  Select,
  Tabs,
  Text,
  TextField,
} from "@shopify/polaris";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  HomeIcon,
  ListBulletedIcon,
  LockIcon,
  StarFilledIcon,
} from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  BREADCRUMB_STYLE_OPTIONS,
  CONTENT_NAV_DEFAULTS,
  TOC_AUTO_INSERT_POSITION_OPTIONS,
  TOC_LAYOUT_OPTIONS,
  TOC_LEVEL_OPTIONS,
  TOC_STYLE_OPTIONS,
  clampNumber,
  normalizeContentNavConfig,
  normalizeHexColor,
  pickValue,
} from "../content-navigation";
import prisma from "../db.server";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const { limits, planKey } = await getActivePlanAndLimits(billing);

  let config = await prisma.shopConfig.findUnique({
    where: { shop },
  });

  if (!config) {
    config = await prisma.shopConfig.create({
      data: { shop },
    });
  }

  return json({
    config: normalizeContentNavConfig(config),
    canCustomCss: limits.canCustomCss,
    planKey,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const { limits } = await getActivePlanAndLimits(billing);
  const formData = await request.formData();

  const updates = {
    breadcrumbsEnabled: formData.get("breadcrumbsEnabled") === "true",
    breadcrumbsStyle: pickValue(
      formData.get("breadcrumbsStyle"),
      BREADCRUMB_STYLE_OPTIONS,
      CONTENT_NAV_DEFAULTS.breadcrumbsStyle,
    ),
    breadcrumbsShowHome: formData.get("breadcrumbsShowHome") === "true",
    breadcrumbsHomeLabel: String(formData.get("breadcrumbsHomeLabel") || "Home").trim() || "Home",
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
    tocTitle: String(formData.get("tocTitle") || "Table of contents").trim() || "Table of contents",
    tocLevels: pickValue(formData.get("tocLevels"), TOC_LEVEL_OPTIONS, CONTENT_NAV_DEFAULTS.tocLevels),
    tocStyle: pickValue(formData.get("tocStyle"), TOC_STYLE_OPTIONS, CONTENT_NAV_DEFAULTS.tocStyle),
    tocLayout: pickValue(formData.get("tocLayout"), TOC_LAYOUT_OPTIONS, CONTENT_NAV_DEFAULTS.tocLayout),
    tocNumbering: formData.get("tocNumbering") === "true",
    tocSmoothScroll: formData.get("tocSmoothScroll") === "true",
    tocMobileCollapsed: formData.get("tocMobileCollapsed") === "true",
    tocStickyOffset: clampNumber(formData.get("tocStickyOffset"), 0, 240, CONTENT_NAV_DEFAULTS.tocStickyOffset),
    contentNavPrimaryColor: normalizeHexColor(formData.get("contentNavPrimaryColor")),
    ...(limits.canCustomCss
      ? { contentNavCustomCss: String(formData.get("contentNavCustomCss") || "") }
      : {}),
  };

  const config = await prisma.shopConfig.update({
    where: { shop },
    data: updates,
  });

  return json({ success: true, config: normalizeContentNavConfig(config) });
};

const Toggle = ({
  checked,
  label,
  description,
  disabled = false,
  onChange,
}: {
  checked: boolean;
  label: string;
  description?: string;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) => (
  <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", opacity: disabled ? 0.6 : 1 }}>
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      style={{
        width: "36px",
        height: "20px",
        borderRadius: "10px",
        border: 0,
        backgroundColor: checked ? "#29845A" : "#C9CCCF",
        position: "relative",
        flexShrink: 0,
        marginTop: "2px",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span
        style={{
          width: "16px",
          height: "16px",
          borderRadius: "8px",
          backgroundColor: "#fff",
          position: "absolute",
          top: "2px",
          right: checked ? "2px" : "auto",
          left: checked ? "auto" : "2px",
          transition: "all 0.2s",
        }}
      />
    </button>
    <BlockStack gap="0">
      <Text as="span" variant="bodyMd" fontWeight="semibold">
        {label}
      </Text>
      {description && (
        <Text as="p" variant="bodySm" tone="subdued">
          {description}
        </Text>
      )}
    </BlockStack>
  </div>
);

export default function ContentNavigationSettings() {
  const { config, canCustomCss, planKey } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const [formState, setFormState] = useState(config);
  const [savedState, setSavedState] = useState(config);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setFormState(config);
    setSavedState(config);
  }, [config]);

  useEffect(() => {
    setHasChanges(JSON.stringify(formState) !== JSON.stringify(savedState));
  }, [formState, savedState]);

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.config) {
      setSavedState(fetcher.data.config);
      setFormState(fetcher.data.config);
      shopify.toast.show("Content navigation settings saved");
    }
  }, [fetcher.data, shopify]);

  const handleChange = (key: keyof typeof formState, value: unknown) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    const data = new FormData();
    Object.entries(formState).forEach(([key, value]) => {
      data.append(key, value == null ? "" : String(value));
    });
    fetcher.submit(data, { method: "POST" });
  };

  const primaryColor = normalizeHexColor(formState.contentNavPrimaryColor);
  const breadcrumbsSettingsDisabled = !formState.breadcrumbsEnabled;
  const tocSettingsDisabled = !formState.tocEnabled;
  const tocStickyOffsetVisible = ["left-rail", "right-rail"].includes(String(formState.tocLayout || ""));
  const [selectedTab, setSelectedTab] = useState(0);
  const settingsTabs = [
    {
      id: "breadcrumbs",
      content: "Breadcrumbs",
      panelID: "breadcrumbs-panel",
    },
    {
      id: "toc",
      content: "Table of contents",
      panelID: "toc-panel",
    },
    {
      id: "shortcodes",
      content: "Shortcodes",
      panelID: "shortcodes-panel",
    },
    {
      id: "advanced-css",
      content: "Advanced CSS",
      panelID: "advanced-css-panel",
    },
  ];

  return (
    <Page fullWidth>
      <BlockStack gap="500">
        <InlineStack align="space-between" blockAlign="start" gap="400">
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={ListBulletedIcon} tone="base" />
              <Text as="h1" variant="headingLg" fontWeight="bold">
                Content navigation
              </Text>
            </InlineStack>
            <Text as="p" variant="bodyMd" tone="subdued">
              Configure advanced breadcrumbs, article table of contents, shortcode output, and storefront navigation styling.
            </Text>
          </BlockStack>
          <InlineStack gap="200" blockAlign="center">
            <Button onClick={() => navigate("/app/settings")}>Back to settings</Button>
            {!hasChanges && (
              <InlineStack gap="100" blockAlign="center">
                <Icon source={CheckCircleIcon} tone="success" />
                <Text as="span" tone="success">
                  All changes saved
                </Text>
              </InlineStack>
            )}
          </InlineStack>
        </InlineStack>

        <InlineGrid columns={{ xs: 1, lg: "minmax(360px, 0.95fr) minmax(420px, 1.25fr)" }} gap="400">
          <Card padding="400">
            <BlockStack gap="400">
              <Tabs tabs={settingsTabs} selected={selectedTab} onSelect={setSelectedTab} />

              <div id={settingsTabs[selectedTab].panelID}>
                {selectedTab === 0 && (
                  <BlockStack gap="400">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={HomeIcon} tone="base" />
                      <Text as="h2" variant="headingMd" fontWeight="bold">
                        Breadcrumbs
                      </Text>
                    </InlineStack>
                    <Toggle
                      checked={formState.breadcrumbsEnabled}
                      label="Enable visual breadcrumbs"
                      description="Rendered by block or shortcode on blog article pages."
                      onChange={(value) => handleChange("breadcrumbsEnabled", value)}
                    />
                    <InlineGrid columns={2} gap="300">
                      <Select
                        label="Breadcrumb style"
                        disabled={breadcrumbsSettingsDisabled}
                        options={[
                          { label: "Minimal", value: "minimal" },
                          { label: "Slash", value: "slash" },
                          { label: "Pills", value: "pills" },
                          { label: "Boxed", value: "boxed" },
                        ]}
                        value={formState.breadcrumbsStyle}
                        onChange={(value) => handleChange("breadcrumbsStyle", value)}
                      />
                      <TextField
                        label="Separator"
                        disabled={breadcrumbsSettingsDisabled}
                        value={formState.breadcrumbsSeparator}
                        maxLength={8}
                        onChange={(value) => handleChange("breadcrumbsSeparator", value)}
                        autoComplete="off"
                      />
                    </InlineGrid>
                    <InlineGrid columns={2} gap="300">
                      <TextField
                        label="Home label"
                        disabled={breadcrumbsSettingsDisabled}
                        value={formState.breadcrumbsHomeLabel}
                        onChange={(value) => handleChange("breadcrumbsHomeLabel", value)}
                        autoComplete="off"
                      />
                      <TextField
                        label="Primary color"
                        disabled={breadcrumbsSettingsDisabled}
                        value={formState.contentNavPrimaryColor}
                        onChange={(value) => handleChange("contentNavPrimaryColor", value)}
                        autoComplete="off"
                        connectedLeft={
                          <input
                            aria-label="Choose content navigation primary color"
                            type="color"
                            disabled={breadcrumbsSettingsDisabled}
                            value={primaryColor}
                            onChange={(event) => handleChange("contentNavPrimaryColor", event.currentTarget.value)}
                            style={{
                              width: "44px",
                              height: "36px",
                              border: 0,
                              padding: 0,
                              cursor: breadcrumbsSettingsDisabled ? "not-allowed" : "pointer",
                              opacity: breadcrumbsSettingsDisabled ? 0.6 : 1,
                            }}
                          />
                        }
                      />
                    </InlineGrid>
                    <BlockStack gap="250">
                      <Toggle
                        disabled={breadcrumbsSettingsDisabled}
                        checked={formState.breadcrumbsShowHome}
                        label="Show home link"
                        onChange={(value) => handleChange("breadcrumbsShowHome", value)}
                      />
                      <Toggle
                        disabled={breadcrumbsSettingsDisabled}
                        checked={formState.breadcrumbsShowBlog}
                        label="Show blog link"
                        onChange={(value) => handleChange("breadcrumbsShowBlog", value)}
                      />
                      <Toggle
                        disabled={breadcrumbsSettingsDisabled}
                        checked={formState.breadcrumbsCurrentClickable}
                        label="Make current article clickable"
                        onChange={(value) => handleChange("breadcrumbsCurrentClickable", value)}
                      />
                    </BlockStack>
                  </BlockStack>
                )}

                {selectedTab === 1 && (
                  <BlockStack gap="400">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={ListBulletedIcon} tone="base" />
                      <Text as="h2" variant="headingMd" fontWeight="bold">
                        Table of contents
                      </Text>
                    </InlineStack>
                    <Toggle
                      checked={formState.tocEnabled}
                      label="Enable table of contents"
                      description="Generated from H2/H3/H4 headings in the article body."
                      onChange={(value) => handleChange("tocEnabled", value)}
                    />
                    <BlockStack gap="250">
                      <Toggle
                        disabled={tocSettingsDisabled}
                        checked={formState.tocAutoInsertEnabled}
                        label="Auto insert TOC"
                        description="Automatically place the TOC on article pages when no TOC shortcode or TOC block already exists."
                        onChange={(value) => handleChange("tocAutoInsertEnabled", value)}
                      />
                      {formState.tocAutoInsertEnabled && (
                        <Select
                          label="Auto insert position"
                          disabled={tocSettingsDisabled}
                          options={[
                            { label: "Under article title", value: "after-title" },
                            { label: "After paragraph 1", value: "after-paragraph-1" },
                            { label: "After paragraph 2", value: "after-paragraph-2" },
                            { label: "After paragraph 3", value: "after-paragraph-3" },
                          ]}
                          value={formState.tocAutoInsertPosition}
                          onChange={(value) => handleChange("tocAutoInsertPosition", value)}
                        />
                      )}
                    </BlockStack>
                    <TextField
                      label="TOC title"
                      disabled={tocSettingsDisabled}
                      value={formState.tocTitle}
                      onChange={(value) => handleChange("tocTitle", value)}
                      autoComplete="off"
                    />
                    <InlineGrid columns={2} gap="300">
                      <Select
                        label="TOC layout"
                        disabled={tocSettingsDisabled}
                        options={[
                          { label: "Vertical", value: "vertical" },
                          { label: "Horizontal", value: "horizontal" },
                          { label: "Multi-column", value: "multicolumn" },
                          { label: "Left rail (sticky)", value: "left-rail" },
                          { label: "Right rail (sticky)", value: "right-rail" },
                        ]}
                        value={formState.tocLayout || CONTENT_NAV_DEFAULTS.tocLayout}
                        onChange={(value) => handleChange("tocLayout", value)}
                      />
                      <Select
                        label="TOC style"
                        disabled={tocSettingsDisabled}
                        options={[
                          { label: "Simple", value: "simple" },
                          { label: "Boxed", value: "boxed" },
                          { label: "Collapsible", value: "collapsible" },
                        ]}
                        value={formState.tocStyle}
                        onChange={(value) => handleChange("tocStyle", value)}
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
                        onChange={(value) => handleChange("tocStickyOffset", Number(value))}
                        autoComplete="off"
                        helpText="Pixels from the top when left or right rail layout is active."
                      />
                    )}
                    <InlineGrid columns={2} gap="300">
                      <Select
                        label="Heading levels"
                        disabled={tocSettingsDisabled}
                        options={[
                          { label: "H2 only", value: "h2" },
                          { label: "H2 and H3", value: "h2,h3" },
                          { label: "H2, H3 and H4", value: "h2,h3,h4" },
                        ]}
                        value={formState.tocLevels}
                        onChange={(value) => handleChange("tocLevels", value)}
                      />
                    </InlineGrid>
                    <BlockStack gap="250">
                      <Toggle
                        disabled={tocSettingsDisabled}
                        checked={formState.tocNumbering}
                        label="Show numbering"
                        onChange={(value) => handleChange("tocNumbering", value)}
                      />
                      <Toggle
                        disabled={tocSettingsDisabled}
                        checked={formState.tocSmoothScroll}
                        label="Smooth scroll to headings"
                        onChange={(value) => handleChange("tocSmoothScroll", value)}
                      />
                      <Toggle
                        disabled={tocSettingsDisabled}
                        checked={formState.tocMobileCollapsed}
                        label="Collapse on mobile"
                        onChange={(value) => handleChange("tocMobileCollapsed", value)}
                      />
                    </BlockStack>
                  </BlockStack>
                )}

                {selectedTab === 2 && (
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd" fontWeight="bold">
                      Shortcodes
                    </Text>
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <Snippet label="Breadcrumbs" value="[[SBS_BREADCRUMBS]]" />
                      <Snippet label="TOC" value="[[SBS_TOC]]" />
                      <Snippet label="Left rail TOC" value="[[SBS_TOC:left-rail]]" />
                      <Snippet label="Right rail TOC" value="[[SBS_TOC:right-rail]]" />
                      <Snippet label="Collapsible TOC" value="[[SBS_TOC:collapsible]]" />
                    </InlineGrid>
                  </BlockStack>
                )}

                {selectedTab === 3 && (
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd" fontWeight="bold">
                      Advanced CSS
                    </Text>
                    {canCustomCss ? (
                      <TextField
                        label="Custom content navigation CSS"
                        value={formState.contentNavCustomCss || ""}
                        onChange={(value) => handleChange("contentNavCustomCss", value)}
                        autoComplete="off"
                        multiline={5}
                        helpText="Injected only with breadcrumbs and table of contents."
                      />
                    ) : (
                      <div style={{ border: "1px dashed #D4D4D4", borderRadius: "8px", padding: "16px", backgroundColor: "#FAFAFA" }}>
                        <InlineStack gap="300" blockAlign="center">
                          <Icon source={LockIcon} tone="subdued" />
                          <BlockStack gap="050">
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              Custom content navigation CSS
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              Advanced CSS injection is a Growth plan feature.
                            </Text>
                          </BlockStack>
                          <Button size="slim" icon={StarFilledIcon} onClick={() => navigate(`/app/pricing?reason=custom_css&plan=${planKey}`)}>
                            Upgrade
                          </Button>
                        </InlineStack>
                      </div>
                    )}
                  </BlockStack>
                )}
              </div>
            </BlockStack>
          </Card>

          <BlockStack gap="400">
            <Card padding="400">
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd" fontWeight="bold">
                  Preview
                </Text>
                <BreadcrumbPreview config={formState} />
                <TocPreview config={formState} />
              </BlockStack>
            </Card>
          </BlockStack>
        </InlineGrid>
      </BlockStack>

      {hasChanges && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            width: "90%",
            maxWidth: "900px",
            backgroundColor: "#fff",
            borderRadius: "12px",
            padding: "16px 24px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            border: "1px solid #EBEBEB",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            zIndex: 100,
          }}
        >
          <InlineStack gap="200" blockAlign="center">
            <Icon source={AlertTriangleIcon} tone="warning" />
            <Text as="span" fontWeight="bold">
              You have unsaved content navigation changes
            </Text>
          </InlineStack>
          <InlineStack gap="200">
            <Button onClick={() => setFormState(savedState)}>Discard changes</Button>
            <Button variant="primary" tone="critical" onClick={handleSave} loading={fetcher.state === "submitting"}>
              Save changes
            </Button>
          </InlineStack>
        </div>
      )}

      <div style={{ height: "100px" }} />
    </Page>
  );
}

function Snippet({ label, value }: { label: string; value: string }) {
  return (
    <BlockStack gap="100">
      <Text as="span" variant="bodySm" tone="subdued">
        {label}
      </Text>
      <code style={{ display: "block", padding: "10px 12px", border: "1px solid #D4D4D4", borderRadius: "6px", backgroundColor: "#F6F6F7", overflowWrap: "anywhere" }}>
        {value}
      </code>
    </BlockStack>
  );
}

function BreadcrumbPreview({ config }: { config: typeof CONTENT_NAV_DEFAULTS }) {
  const style = config.breadcrumbsStyle;
  const primary = normalizeHexColor(config.contentNavPrimaryColor);
  const primarySoft = previewColorWithAlpha(primary, 0.1);
  const disabled = !config.breadcrumbsEnabled;
  const parts = [
    config.breadcrumbsShowHome ? config.breadcrumbsHomeLabel || "Home" : "",
    config.breadcrumbsShowBlog ? "Journal" : "",
    "How to style summer linen",
  ].filter(Boolean);

  return (
    <div style={{ border: "1px solid #E3E3E3", borderRadius: "8px", padding: "16px", backgroundColor: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.04)", opacity: disabled ? 0.55 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", marginBottom: "12px" }}>
        <Text as="h3" variant="headingSm" fontWeight="semibold">Breadcrumbs</Text>
        <span style={{ border: "1px solid #E3E3E3", borderRadius: "999px", padding: "2px 8px", color: "#616161", fontSize: "12px", lineHeight: "18px" }}>
          {style}
        </span>
      </div>
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          gap: style === "pills" ? "8px" : "4px",
          flexWrap: "wrap",
          padding: style === "boxed" ? "10px 12px" : 0,
          border: style === "boxed" ? "1px solid #E3E3E3" : 0,
          borderRadius: "8px",
          backgroundColor: style === "boxed" ? "#FAFAFA" : "transparent",
        }}
      >
        {parts.map((part, index) => {
          const isCurrent = index === parts.length - 1;
          return (
            <span key={part} style={{ display: "inline-flex", gap: "4px", alignItems: "center", minWidth: 0 }}>
              {index > 0 && <span style={{ color: primary, fontSize: "12px", fontWeight: 700 }}>{config.breadcrumbsSeparator || "/"}</span>}
              <span
                style={{
                  border: style === "pills" ? "1px solid #E3E3E3" : "1px solid transparent",
                  borderRadius: style === "pills" ? "999px" : "6px",
                  backgroundColor: !isCurrent && style === "pills" ? primarySoft : "transparent",
                  padding: style === "pills" ? "5px 10px" : "3px 6px",
                  color: isCurrent ? "#616161" : primary,
                  fontSize: "13px",
                  fontWeight: isCurrent ? 500 : 700,
                  lineHeight: "18px",
                  overflowWrap: "anywhere",
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

function TocPreview({ config }: { config: typeof CONTENT_NAV_DEFAULTS }) {
  const items = ["Choose the right products", "Build the article outline", "Place shoppable sections"];
  const primary = normalizeHexColor(config.contentNavPrimaryColor);
  const primarySoft = previewColorWithAlpha(primary, 0.1);
  const boxed = config.tocStyle !== "simple";
  const layout = config.tocLayout || CONTENT_NAV_DEFAULTS.tocLayout;
  const isRail = layout === "left-rail" || layout === "right-rail";
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
          {config.tocTitle}
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
    <div style={{ display: "grid", gap: "8px", padding: "8px 4px", minWidth: 0 }}>
      {[72, 92, 84, 64, 88, 74, 58].map((width, index) => (
        <span key={index} style={{ width: `${width}%`, height: index === 0 ? "10px" : "8px", borderRadius: "999px", backgroundColor: index === 0 ? "#D4D4D4" : "#E3E3E3" }} />
      ))}
    </div>
  );

  return (
    <div style={{ border: "1px solid #E3E3E3", borderRadius: "8px", padding: "16px", backgroundColor: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.04)", opacity: disabled ? 0.55 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", marginBottom: "12px" }}>
        <Text as="h3" variant="headingSm" fontWeight="semibold">Table of contents</Text>
        <span style={{ border: "1px solid #E3E3E3", borderRadius: "999px", padding: "2px 8px", color: "#616161", fontSize: "12px", lineHeight: "18px" }}>
          {config.tocStyle} / {layout}
        </span>
      </div>
      {isRail ? (
        <div
          style={{
            border: "1px solid #E3E3E3",
            borderRadius: "8px",
            padding: "14px",
            backgroundColor: "#FAFAFA",
            display: "grid",
            gridTemplateColumns: layout === "left-rail" ? "minmax(145px, 0.62fr) minmax(0, 1fr)" : "minmax(0, 1fr) minmax(145px, 0.62fr)",
            gap: "14px",
            alignItems: "start",
          }}
        >
          {layout === "left-rail" ? tocPanel : articleMock}
          {layout === "left-rail" ? articleMock : tocPanel}
        </div>
      ) : (
        tocPanel
      )}
    </div>
  );
}

function previewColorWithAlpha(hex: string, alpha: number) {
  const normalized = normalizeHexColor(hex).replace("#", "");
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function formatTocAutoInsertPosition(value: string) {
  switch (value) {
    case "after-paragraph-1":
      return "after paragraph 1";
    case "after-paragraph-2":
      return "after paragraph 2";
    case "after-paragraph-3":
      return "after paragraph 3";
    default:
      return "under article title";
  }
}
