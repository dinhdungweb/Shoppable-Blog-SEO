import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
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

async function recordWidgetEvent({
  shop,
  articleId,
  productId,
  eventType,
  sessionId,
  referrer,
}: {
  shop: string | null;
  articleId: string | null;
  productId: string | null;
  eventType: string | null;
  sessionId?: string | null;
  referrer?: string | null;
}) {
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
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": "no-store",
      },
    },
  );
}

// Handle GET beacons from app proxy and CORS preflight.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const eventType = url.searchParams.get("eventType");

  if (eventType) {
    try {
      return await recordWidgetEvent({
        shop: url.searchParams.get("shop"),
        articleId: url.searchParams.get("articleId"),
        productId: url.searchParams.get("productId"),
        eventType,
        sessionId: url.searchParams.get("sessionId"),
        referrer: url.searchParams.get("referrer"),
      });
    } catch (error) {
      console.error("Track event error:", error);
      return json({ error: "Internal server error" }, { status: 500 });
    }
  }

  return json(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
};
