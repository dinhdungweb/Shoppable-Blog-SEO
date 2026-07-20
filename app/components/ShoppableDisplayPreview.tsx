import type { CSSProperties } from "react";
import { Badge, BlockStack, InlineStack, Text } from "@shopify/polaris";

export type ShoppableDisplayPreviewConfig = {
  widgetStyle?: string | null;
  primaryColor?: string | null;
  productCardLayout?: string | null;
  buttonText?: string | null;
  showPrice?: boolean | null;
  showAddToCart?: boolean | null;
  maxProducts?: number | string | null;
  imageAspectRatio?: string | null;
  imageFit?: string | null;
  cardDensity?: string | null;
  gridColumns?: number | string | null;
  textAlignment?: string | null;
  buttonStyle?: string | null;
  shadowStyle?: string | null;
  showCarouselArrows?: boolean | null;
  showCarouselDots?: boolean | null;
  carouselItemsVisible?: number | string | null;
  borderRadius?: string | null;
};

type PreviewProduct = {
  title: string;
  price: string;
  color: string;
};

type ShoppableDisplayPreviewProps = {
  config: ShoppableDisplayPreviewConfig;
  showHeader?: boolean;
};

const PREVIEW_PRODUCTS: PreviewProduct[] = [
  { title: "Liquid Snowboard", price: "$749.95", color: "#A7D8F0" },
  { title: "Compare at Price Snowboard", price: "$785.95", color: "#F4C7C3" },
  { title: "Oxygen Snowboard", price: "$1,025.00", color: "#B7E4C7" },
  { title: "Complete Snowboard", price: "$699.95", color: "#CDB4DB" },
  { title: "Hydrogen Snowboard", price: "$599.95", color: "#FFD6A5" },
  { title: "Premium Wax Kit", price: "$49.00", color: "#BDE0FE" },
  { title: "Mountain Binding", price: "$249.00", color: "#D8E2DC" },
  { title: "Alpine Boot", price: "$399.00", color: "#FFE5D9" },
  { title: "Carbon Helmet", price: "$179.00", color: "#E2ECE9" },
  { title: "Travel Board Bag", price: "$129.00", color: "#FDE2E4" },
  { title: "Thermal Gloves", price: "$89.00", color: "#EAE4E9" },
  { title: "Edge Tuning Kit", price: "$59.00", color: "#CDEAC0" },
];

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numericValue)));
}

export function normalizeHexColor(value: unknown, fallback = "#6366f1") {
  const color = String(value || "").trim();
  const fullHex = /^#([0-9a-f]{6})$/i;
  const shortHex = /^#([0-9a-f]{3})$/i;

  if (fullHex.test(color)) return color.toLowerCase();
  if (shortHex.test(color)) {
    return color
      .slice(1)
      .split("")
      .map((part) => part + part)
      .join("")
      .replace(/^/, "#")
      .toLowerCase();
  }

  return fallback;
}

export function ShoppableDisplayPreview({
  config,
  showHeader = true,
}: ShoppableDisplayPreviewProps) {
  const previewLayout = config.productCardLayout || "Standard";
  const isCarouselMode = (config.widgetStyle || "carousel") === "carousel";
  const previewColor = normalizeHexColor(config.primaryColor);
  const previewRadius = config.borderRadius || "8px";
  const previewTextAlign = config.textAlignment === "Center" ? "center" : "left";
  const previewPadding =
    config.cardDensity === "Compact"
      ? "12px"
      : config.cardDensity === "Spacious"
        ? "24px"
        : "16px";
  const previewGapPx =
    config.cardDensity === "Compact" ? 10 : config.cardDensity === "Spacious" ? 20 : 16;
  const previewGap = `${previewGapPx}px`;
  const previewProductCount = clampNumber(config.maxProducts, 1, 12, 6);
  const previewVisibleCount = clampNumber(config.carouselItemsVisible, 1, 5, 4);
  const previewGridColumns = clampNumber(config.gridColumns, 2, 4, 3);
  const previewImageHeight =
    config.imageAspectRatio === "Wide"
      ? "76px"
      : config.imageAspectRatio === "Portrait"
        ? "132px"
        : "96px";
  const previewCarouselBasis = `calc((100% - ${
    previewGapPx * (previewVisibleCount - 1)
  }px) / ${previewVisibleCount})`;
  const previewProducts = PREVIEW_PRODUCTS.slice(0, previewProductCount);
  const previewPageCount = Math.ceil(previewProductCount / previewVisibleCount);
  const previewShadow =
    config.shadowStyle === "None"
      ? "none"
      : config.shadowStyle === "Lifted"
        ? "0 12px 28px rgba(0,0,0,0.16)"
        : "0 1px 3px rgba(0,0,0,0.08)";
  const previewButtonStyle: CSSProperties = {
    display: "inline-block",
    width: config.buttonStyle === "Link" ? "auto" : previewTextAlign === "center" ? "auto" : "100%",
    padding: config.buttonStyle === "Link" ? "0" : "7px 12px",
    borderRadius: previewRadius,
    border: config.buttonStyle === "Outline" ? `1px solid ${previewColor}` : "1px solid transparent",
    background:
      config.buttonStyle === "Outline" || config.buttonStyle === "Link"
        ? "transparent"
        : config.buttonStyle === "Subtle"
          ? "#EEF4FF"
          : previewColor,
    color: config.buttonStyle === "Solid" ? "#fff" : previewColor,
    fontWeight: 600,
    fontSize: "13px",
    lineHeight: 1.2,
    whiteSpace: "nowrap",
    textDecoration: config.buttonStyle === "Link" ? "underline" : "none",
  };
  const previewCarouselNavStyle: CSSProperties = {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    zIndex: 10,
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    background: "#fff",
    border: "1px solid rgba(0, 0, 0, 0.08)",
    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
    color: "#111827",
    padding: 0,
  };

  const renderPreviewProductCard = (product: PreviewProduct, index: number) => {
    const isCompact = previewLayout === "Compact";
    const isMinimal = previewLayout === "Minimal";
    const isFeatured = previewLayout === "Featured";
    const compactMediaSize = previewVisibleCount >= 4 ? 88 : 104;
    const compactButtonStyle: CSSProperties = {
      ...previewButtonStyle,
      width: config.buttonStyle === "Link" ? "auto" : "100%",
      padding: config.buttonStyle === "Link" ? "0" : "7px 10px",
      fontSize: "12px",
      overflow: "hidden",
      textOverflow: "ellipsis",
    };
    const cardStyle: CSSProperties = {
      display: isCompact ? "flex" : "block",
      alignItems: isCompact ? "stretch" : undefined,
      gap: 0,
      minWidth: 0,
      flex: isCarouselMode ? `0 0 ${previewCarouselBasis}` : undefined,
      minHeight: isCompact ? `${compactMediaSize}px` : undefined,
      padding: isMinimal ? previewPadding : 0,
      backgroundColor: isMinimal ? "#F7F7F7" : "#fff",
      border: "1px solid #E3E3E3",
      borderRadius: previewRadius,
      boxShadow: previewShadow,
      boxSizing: "border-box",
      overflow: "hidden",
      textAlign: previewTextAlign,
    };
    const imageWrapperStyle: CSSProperties = {
      width: isCompact ? `${compactMediaSize}px` : "100%",
      height: isCompact ? "auto" : isFeatured ? "128px" : previewImageHeight,
      minHeight: isCompact ? `${compactMediaSize}px` : undefined,
      flex: isCompact ? `0 0 ${compactMediaSize}px` : undefined,
      backgroundColor: product.color,
      overflow: "hidden",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    };
    const imageStyle: CSSProperties = {
      display: "block",
      width: "100%",
      height: "100%",
      objectFit: config.imageFit === "Contain" ? "contain" : "cover",
      objectPosition: "center",
      padding: config.imageFit === "Contain" ? "8px" : 0,
      opacity: 0.86,
      boxSizing: "border-box",
    };

    return (
      <div key={`${product.title}-${index}`} style={cardStyle}>
        {!isMinimal && (
          <div style={imageWrapperStyle}>
            <img
              src="https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_medium.png"
              alt=""
              style={imageStyle}
            />
          </div>
        )}
        <div
          style={{
            padding: isMinimal ? 0 : previewPadding,
            minWidth: 0,
            flex: isCompact ? 1 : undefined,
            display: isCompact ? "flex" : undefined,
            flexDirection: isCompact ? "column" : undefined,
            justifyContent: isCompact ? "center" : undefined,
          }}
        >
          <BlockStack gap="100">
            {isCompact ? (
              <span
                style={{
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: 2,
                  overflow: "hidden",
                  fontSize: "13px",
                  fontWeight: 600,
                  lineHeight: 1.3,
                }}
              >
                {product.title}
              </span>
            ) : (
              <Text as="span" variant={isFeatured ? "headingSm" : "bodySm"} fontWeight="bold" truncate>
                {product.title}
              </Text>
            )}
            {config.showPrice !== false && <Text as="span" variant="bodySm">{product.price}</Text>}
          </BlockStack>
          {config.showAddToCart !== false && (
            <div style={{ marginTop: "8px" }}>
              <button type="button" style={isCompact ? compactButtonStyle : previewButtonStyle}>
                {config.buttonText || "View product"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <BlockStack gap="300">
      {showHeader && (
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd" fontWeight="bold">Live preview</Text>
          <InlineStack gap="100">
            <Badge tone="info">
              {isCarouselMode ? `${previewVisibleCount} visible carousel` : `${previewGridColumns}-column grid`}
            </Badge>
            <Badge>{`${previewProductCount} products`}</Badge>
            <Badge>{previewLayout}</Badge>
          </InlineStack>
        </InlineStack>
      )}
      <div
        style={{
          padding: "16px",
          backgroundColor: "transparent",
          borderRadius: previewRadius,
          border: 0,
        }}
      >
        {isCarouselMode ? (
          <div>
            <div style={{ position: "relative" }}>
              {config.showCarouselArrows !== false && (
                <>
                  <button
                    type="button"
                    aria-label="Previous"
                    style={{ ...previewCarouselNavStyle, left: "4px" }}
                  >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    aria-label="Next"
                    style={{ ...previewCarouselNavStyle, right: "4px" }}
                  >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </>
              )}
              <div style={{ overflow: "hidden", padding: "2px" }}>
                <div style={{ display: "flex", gap: previewGap }}>
                  {previewProducts.map(renderPreviewProductCard)}
                </div>
              </div>
            </div>
            {config.showCarouselDots !== false && previewPageCount > 1 && (
              <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginTop: "16px" }}>
                {Array.from({ length: previewPageCount }, (_, index) => (
                  <span
                    key={index}
                    style={{
                      width: index === 0 ? "24px" : "8px",
                      height: "8px",
                      borderRadius: index === 0 ? "4px" : "50%",
                      backgroundColor: index === 0 ? previewColor : "rgba(0, 0, 0, 0.08)",
                      display: "block",
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${previewGridColumns}, minmax(0, 1fr))`,
              gap: previewGap,
            }}
          >
            {previewProducts.map(renderPreviewProductCard)}
          </div>
        )}
      </div>
    </BlockStack>
  );
}
