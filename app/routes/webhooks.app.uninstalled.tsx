import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { deactivateShop } from "../shop-data.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  let shop: string;
  try {
    const webhook = await authenticate.webhook(request);
    shop = webhook.shop;
    console.log(`Received ${webhook.topic} webhook for ${shop}`);
  } catch (error) {
    console.error("[Webhook] Rejected app/uninstalled webhook:", error);
    return new Response(null, { status: 401 });
  }

  try {
    // Data is kept for a reinstall and erased on shop/redact (48 hours later).
    await deactivateShop(shop);
  } catch (error) {
    // Return 5xx so Shopify retries the delivery instead of treating it as rejected.
    console.error(`[Webhook] Failed to deactivate ${shop} on app/uninstalled:`, error);
    return new Response(null, { status: 500 });
  }

  return new Response(null, { status: 200 });
};
