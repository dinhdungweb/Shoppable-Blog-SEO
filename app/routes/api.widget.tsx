import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { createTrackingToken } from "../tracking-token.server";

const DEFAULT_WIDGET_CONFIG = {
  appStatus: true,
  widgetStyle: "carousel",
  primaryColor: "#6366f1",
  productCardLayout: "Standard",
  buttonText: "View product",
  showPrice: true,
  showRating: true,
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
  seoAutoSchema: true,
  maxProducts: 6,
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

  const config =
    (await prisma.shopConfig.findUnique({
      where: { shop },
      select: {
        appStatus: true,
        widgetStyle: true,
        primaryColor: true,
        productCardLayout: true,
        buttonText: true,
        showPrice: true,
        showRating: true,
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
        seoAutoSchema: true,
        maxProducts: true,
      },
    })) || DEFAULT_WIDGET_CONFIG;

  if (!config.appStatus) {
    return json({ products: [], config: { ...config, appStatus: false } }, { headers: WIDGET_HEADERS });
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

  return json(
    {
      products: products.slice(0, config.maxProducts || DEFAULT_WIDGET_CONFIG.maxProducts).map((product) => ({
        ...product,
        trackingToken: createTrackingToken({
          shop,
          articleId: articleIds.find((id) => id.startsWith("gid://shopify/Article/")) || articleIds[0],
          productId: product.productId,
          blockId,
        }),
      })),
      config,
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
