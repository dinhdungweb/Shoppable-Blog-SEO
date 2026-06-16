import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (topic === "PRODUCTS_DELETE") {
    const productId = `gid://shopify/Product/${payload.id}`;

    // Remove all ArticleProduct records for this product
    const deleted = await prisma.articleProduct.deleteMany({
      where: { shop, productId },
    });

    console.log(
      `[Webhook] Deleted product embeds: ${productId} (${deleted.count} records)`,
    );
  }

  return new Response(null, { status: 200 });
};
