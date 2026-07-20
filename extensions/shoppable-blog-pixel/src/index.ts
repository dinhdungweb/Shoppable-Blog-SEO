import { register } from "@shopify/web-pixels-extension";

register(({ analytics, browser, init, settings }) => {
  const TRACK_API_URL = "https://shopable-blog.bluepeaks.top/api/track";
  const STORAGE_KEY = "sbs_attribution";
  const ATTRIBUTION_EVENT = "shoppable_blog:product_selected";

  // Configuration for attribution window (7 days in milliseconds)
  const ATTRIBUTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

  async function getAttribution() {
    try {
      const data = await browser.localStorage.getItem(STORAGE_KEY);
      if (!data) return null;
      
      const parsed = JSON.parse(String(data));
      // Check if expired
      if (parsed.timestamp && (Date.now() - parsed.timestamp > ATTRIBUTION_WINDOW_MS)) {
        await browser.localStorage.removeItem(STORAGE_KEY);
        return null;
      }

      const articleId = normalizeArticleId(parsed.articleId);
      if (!articleId) return null;

      return {
        ...parsed,
        articleId,
        blockId: cleanBlockId(parsed.blockId),
        trackingToken: String(parsed.trackingToken || ""),
      };
    } catch (e) {
      return null;
    }
  }

  async function setAttribution(articleId: unknown, blockId: unknown, trackingToken?: unknown) {
    const normalizedArticleId = normalizeArticleId(articleId);
    if (!normalizedArticleId) return;

    try {
      await browser.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        articleId: normalizedArticleId,
        blockId: cleanBlockId(blockId),
        trackingToken: String(trackingToken || ""),
        timestamp: Date.now()
      }));
    } catch (e) {
      // Ignore
    }
  }

  function sendTrackEvent(eventType: string, productId: string, attribution: any, eventId?: string) {
    const shop = getCanonicalShop();
    const articleId = normalizeArticleId(attribution.articleId);
    if (!shop || !articleId || !productId || !attribution.trackingToken) return;
    
    // Using fetch POST
    fetch(TRACK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        shop: shop,
        articleId,
        blockId: cleanBlockId(attribution.blockId),
        productId: productId,
        eventType: eventType,
        sessionId: String(eventId || ""),
        token: attribution.trackingToken,
      })
    }).catch(() => {});
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
      const url = rawValue.startsWith("http://") || rawValue.startsWith("https://")
        ? new URL(rawValue)
        : null;
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

  // 1. Listen to page view to extract UTM parameters and set attribution
  analytics.subscribe('page_viewed', async (event) => {
    const urlString = event.context.document.location.href;
    try {
      const url = new URL(urlString);
      const utmMedium = url.searchParams.get("utm_medium");
      
      // If the user came from the Shoppable Blog Widget
      if (utmMedium === "shoppable_blog") {
        const articleId = normalizeArticleId(url.searchParams.get("utm_term"));
        const blockId = cleanBlockId(url.searchParams.get("utm_content"));
        
        if (articleId) {
          await setAttribution(articleId, blockId, url.searchParams.get("sbs_token"));
        }
      }
    } catch (e) {}
  });

  // 1b. Capture direct widget interactions before the customer leaves the blog page.
  analytics.subscribe(ATTRIBUTION_EVENT, async (event) => {
    const data = (event as any).customData || {};
    await setAttribution(data.articleId, data.blockId, data.trackingToken);
  });

  // 2. Listen to add to cart
  analytics.subscribe('product_added_to_cart', async (event) => {
    const attribution = await getAttribution();
    if (!attribution) return;

    const productId = event.data?.cartLine?.merchandise?.product?.id;
    if (productId) {
      // The format is usually gid://shopify/Product/123456789
      const idStr = String(productId).split('/').pop() || "";
      sendTrackEvent("add_to_cart", idStr, attribution, String((event as any).id || ""));
    }
  });

  // 3. Listen to checkout completed (purchase)
  analytics.subscribe('checkout_completed', async (event) => {
    const attribution = await getAttribution();
    if (!attribution) return;

    const lineItems = event.data?.checkout?.lineItems || [];
    const processedProductIds = new Set<string>();

    for (const item of lineItems) {
      const productId = item.variant?.product?.id;
      if (productId) {
        const idStr = String(productId).split('/').pop() || "";
        
        // Avoid sending duplicate events if the same product is in the cart multiple times
        if (!processedProductIds.has(idStr)) {
          processedProductIds.add(idStr);
          sendTrackEvent("purchase", idStr, attribution, String((event as any).id || ""));
        }
      }
    }
  });
});

