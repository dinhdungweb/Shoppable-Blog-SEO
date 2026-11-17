import { register } from "@shopify/web-pixels-extension";

register(({ analytics, browser, init, settings }) => {
  // The app passes its own endpoint when it connects the pixel; older installs fall back to production.
  const TRACK_API_URL = trackUrlFrom(settings?.trackUrl) || "https://shopable-blog.bluepeaks.top/api/track";
  const STORAGE_KEY = "sbs_attribution";
  const ATTRIBUTION_EVENT = "shoppable_blog:product_selected";
  // Used when a click did not carry its own expiry (older widget versions).
  const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  const MAX_ENTRIES = 25;

  type Attribution = {
    articleId: string;
    blockId: string;
    trackingToken: string;
    sessionId: string;
    referrer: string;
    timestamp: number;
    expiresAt: number;
  };
  type AttributionMap = Record<string, Attribution>;

  // ── Storage: one attribution per product ──────────────────────────────────
  // Each signed token is valid for exactly one product, so a single shared
  // slot lost the credit for products clicked earlier in the journey.

  async function readMap(): Promise<AttributionMap> {
    try {
      const raw = await browser.localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(String(raw));
      const map: AttributionMap = parsed && typeof parsed.trackingToken === "string"
        ? legacyToMap(parsed)
        : parsed && typeof parsed === "object" ? parsed : {};
      const now = Date.now();
      for (const key of Object.keys(map)) {
        const entry = map[key];
        if (!entry?.trackingToken || !entry.expiresAt || entry.expiresAt < now) delete map[key];
      }
      return map;
    } catch (e) {
      return {};
    }
  }

  // The previous single-slot format did not store the product; it is inside the token.
  function legacyToMap(entry: any): AttributionMap {
    const productKey = productKeyOf(tokenProductId(entry.trackingToken));
    if (!productKey) return {};
    const timestamp = Number(entry.timestamp) || Date.now();
    return {
      [productKey]: {
        articleId: normalizeArticleId(entry.articleId),
        blockId: cleanBlockId(entry.blockId),
        trackingToken: String(entry.trackingToken),
        sessionId: "",
        referrer: "",
        timestamp,
        expiresAt: timestamp + DEFAULT_WINDOW_MS,
      },
    };
  }

  async function saveAttribution(productId: unknown, data: any) {
    const productKey = productKeyOf(productId) || productKeyOf(tokenProductId(data?.trackingToken));
    const articleId = normalizeArticleId(data?.articleId);
    const trackingToken = String(data?.trackingToken || "");
    // A token-less attribution cannot be recorded server-side; never store it.
    if (!productKey || !articleId || !trackingToken) return;

    const map = await readMap();
    const now = Date.now();
    const expiresAt = Number(data?.expiresAt);
    map[productKey] = {
      articleId,
      blockId: cleanBlockId(data?.blockId),
      trackingToken,
      sessionId: String(data?.sessionId || ""),
      referrer: String(data?.referrer || ""),
      timestamp: now,
      expiresAt: Number.isFinite(expiresAt) && expiresAt > now ? expiresAt : now + DEFAULT_WINDOW_MS,
    };
    const keys = Object.keys(map).sort((a, b) => map[b].timestamp - map[a].timestamp);
    keys.slice(MAX_ENTRIES).forEach((key) => delete map[key]);
    try {
      await browser.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch (e) {
      // Storage can be unavailable; tracking is best effort.
    }
  }

  // ── Sending ───────────────────────────────────────────────────────────────

  async function sendTrackEvent(
    eventType: "add_to_cart" | "purchase",
    productKey: string,
    attribution: Attribution,
    details: { eventId: string; quantity?: number; revenue?: number; currency?: string },
  ) {
    const shop = getCanonicalShop();
    if (!shop || !attribution.articleId || !productKey || !attribution.trackingToken) return false;

    const requestBody = JSON.stringify({
      shop,
      articleId: attribution.articleId,
      blockId: cleanBlockId(attribution.blockId),
      productId: productKey,
      eventType,
      eventId: details.eventId,
      sessionId: attribution.sessionId,
      referrer: attribution.referrer,
      quantity: details.quantity,
      revenue: details.revenue,
      currency: details.currency,
      token: attribution.trackingToken,
    });

    // App pixels run in a sandbox. Await the request and keep it alive so
    // cart-drawer or navigation lifecycle changes do not cancel conversions.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(TRACK_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
          keepalive: true,
        });
        if (response.ok) return true;
        // Authentication and validation failures are deterministic.
        if (response.status >= 400 && response.status < 500) return false;
      } catch (e) {
        // Retry once for a transient network or sandbox lifecycle failure.
      }
    }
    return false;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function productKeyOf(value: unknown) {
    const key = String(value || "").split("/").pop() || "";
    return /^\d+$/.test(key) ? key : "";
  }

  function tokenProductId(token: unknown) {
    try {
      const payload = String(token || "").split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
      const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
      return JSON.parse(atob(padded)).productId || "";
    } catch (e) {
      return "";
    }
  }

  function money(value: any) {
    const amount = Number(value?.amount);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  }

  function getCanonicalShop() {
    return (
      normalizeShopDomain(init.data?.shop?.myshopifyDomain) ||
      normalizeShopDomain(settings?.accountID) ||
      normalizeShopDomain(init.context.document.location.hostname)
    );
  }

  function normalizeShopDomain(value: unknown) {
    const rawValue = String(value || "").trim().toLowerCase();
    if (!rawValue) return "";
    try {
      const url = rawValue.startsWith("http://") || rawValue.startsWith("https://") ? new URL(rawValue) : null;
      return (url ? url.hostname : rawValue).replace(/^\/+/, "").split("/")[0];
    } catch (e) {
      return rawValue.replace(/^https?:\/\//, "").split("/")[0];
    }
  }

  function normalizeArticleId(value: unknown) {
    const articleId = String(value || "").trim();
    if (!articleId || articleId === "unknown") return "";
    if (/^\d+$/.test(articleId)) return `gid://shopify/Article/${articleId}`;
    return articleId;
  }

  function cleanBlockId(value: unknown) {
    const blockId = String(value || "").trim();
    if (!blockId || blockId === "carousel" || blockId === "grid") return "default";
    return blockId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "default";
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  // Legacy widget links carried the signed token in the URL. Current links only
  // carry optional campaign UTMs; attribution comes from the click event below.
  analytics.subscribe("page_viewed", async (event) => {
    try {
      const url = new URL(event.context.document.location.href);
      const legacyToken = url.searchParams.get("sbs_token");
      if (url.searchParams.get("utm_medium") === "shoppable_blog" && legacyToken) {
        await saveAttribution(tokenProductId(legacyToken), {
          articleId: url.searchParams.get("utm_term"),
          blockId: url.searchParams.get("utm_content"),
          trackingToken: legacyToken,
          referrer: event.context.document.referrer,
        });
      }
    } catch (e) {}
  });

  // Product clicks in the widget, published before the shopper leaves the article.
  analytics.subscribe(ATTRIBUTION_EVENT, async (event) => {
    const data = (event as any).customData || {};
    await saveAttribution(data.productId, data);
  });

  analytics.subscribe("product_added_to_cart", async (event) => {
    const cartLine = event.data?.cartLine;
    const productKey = productKeyOf(cartLine?.merchandise?.product?.id);
    if (!productKey) return;
    const attribution = (await readMap())[productKey];
    if (!attribution) return;

    await sendTrackEvent("add_to_cart", productKey, attribution, {
      // Same id as the widget's fallback so both sources de-duplicate.
      eventId: `sbs-atc-${productKey}-${Math.floor(Date.now() / 5000)}`,
      quantity: Number(cartLine?.quantity) || 1,
    });
  });

  analytics.subscribe("checkout_completed", async (event) => {
    const checkout: any = event.data?.checkout;
    if (!checkout) return;
    const map = await readMap();
    if (!Object.keys(map).length) return;

    // One event per attributed product with summed quantity and amount paid.
    const totals = new Map<string, { quantity: number; revenue: number; currency: string }>();
    for (const item of checkout.lineItems || []) {
      const productKey = productKeyOf(item?.variant?.product?.id);
      if (!productKey || !map[productKey]) continue;
      const quantity = Number(item.quantity) || 1;
      const paid = money(item.finalLinePrice) || money(item.variant?.price) * quantity;
      const currency = String(item.finalLinePrice?.currencyCode || checkout.currencyCode || item.variant?.price?.currencyCode || "");
      const total = totals.get(productKey) || { quantity: 0, revenue: 0, currency };
      total.quantity += quantity;
      total.revenue += paid;
      totals.set(productKey, total);
    }

    const orderKey = String(checkout.order?.id || checkout.token || (event as any).id || "");
    for (const [productKey, total] of totals) {
      await sendTrackEvent("purchase", productKey, map[productKey], {
        eventId: `${orderKey}:${productKey}`,
        quantity: total.quantity,
        revenue: Math.round(total.revenue * 100) / 100,
        currency: total.currency,
      });
    }
  });
});

function trackUrlFrom(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.pathname === "/api/track" ? url.toString() : "";
  } catch {
    return "";
  }
}
