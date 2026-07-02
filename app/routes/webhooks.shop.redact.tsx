import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const shopFromHeader =
    request.headers.get("x-shopify-shop-domain") ||
    request.headers.get("X-Shopify-Shop-Domain");

  try {
    const { shop, topic } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);

    const targetShop = shop || shopFromHeader;
    if (targetShop) {
      await db.session.deleteMany({ where: { shop: targetShop } });
    }
  } catch (error) {
    console.error(
      `[Webhook] Error in shop/redact for ${shopFromHeader}:`,
      error,
    );
    if (shopFromHeader) {
      try {
        await db.session.deleteMany({ where: { shop: shopFromHeader } });
      } catch (dbError) {
        console.error(
          `[Webhook] Failed DB cleanup in shop/redact for ${shopFromHeader}:`,
          dbError,
        );
      }
    }
  }

  // Shopify strictly requires privacy compliance webhooks to return 200 OK
  return new Response(null, { status: 200 });
};
