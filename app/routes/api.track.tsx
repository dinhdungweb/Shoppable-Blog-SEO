import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { json } from "../http";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { isbot } from "isbot";
import prisma from "../db.server";
import { verifyTrackingToken } from "../tracking-token.server";
import { referrerHost, shopDay } from "../analytics-core";

const TRACK_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

// view: a reader opened the article; seen: that reader scrolled to the products.
const EVENT_TYPES = new Set(["view", "seen", "impression", "click", "add_to_cart", "purchase"]);
const MAX_REVENUE = 1_000_000;
const MAX_QUANTITY = 999;

// Lightweight per-client throttle: a valid token cannot be replayed at volume.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_EVENTS = 120;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export const options = () => new Response(null, { status: 204, headers: TRACK_HEADERS });

type TrackInput = {
  shop: unknown;
  articleId: unknown;
  productId: unknown;
  blockId?: unknown;
  eventType: unknown;
  sessionId?: unknown;
  eventId?: unknown;
  referrer?: unknown;
  token?: unknown;
  quantity?: unknown;
  revenue?: unknown;
  currency?: unknown;
};

// Public endpoint for widget and Web Pixel events.
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, { status: 405, headers: TRACK_HEADERS });
  try {
    const body = (await request.json()) as TrackInput;
    return await recordWidgetEvent(body, request);
  } catch (error) {
    console.error("Track event error:", error);
    return json({ error: "Internal server error" }, { status: 500, headers: TRACK_HEADERS });
  }
};

// GET beacons (image pixels) from the storefront widget.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (!url.searchParams.get("eventType")) return json(null, { headers: TRACK_HEADERS });
  try {
    return await recordWidgetEvent(Object.fromEntries(url.searchParams) as TrackInput, request);
  } catch (error) {
    console.error("Track event error:", error);
    return json({ error: "Internal server error" }, { status: 500, headers: TRACK_HEADERS });
  }
};

async function recordWidgetEvent(input: TrackInput, request: Request) {
  if (isbot(request.headers.get("user-agent") || "")) {
    return json({ success: true, skipped: "bot" }, { headers: TRACK_HEADERS });
  }
  if (isRateLimited(clientKey(request))) {
    return json({ error: "Too many events" }, { status: 429, headers: TRACK_HEADERS });
  }

  const tokenPayload = verifyTrackingToken(input.token);
  if (!tokenPayload) {
    return json({ error: "Invalid or expired tracking token" }, { status: 401, headers: TRACK_HEADERS });
  }

  const eventType = cleanText(input.eventType, 32);
  if (!EVENT_TYPES.has(eventType)) {
    return json({ error: "Invalid event type" }, { status: 400, headers: TRACK_HEADERS });
  }

  const shop = cleanShopDomain(cleanText(input.shop, 255));
  const articleId = normalizeArticleId(cleanText(input.articleId, 128));
  // Article-level events (views, products seen) use the article token (productId "").
  const isView = eventType === "view" || eventType === "seen";
  const productId = isView ? "" : normalizeProductId(cleanText(input.productId, 128));
  const blockId = isView ? "view" : cleanProductBlockId(cleanText(input.blockId, 128));
  if (!shop || !articleId || (!isView && !productId)) {
    return json({ error: "Missing required fields" }, { status: 400, headers: TRACK_HEADERS });
  }
  if (tokenPayload.shop !== shop || tokenPayload.articleId !== articleId || tokenPayload.productId !== productId || tokenPayload.blockId !== blockId) {
    return json({ error: "Tracking token does not match event" }, { status: 403, headers: TRACK_HEADERS });
  }

  const config = await prisma.shopConfig.findUnique({
    where: { shop },
    select: { appStatus: true, enableConversionTracking: true, timezone: true },
  });
  if (config && (!config.appStatus || !config.enableConversionTracking)) {
    return json({ success: true, skipped: true }, { headers: TRACK_HEADERS });
  }

  const sessionId = cleanText(input.sessionId, 160);
  const eventId = cleanText(input.eventId, 160);
  const isPurchase = eventType === "purchase";
  const quantity = eventType === "purchase" || eventType === "add_to_cart" ? clampInt(input.quantity, 1, MAX_QUANTITY, 1) : 1;
  const currency = /^[A-Z]{3}$/.test(cleanText(input.currency, 3).toUpperCase()) ? cleanText(input.currency, 3).toUpperCase() : "";
  const amount = isPurchase && currency ? clampMoney(input.revenue) : 0;
  const revenueCurrency = isPurchase && currency && amount > 0 ? currency : "";

  // eventId identifies one occurrence (an order line, an add-to-cart); sessionId
  // groups a reader's journey. Older clients only send sessionId.
  const eventKey = createHash("sha256").update(`${shop}|${articleId}|${productId}|${blockId}|${eventType}|${eventId || sessionId}`).digest("hex");
  const eventDate = shopDay(new Date(), config?.timezone);
  const source = referrerHost(cleanText(input.referrer, 2048)) || "Direct";

  try {
    await prisma.$transaction(async (tx) => {
      await tx.widgetEvent.create({
        data: {
          shop, articleId, productId, blockId, eventType, eventKey,
          sessionId: sessionId || null,
          referrer: source === "Direct" ? null : source,
          quantity,
          revenue: new Prisma.Decimal(amount.toFixed(2)),
          currency: revenueCurrency,
        },
      });
      const sessionInsert = await tx.analyticsDailySession.createMany({
        data: [{ shop, date: eventDate, articleId, productId, source, sessionKey: sessionId || eventKey }],
        skipDuplicates: true,
      });
      const increments = {
        views: eventType === "view" ? 1 : 0,
        seen: eventType === "seen" ? 1 : 0,
        impressions: eventType === "impression" ? 1 : 0,
        clicks: eventType === "click" ? 1 : 0,
        addToCarts: eventType === "add_to_cart" ? 1 : 0,
        purchases: isPurchase ? 1 : 0,
        units: isPurchase ? quantity : 0,
        revenue: new Prisma.Decimal(amount.toFixed(2)),
        sessions: sessionInsert.count,
      };
      await tx.analyticsDaily.upsert({
        where: { shop_date_articleId_productId_source_currency: { shop, date: eventDate, articleId, productId, source, currency: revenueCurrency } },
        update: {
          views: { increment: increments.views },
          seen: { increment: increments.seen },
          impressions: { increment: increments.impressions },
          clicks: { increment: increments.clicks },
          addToCarts: { increment: increments.addToCarts },
          purchases: { increment: increments.purchases },
          units: { increment: increments.units },
          revenue: { increment: increments.revenue },
          sessions: { increment: increments.sessions },
        },
        create: { shop, date: eventDate, articleId, productId, source, currency: revenueCurrency, ...increments },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return json({ success: true, deduplicated: true }, { headers: TRACK_HEADERS });
    }
    throw error;
  }

  return json({ success: true }, { headers: TRACK_HEADERS });
}

function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

function isRateLimited(key: string, now = Date.now()) {
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (rateBuckets.size > 10_000) rateBuckets.clear();
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX_EVENTS;
}

function cleanShopDomain(value: string) {
  const rawValue = value.trim().toLowerCase();
  if (!rawValue) return "";
  try {
    const url = rawValue.startsWith("http://") || rawValue.startsWith("https://") ? new URL(rawValue) : null;
    return (url ? url.hostname : rawValue).replace(/^\/+/, "").split("/")[0];
  } catch {
    return rawValue.replace(/^https?:\/\//, "").split("/")[0];
  }
}

function normalizeArticleId(value: string) {
  const articleId = value.trim();
  if (!articleId || articleId === "unknown") return "";
  if (/^\d+$/.test(articleId)) return `gid://shopify/Article/${articleId}`;
  return articleId;
}

function normalizeProductId(value: string) {
  if (/^\d+$/.test(value)) return `gid://shopify/Product/${value}`;
  return value.startsWith("gid://shopify/Product/") ? value : "";
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : typeof value === "number" ? String(value).slice(0, maxLength) : "";
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function clampMoney(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(MAX_REVENUE, Math.round(number * 100) / 100) : 0;
}

function cleanProductBlockId(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "carousel" || trimmed === "grid") return "default";
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "default";
}

