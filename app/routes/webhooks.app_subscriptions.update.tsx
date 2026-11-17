import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { invalidateCachedPlan } from "../plan-cache.server";

/**
 * Plan changes (upgrade, downgrade, cancel, freeze) can happen outside the app.
 * The cached plan is invalidated so the next request asks Shopify again; the
 * payload alone is not used because an upgrade cancels one subscription and
 * activates another in separate, unordered webhooks.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  let shop: string;
  try {
    const webhook = await authenticate.webhook(request);
    shop = webhook.shop;
    console.log(`Received ${webhook.topic} webhook for ${shop}`);
  } catch (error) {
    console.error("[Webhook] Rejected app_subscriptions/update webhook:", error);
    return new Response(null, { status: 401 });
  }
  try {
    await invalidateCachedPlan(shop);
  } catch (error) {
    console.error(`[Webhook] Could not invalidate the cached plan for ${shop}:`, error);
    return new Response(null, { status: 500 });
  }
  return new Response(null, { status: 200 });
};
