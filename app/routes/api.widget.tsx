import type { LoaderFunctionArgs } from "react-router";
import { json } from "../http";
import prisma from "../db.server";
import { authenticate, getUnauthenticatedActivePlanName } from "../shopify.server";
import { getLimitsForPlan } from "../pricing-plans";
import { createTrackingToken } from "../tracking-token.server";
import { attributionWindowDays } from "../analytics-core";

const DEFAULT_WIDGET_CONFIG = {
  appStatus: true,
  widgetStyle: "carousel",
  primaryColor: "#6366f1",
  productCardLayout: "Standard",
  buttonText: "View product",
  showPrice: true,
  showAddToCart: true,
  openInNewTab: true,
  imageAspectRatio: "Square",
  imageFit: "Cover",
  cardDensity: "Comfortable",
  gridColumns: 3,
  textAlignment: "Left",
  buttonStyle: "Solid",
  shadowStyle: "Soft",
  showCarouselArrows: true,
  showCarouselDots: true,
  carouselItemsVisible: 4,
  borderRadius: "8px",
  customCss: "",
  utmRules: "Auto-append to product links",
  maxProducts: 6,
  attributionWindow: "7 days",
};

const WIDGET_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=60",
};

// Public API endpoint for the theme extension to fetch embedded products.
// This route does not require authentication because it serves storefront data.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session?.shop) {
    return json({ error: "Unauthorized app proxy request" }, { status: 401, headers: WIDGET_HEADERS });
  }
  const url = new URL(request.url);
  const articleId = url.searchParams.get("articleId");
  const blockId = cleanProductBlockId(url.searchParams.get("blockId"));
  const shop = session.shop;

  if (!articleId || !shop) {
    return json({ error: "Missing articleId or shop parameter" }, { status: 400 });
  }

  let config =
    (await prisma.shopConfig.findUnique({
      where: { shop },
      select: {
        appStatus: true,
        widgetStyle: true,
        primaryColor: true,
        productCardLayout: true,
        buttonText: true,
        showPrice: true,
        showAddToCart: true,
        openInNewTab: true,
        imageAspectRatio: true,
        imageFit: true,
        cardDensity: true,
        gridColumns: true,
        textAlignment: true,
        buttonStyle: true,
        shadowStyle: true,
        showCarouselArrows: true,
        showCarouselDots: true,
        carouselItemsVisible: true,
        borderRadius: true,
        customCss: true,
        utmRules: true,
        maxProducts: true,
        attributionWindow: true,
      },
    })) || DEFAULT_WIDGET_CONFIG;

  if (!config.appStatus) {
    return json({ products: [], config: { ...config, appStatus: false } }, { headers: WIDGET_HEADERS });
  }
  // Custom CSS is a Growth feature. It is kept in settings after a downgrade and only stops applying.
  if (config.customCss && !getLimitsForPlan(await getUnauthenticatedActivePlanName(shop)).canCustomCss) {
    config = { ...config, customCss: "" };
  }

  const articleIds = getArticleIdCandidates(articleId);
  const products = await prisma.articleProduct.findMany({
    where: {
      shop,
      articleId: { in: articleIds },
      blockId,
      isActive: true,
    },
    orderBy: { position: "asc" },
    select: {
      blockId: true,
      productId: true,
      productTitle: true,
      productHandle: true,
      productImage: true,
      productPrice: true,
      displayStyle: true,
      position: true,
    },
  });

  const canonicalArticleId = articleIds.find((id) => id.startsWith("gid://shopify/Article/")) || articleIds[0];
  return json(
    {
      products: products.slice(0, config.maxProducts || DEFAULT_WIDGET_CONFIG.maxProducts).map((product) => ({
        ...product,
        trackingToken: createTrackingToken({
          shop,
          articleId: canonicalArticleId,
          productId: product.productId,
          blockId,
        }),
      })),
      // Signed for the article itself so readers (views) can be counted once per session.
      viewToken: createTrackingToken({ shop, articleId: canonicalArticleId, productId: "", blockId: "view" }),
      config: { ...config, attributionWindowDays: attributionWindowDays(config.attributionWindow) },
    },
    { headers: WIDGET_HEADERS },
  );
};

function getArticleIdCandidates(articleId: string) {
  const decoded = decodeURIComponent(articleId);
  const candidates = new Set([decoded]);

  if (decoded.startsWith("gid://shopify/Article/")) {
    candidates.add(decoded.replace("gid://shopify/Article/", ""));
  } else if (/^\d+$/.test(decoded)) {
    candidates.add(`gid://shopify/Article/${decoded}`);
  }

  return [...candidates];
}

function cleanProductBlockId(value?: string | null) {
  const trimmed = (value || "").trim();
  if (!trimmed || trimmed === "carousel" || trimmed === "grid") return "default";

  const cleaned = trimmed.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return cleaned || "default";
}
