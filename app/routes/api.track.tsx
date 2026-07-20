import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { verifyTrackingToken } from "../tracking-token.server";

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
      token: body.token,
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
  token,
}: {
  shop: string | null;
  articleId: string | null;
  productId: string | null;
  blockId?: string | null;
  eventType: string | null;
  sessionId?: string | null;
  referrer?: string | null;
  token?: string | null;
}) {
  const tokenPayload = verifyTrackingToken(token);
  if (!tokenPayload) {
    return json({ error: "Invalid or expired tracking token" }, { status: 401, headers: TRACK_HEADERS });
  }
  const normalizedShop = cleanShopDomain(shop);
  const normalizedArticleId = normalizeArticleId(articleId);

  if (!normalizedShop || !normalizedArticleId || !productId || !eventType) {
    return json({ error: "Missing required fields" }, { status: 400, headers: TRACK_HEADERS });
  }

  const normalizedProductId = normalizeProductId(productId);
  if (
    tokenPayload.shop !== normalizedShop ||
    tokenPayload.articleId !== normalizedArticleId ||
    tokenPayload.productId !== normalizedProductId ||
    tokenPayload.blockId !== cleanProductBlockId(blockId)
  ) {
    return json({ error: "Tracking token does not match event" }, { status: 403, headers: TRACK_HEADERS });
  }

  const validEventTypes = ["impression", "click", "add_to_cart", "purchase"];
  if (!validEventTypes.includes(eventType)) {
    return json({ error: "Invalid event type" }, { status: 400, headers: TRACK_HEADERS });
  }

  const shouldTrack = await shouldRecordTracking(normalizedShop);
  if (!shouldTrack) {
    return json({ success: true, skipped: true }, { headers: TRACK_HEADERS });
  }

  const safeSessionId = cleanText(sessionId, 160);
  const eventKey = createHash("sha256")
    .update(`${normalizedShop}|${normalizedArticleId}|${normalizedProductId}|${cleanProductBlockId(blockId)}|${eventType}|${safeSessionId}`)
    .digest("hex");

  try {
    await prisma.widgetEvent.create({
      data: {
        shop: normalizedShop,
        articleId: normalizedArticleId,
        productId: normalizedProductId,
        blockId: cleanProductBlockId(blockId),
        eventType,
        sessionId: safeSessionId || null,
        referrer: cleanText(referrer, 2048) || null,
        eventKey,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return json({ success: true, deduplicated: true }, { headers: TRACK_HEADERS });
    }
    throw error;
  }

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
        token: url.searchParams.get("token"),
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

function cleanShopDomain(value?: string | null) {
  const rawValue = (value || "").trim().toLowerCase();
  if (!rawValue) return "";

  try {
    const url =
      rawValue.startsWith("http://") || rawValue.startsWith("https://")
        ? new URL(rawValue)
        : null;
    return (url ? url.hostname : rawValue).replace(/^\/+/, "").split("/")[0];
  } catch {
    return rawValue.replace(/^https?:\/\//, "").split("/")[0];
  }
}

function normalizeArticleId(value?: string | null) {
  const articleId = (value || "").trim();
  if (!articleId || articleId === "unknown") return "";
  if (/^\d+$/.test(articleId)) return `gid://shopify/Article/${articleId}`;
  return articleId;
}

function normalizeProductId(value?: string | null) {
  const productId = cleanText(value, 128);
  if (/^\d+$/.test(productId)) return `gid://shopify/Product/${productId}`;
  if (!productId.startsWith("gid://shopify/Product/")) return "";
  return productId;
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

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
