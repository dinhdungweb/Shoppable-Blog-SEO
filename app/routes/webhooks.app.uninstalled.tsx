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
      `[Webhook] Error in app/uninstalled for ${shopFromHeader}:`,
      error,
    );
    // If authenticate.webhook fails (e.g. token refresh error on already uninstalled shop),
    // we still must purge all DB sessions for this shop.
    if (shopFromHeader) {
      try {
        await db.session.deleteMany({ where: { shop: shopFromHeader } });
        console.log(
          `[Webhook] Cleaned up sessions for uninstalled shop via header: ${shopFromHeader}`,
        );
      } catch (dbError) {
        console.error(
          `[Webhook] Failed DB cleanup for ${shopFromHeader}:`,
          dbError,
        );
      }
    }
  }

  return new Response(null, { status: 200 });
};
