import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const shopFromHeader =
    request.headers.get("x-shopify-shop-domain") ||
    request.headers.get("X-Shopify-Shop-Domain");

  try {
    const { shop, topic } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);

    // Payload contains customer deletion request details
  } catch (error) {
    console.error(
      `[Webhook] Error in customers/redact for ${shopFromHeader}:`,
      error,
    );
  }

  // Shopify strictly requires privacy compliance webhooks to return 200 OK
  return new Response(null, { status: 200 });
};
