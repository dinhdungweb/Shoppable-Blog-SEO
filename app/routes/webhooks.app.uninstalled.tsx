import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { purgeShopData } from "../shop-data.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);
    await purgeShopData(shop);
  } catch (error) {
    console.error("[Webhook] Rejected or failed app/uninstalled webhook:", error);
    return new Response(null, { status: 401 });
  }

  return new Response(null, { status: 200 });
};
