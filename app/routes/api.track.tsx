import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";

// Public API endpoint for tracking widget events
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json();
    const { shop, articleId, productId, eventType, sessionId, referrer } = body;

    if (!shop || !articleId || !productId || !eventType) {
      return json({ error: "Missing required fields" }, { status: 400 });
    }

    const validEventTypes = ["impression", "click", "add_to_cart", "purchase"];
    if (!validEventTypes.includes(eventType)) {
      return json({ error: "Invalid event type" }, { status: 400 });
    }

    await prisma.widgetEvent.create({
      data: {
        shop,
        articleId,
        productId,
        eventType,
        sessionId: sessionId || null,
        referrer: referrer || null,
      },
    });

    return json(
      { success: true },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      },
    );
  } catch (error) {
    console.error("Track event error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
};

// Handle CORS preflight
export const loader = async ({ request }: ActionFunctionArgs) => {
  return json(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
};
