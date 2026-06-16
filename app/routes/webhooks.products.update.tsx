import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (topic === "PRODUCTS_UPDATE") {
    const productId = `gid://shopify/Product/${payload.id}`;
    const productTitle = payload.title;
    const productHandle = payload.handle;
    const productImage =
      payload.images?.[0]?.src || payload.image?.src || "";
    const productPrice = payload.variants?.[0]?.price || "0";

    // Update all ArticleProduct records for this product
    await prisma.articleProduct.updateMany({
      where: { shop, productId },
      data: {
        productTitle,
        productHandle,
        productImage,
        productPrice,
      },
    });

    console.log(`[Webhook] Updated product: ${productTitle} (${productId})`);
  }

  return new Response(null, { status: 200 });
};
