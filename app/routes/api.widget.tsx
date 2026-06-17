import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";

// Public API endpoint for the theme extension to fetch embedded products
// This route does NOT require authentication — it serves public storefront data
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const articleId = url.searchParams.get("articleId");
  const blockId = cleanProductBlockId(url.searchParams.get("blockId"));
  const shop =
    url.searchParams.get("shop") ||
    request.headers.get("x-shopify-shop-domain");

  if (!articleId || !shop) {
    return json(
      { error: "Missing articleId or shop parameter" },
      { status: 400 },
    );
  }

  const articleIds = getArticleIdCandidates(articleId);

  // Fetch embedded products for this article
  let products = await prisma.articleProduct.findMany({
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

  // App proxies can send a storefront host or custom domain in some contexts.
  // The article ID is already globally scoped enough for the storefront widget,
  // so fall back to it if the shop value does not match the admin session domain.
  if (products.length === 0) {
    products = await prisma.articleProduct.findMany({
      where: {
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
  }

  // Fetch shop config
  const config = await prisma.shopConfig.findUnique({
    where: { shop },
    select: {
      widgetStyle: true,
      primaryColor: true,
      showPrice: true,
      showRating: true,
      showAddToCart: true,
      seoAutoSchema: true,
      maxProducts: true,
    },
  });

  return json(
    {
      products: products.slice(0, config?.maxProducts || 6),
      config: config || {
        widgetStyle: "carousel",
        primaryColor: "#6366f1",
        showPrice: true,
        showRating: true,
        showAddToCart: true,
        seoAutoSchema: true,
        maxProducts: 6,
      },
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60",
      },
    },
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
