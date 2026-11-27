import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { purgeShopData } from "../shop-data.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  let shop: string;
  try {
    const webhook = await authenticate.webhook(request);
    shop = webhook.shop;
    console.log(`Received ${webhook.topic} webhook for ${shop}`);
  } catch (error) {
    console.error("[Webhook] Rejected shop/redact webhook:", error);
    return new Response(null, { status: 401 });
  }

  try {
    await purgeShopData(shop);
  } catch (error) {
    // Return 5xx so Shopify retries; the shop's data must eventually be erased.
    console.error(`[Webhook] Failed to purge data for ${shop} on shop/redact:`, error);
    return new Response(null, { status: 500 });
  }

  return new Response(null, { status: 200 });
};
