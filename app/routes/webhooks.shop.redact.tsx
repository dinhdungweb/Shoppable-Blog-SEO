import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { purgeShopData } from "../shop-data.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);
    await purgeShopData(shop);
  } catch (error) {
    console.error("[Webhook] Rejected or failed shop/redact webhook:", error);
    return new Response(null, { status: 401 });
  }

  // Shopify strictly requires privacy compliance webhooks to return 200 OK
  return new Response(null, { status: 200 });
};
