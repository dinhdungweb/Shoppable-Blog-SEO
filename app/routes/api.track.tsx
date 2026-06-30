import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";

const TRACK_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

// Handle CORS preflight
export const options = () => {
  return new Response(null, {
    status: 204,
    headers: TRACK_HEADERS,
  });
};

// Public API endpoint for tracking widget events
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json();
    return await recordWidgetEvent({
      shop: body.shop,
      articleId: body.articleId,
      productId: body.productId,
      blockId: body.blockId,
      eventType: body.eventType,
      sessionId: body.sessionId,
      referrer: body.referrer,
    });
  } catch (error) {
    console.error("Track event error:", error);
    return json({ error: "Internal server error" }, { status: 500, headers: TRACK_HEADERS });
  }
};

async function recordWidgetEvent({
  shop,
  articleId,
  productId,
  blockId,
  eventType,
  sessionId,
  referrer,
}: {
  shop: string | null;
  articleId: string | null;
  productId: string | null;
  blockId?: string | null;
  eventType: string | null;
  sessionId?: string | null;
  referrer?: string | null;
}) {
  if (!shop || !articleId || !productId || !eventType) {
    return json({ error: "Missing required fields" }, { status: 400, headers: TRACK_HEADERS });
  }

  const validEventTypes = ["impression", "click", "add_to_cart", "purchase"];
  if (!validEventTypes.includes(eventType)) {
    return json({ error: "Invalid event type" }, { status: 400, headers: TRACK_HEADERS });
  }

  const shouldTrack = await shouldRecordTracking(shop);
  if (!shouldTrack) {
    return json({ success: true, skipped: true }, { headers: TRACK_HEADERS });
  }

  await prisma.widgetEvent.create({
    data: {
      shop,
      articleId,
      productId,
      blockId: cleanProductBlockId(blockId),
      eventType,
      sessionId: sessionId || null,
      referrer: referrer || null,
    },
  });

  return json(
    { success: true },
    {
      headers: TRACK_HEADERS,
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
        blockId: url.searchParams.get("blockId"),
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
    headers: TRACK_HEADERS,
  });
};

async function shouldRecordTracking(shop: string) {
  const config = await prisma.shopConfig.findUnique({
    where: { shop },
    select: {
      appStatus: true,
      enableConversionTracking: true,
    },
  });

  return !config || (config.appStatus && config.enableConversionTracking);
}

function cleanProductBlockId(value?: string | null) {
  const trimmed = (value || "").trim();
  if (!trimmed || trimmed === "carousel" || trimmed === "grid") return "default";

  const cleaned = trimmed.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return cleaned || "default";
}
