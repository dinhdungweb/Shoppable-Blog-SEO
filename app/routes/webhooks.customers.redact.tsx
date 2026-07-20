import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);

    // The app stores no customer identifiers, so there are no customer-specific
    // records to delete after the webhook has been authenticated.
  } catch (error) {
    console.error("[Webhook] Rejected customers/redact webhook:", error);
    return new Response(null, { status: 401 });
  }

  // Shopify strictly requires privacy compliance webhooks to return 200 OK
  return new Response(null, { status: 200 });
};
