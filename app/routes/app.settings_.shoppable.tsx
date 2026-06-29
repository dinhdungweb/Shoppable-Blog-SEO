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
  Text,
  TextField,
} from "@shopify/polaris";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  LockIcon,
  StarFilledIcon,
  StoreIcon,
} from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import prisma from "../db.server";
import {
  ShoppableDisplayPreview,
  normalizeHexColor,
} from "../components/ShoppableDisplayPreview";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;

  // Check plan to determine access to Growth-only features
  const { limits, planKey } = await getActivePlanAndLimits(billing);

  let config = await prisma.shopConfig.findUnique({
    where: { shop },
  });

  if (!config) {
    config = await prisma.shopConfig.create({
      data: { shop },
    });
  }

  return json({ config, canCustomCss: limits.canCustomCss, planKey });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const maxProducts = clampNumber(formData.get("maxProducts"), 1, 12, 6);
  const gridColumns = clampNumber(formData.get("gridColumns"), 2, 4, 3);
  const carouselItemsVisible = clampNumber(formData.get("carouselItemsVisible"), 1, 5, 4);

  const updates = {
    widgetStyle: pickFormChoice(formData, "widgetStyle", ["carousel", "grid"], "carousel"),
    primaryColor: normalizeHexColor(formData.get("primaryColor")),
    productCardLayout: pickFormChoice(formData, "productCardLayout", ["Standard", "Compact", "Minimal", "Featured"], "Standard"),
    cardPosition: formData.get("cardPosition") as string,
    buttonText: formData.get("buttonText") as string,
    showPrice: formData.get("showPrice") === "true",
    showAddToCart: formData.get("showAddToCart") === "true",
    showVariantSelector: formData.get("showVariantSelector") === "true",
    openInNewTab: formData.get("openInNewTab") === "true",
    maxProducts,
    imageAspectRatio: pickFormChoice(formData, "imageAspectRatio", ["Square", "Portrait", "Wide"], "Square"),
    imageFit: pickFormChoice(formData, "imageFit", ["Cover", "Contain"], "Cover"),
    cardDensity: pickFormChoice(formData, "cardDensity", ["Compact", "Comfortable", "Spacious"], "Comfortable"),
    gridColumns,
    textAlignment: pickFormChoice(formData, "textAlignment", ["Left", "Center"], "Left"),
    buttonStyle: pickFormChoice(formData, "buttonStyle", ["Solid", "Outline", "Subtle", "Link"], "Solid"),
    shadowStyle: pickFormChoice(formData, "shadowStyle", ["None", "Soft", "Lifted"], "Soft"),
    showCarouselArrows: formData.get("showCarouselArrows") === "true",
    showCarouselDots: formData.get("showCarouselDots") === "true",
    carouselItemsVisible,
    borderRadius: formData.get("borderRadius") as string,
    customCss: formData.get("customCss") as string,
  };

  await prisma.shopConfig.update({
    where: { shop },
    data: updates,
  });

  return json({ success: true, updates });
};

function pickFormChoice(formData: FormData, key: string, allowed: string[], fallback: string) {
  const value = String(formData.get(key) || "");
  return allowed.includes(value) ? value : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numericValue)));
}

const CustomToggle = ({
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
  onChange: (val: boolean) => void;
}) => (
  <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", opacity: disabled ? 0.6 : 1 }}>
    <div
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      style={{ width: "36px", height: "20px", borderRadius: "10px", backgroundColor: checked ? "#29845A" : "#C9CCCF", position: "relative", flexShrink: 0, marginTop: "2px", cursor: disabled ? "not-allowed" : "pointer" }}
    >
      <div style={{ width: "16px", height: "16px", borderRadius: "8px", backgroundColor: "#fff", position: "absolute", top: "2px", right: checked ? "2px" : "auto", left: checked ? "auto" : "2px", transition: "all 0.2s" }} />
    </div>
    <BlockStack gap="0">
      <Text as="span" variant="bodyMd" fontWeight="semibold">{label}</Text>
      {description && <Text as="p" variant="bodySm" tone="subdued">{description}</Text>}
    </BlockStack>
  </div>
);

export default function ShoppableDisplaySettings() {
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
    let changed = false;
    for (const key in formState) {
      if (key !== "id" && key !== "shop" && key !== "createdAt" && key !== "updatedAt") {
        if (formState[key as keyof typeof formState] !== savedState[key as keyof typeof savedState]) {
          changed = true;
          break;
        }
      }
    }
    setHasChanges(changed);
  }, [formState, savedState]);

  const handleChange = (key: string, value: any) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    const data = new FormData();
    for (const key in formState) {
      if (key !== "id" && key !== "shop" && key !== "createdAt" && key !== "updatedAt") {
        const value = formState[key as keyof typeof formState];
        data.append(key, value == null ? "" : String(value));
      }
    }
    fetcher.submit(data, { method: "POST" });
    setSavedState(formState);
    shopify.toast.show("Display settings saved");
  };

  const handleDiscard = () => {
    setFormState(savedState);
  };

  const isCarouselMode = (formState.widgetStyle || "carousel") === "carousel";
  const primaryColor = normalizeHexColor(formState.primaryColor);

  return (
    <Page fullWidth>
      <BlockStack gap="500">
        <InlineStack align="space-between" blockAlign="start" gap="400">
          <BlockStack gap="100">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ display: "flex", flexShrink: 0 }}>
                <Icon source={StoreIcon} tone="base" />
              </div>
              <Text as="h1" variant="headingLg" fontWeight="bold">Shoppable display</Text>
            </div>
            <Text as="p" variant="bodyMd" tone="subdued">Control storefront product layouts, carousel/grid behavior, buttons, and styling.</Text>
          </BlockStack>
          <InlineStack gap="200">
            <Button onClick={() => navigate("/app/settings")}>Back to settings</Button>
            {!hasChanges && (
              <InlineStack gap="100" blockAlign="center">
                <Icon source={CheckCircleIcon} tone="success" />
                <Text as="span" tone="success">All changes saved</Text>
              </InlineStack>
            )}
          </InlineStack>
        </InlineStack>

        <InlineGrid columns={{ xs: 1, lg: "minmax(360px, 0.95fr) minmax(420px, 1.25fr)" }} gap="400">
          <BlockStack gap="400">
            <Card padding="400">
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd" fontWeight="bold">Display mode</Text>
                <InlineGrid columns={2} gap="300">
                  <Select
                    label="Display mode"
                    options={[
                      { label: "Carousel", value: "carousel" },
                      { label: "Grid", value: "grid" },
                    ]}
                    value={formState.widgetStyle || "carousel"}
                    onChange={(v) => handleChange("widgetStyle", v)}
                  />
                  <Select
                    label="Product card layout"
                    options={[
                      { label: "Standard card", value: "Standard" },
                      { label: "Compact media row", value: "Compact" },
                      { label: "Minimal text link", value: "Minimal" },
                      { label: "Featured editorial", value: "Featured" },
                    ]}
                    value={formState.productCardLayout}
                    onChange={(v) => handleChange("productCardLayout", v)}
                  />
                </InlineGrid>
                <InlineGrid columns={2} gap="300">
                  <TextField
                    label="Max products"
                    type="number"
                    min={1}
                    max={12}
                    value={String(formState.maxProducts || 6)}
                    onChange={(v) => handleChange("maxProducts", Number(v))}
                    autoComplete="off"
                  />
                  {isCarouselMode ? (
                    <Select
                      label="Carousel visible products"
                      options={[
                        { label: "1 product", value: "1" },
                        { label: "2 products", value: "2" },
                        { label: "3 products", value: "3" },
                        { label: "4 products", value: "4" },
                        { label: "5 products", value: "5" },
                      ]}
                      value={String(formState.carouselItemsVisible || 4)}
                      onChange={(v) => handleChange("carouselItemsVisible", Number(v))}
                    />
                  ) : (
                    <Select
                      label="Grid columns"
                      options={[
                        { label: "2 columns", value: "2" },
                        { label: "3 columns", value: "3" },
                        { label: "4 columns", value: "4" },
                      ]}
                      value={String(formState.gridColumns || 3)}
                      onChange={(v) => handleChange("gridColumns", Number(v))}
                    />
                  )}
                </InlineGrid>
                {isCarouselMode && (
                  <BlockStack gap="300">
                    <CustomToggle checked={formState.showCarouselArrows !== false} onChange={(v) => handleChange("showCarouselArrows", v)} label="Show carousel arrows" />
                    <CustomToggle checked={formState.showCarouselDots !== false} onChange={(v) => handleChange("showCarouselDots", v)} label="Show carousel dots" />
                  </BlockStack>
                )}
              </BlockStack>
            </Card>

            <Card padding="400">
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd" fontWeight="bold">Card style</Text>
                <InlineGrid columns={2} gap="300">
                  <Select
                    label="Image ratio"
                    options={[
                      { label: "Square", value: "Square" },
                      { label: "Portrait", value: "Portrait" },
                      { label: "Wide", value: "Wide" },
                    ]}
                    value={formState.imageAspectRatio || "Square"}
                    onChange={(v) => handleChange("imageAspectRatio", v)}
                  />
                  <Select
                    label="Image fit"
                    options={[
                      { label: "Cover", value: "Cover" },
                      { label: "Contain", value: "Contain" },
                    ]}
                    value={formState.imageFit || "Cover"}
                    onChange={(v) => handleChange("imageFit", v)}
                  />
                </InlineGrid>
                <InlineGrid columns={2} gap="300">
                  <Select
                    label="Card spacing"
                    options={[
                      { label: "Compact", value: "Compact" },
                      { label: "Comfortable", value: "Comfortable" },
                      { label: "Spacious", value: "Spacious" },
                    ]}
                    value={formState.cardDensity || "Comfortable"}
                    onChange={(v) => handleChange("cardDensity", v)}
                  />
                  <Select
                    label="Text alignment"
                    options={[
                      { label: "Left", value: "Left" },
                      { label: "Center", value: "Center" },
                    ]}
                    value={formState.textAlignment || "Left"}
                    onChange={(v) => handleChange("textAlignment", v)}
                  />
                </InlineGrid>
                <InlineGrid columns={2} gap="300">
                  <Select
                    label="Border radius"
                    options={[
                      { label: "Sharp (4px)", value: "4px" },
                      { label: "Soft (8px)", value: "8px" },
                      { label: "Rounded (12px)", value: "12px" },
                      { label: "Pill (20px)", value: "20px" },
                    ]}
                    value={formState.borderRadius || "8px"}
                    onChange={(v) => handleChange("borderRadius", v)}
                  />
                  <Select
                    label="Shadow"
                    options={[
                      { label: "None", value: "None" },
                      { label: "Soft", value: "Soft" },
                      { label: "Lifted", value: "Lifted" },
                    ]}
                    value={formState.shadowStyle || "Soft"}
                    onChange={(v) => handleChange("shadowStyle", v)}
                  />
                </InlineGrid>
              </BlockStack>
            </Card>

            <Card padding="400">
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd" fontWeight="bold">Product actions</Text>
                <InlineGrid columns={2} gap="300">
                  <Select
                    label="Button style"
                    options={[
                      { label: "Solid", value: "Solid" },
                      { label: "Outline", value: "Outline" },
                      { label: "Subtle", value: "Subtle" },
                      { label: "Text link", value: "Link" },
                    ]}
                    value={formState.buttonStyle || "Solid"}
                    onChange={(v) => handleChange("buttonStyle", v)}
                  />
                  <TextField label="Button text" value={formState.buttonText} onChange={(v) => handleChange("buttonText", v)} autoComplete="off" />
                </InlineGrid>
                <BlockStack gap="200">
                  <Text as="span" variant="bodyMd">Primary color</Text>
                  <div style={{ display: "grid", gridTemplateColumns: "48px minmax(0, 1fr)", gap: "12px", alignItems: "center" }}>
                    <label
                      style={{
                        width: "48px",
                        height: "48px",
                        borderRadius: "8px",
                        border: "1px solid #D4D4D4",
                        backgroundColor: primaryColor,
                        cursor: "pointer",
                        display: "block",
                        overflow: "hidden",
                        position: "relative",
                      }}
                    >
                      <input
                        aria-label="Choose primary color"
                        type="color"
                        value={primaryColor}
                        onChange={(event) => handleChange("primaryColor", event.currentTarget.value)}
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          border: 0,
                          cursor: "pointer",
                          opacity: 0,
                        }}
                      />
                    </label>
                    <TextField
                      label="Hex value"
                      labelHidden
                      value={formState.primaryColor || "#6366f1"}
                      onChange={(v) => handleChange("primaryColor", v)}
                      autoComplete="off"
                      helpText="Used for product buttons and carousel controls."
                    />
                  </div>
                </BlockStack>
                <BlockStack gap="300">
                  <CustomToggle checked={formState.showPrice !== false} onChange={(v) => handleChange("showPrice", v)} label="Show price" />
                  <CustomToggle checked={formState.showAddToCart !== false} onChange={(v) => handleChange("showAddToCart", v)} label="Show product button" description="Displays the CTA button on product cards" />
                  <CustomToggle checked={formState.showVariantSelector === true} onChange={(v) => handleChange("showVariantSelector", v)} label="Show variant selector" description="Coming soon" disabled />
                  <CustomToggle checked={formState.openInNewTab !== false} onChange={(v) => handleChange("openInNewTab", v)} label="Open product in new tab" description="Links will open in a new browser tab" />
                </BlockStack>
                <Select label="Card position in article (coming soon)" options={["After paragraph", "End of article"]} value={formState.cardPosition} onChange={(v) => handleChange("cardPosition", v)} disabled />
                {canCustomCss ? (
                  <TextField
                    label="Custom widget CSS"
                    value={formState.customCss || ""}
                    onChange={(v) => handleChange("customCss", v)}
                    autoComplete="off"
                    multiline={4}
                    helpText="Advanced storefront CSS injected with the widget."
                  />
                ) : (
                  <div
                    style={{
                      border: "1px dashed #D4D4D4",
                      borderRadius: "8px",
                      padding: "16px",
                      backgroundColor: "#FAFAFA",
                    }}
                  >
                    <InlineStack gap="300" blockAlign="center">
                      <Icon source={LockIcon} tone="subdued" />
                      <BlockStack gap="050">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          Custom widget CSS
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          Advanced CSS injection is a{" "}
                          <strong>Growth plan</strong> feature.
                        </Text>
                      </BlockStack>
                      <Button
                        size="slim"
                        icon={StarFilledIcon}
                        onClick={() => navigate("/app/pricing?reason=custom_css&plan=" + planKey)}
                      >
                        Upgrade
                      </Button>
                    </InlineStack>
                  </div>
                )}
              </BlockStack>
            </Card>
          </BlockStack>

          <Card padding="400">
            <ShoppableDisplayPreview config={formState} />
          </Card>
        </InlineGrid>
      </BlockStack>

      {hasChanges && (
        <div style={{ position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)", width: "90%", maxWidth: "900px", backgroundColor: "#fff", borderRadius: "12px", padding: "16px 24px", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #EBEBEB", display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 100 }}>
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <Icon source={AlertTriangleIcon} tone="warning" />
            <Text as="span" fontWeight="bold">You have unsaved display changes</Text>
          </div>
          <InlineStack gap="200">
            <Button onClick={handleDiscard}>Discard changes</Button>
            <Button variant="primary" tone="critical" onClick={handleSave} loading={fetcher.state === "submitting"}>Save changes</Button>
          </InlineStack>
        </div>
      )}

      <div style={{ height: "100px" }} />
    </Page>
  );
}
