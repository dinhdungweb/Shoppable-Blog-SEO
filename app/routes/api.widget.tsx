import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";

// Public API endpoint for the theme extension to fetch embedded products
// This route does NOT require authentication — it serves public storefront data
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const articleId = url.searchParams.get("articleId");
  const shop = url.searchParams.get("shop");

  if (!articleId || !shop) {
    return json(
      { error: "Missing articleId or shop parameter" },
      { status: 400 },
    );
  }

  // Fetch embedded products for this article
  const products = await prisma.articleProduct.findMany({
    where: {
      shop,
      articleId,
      isActive: true,
    },
    orderBy: { position: "asc" },
    select: {
      productId: true,
      productTitle: true,
      productHandle: true,
      productImage: true,
      productPrice: true,
      displayStyle: true,
      position: true,
    },
  });

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
