import { register } from "@shopify/web-pixels-extension";

register(({ analytics, browser, init }) => {
  const TRACK_API_URL = "https://shopable-blog.bluepeaks.top/api/track";
  const STORAGE_KEY = "sbs_attribution";

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
      return parsed;
    } catch (e) {
      return null;
    }
  }

  async function setAttribution(articleId: string, blockId: string) {
    try {
      await browser.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        articleId,
        blockId,
        timestamp: Date.now()
      }));
    } catch (e) {
      // Ignore
    }
  }

  function sendTrackEvent(eventType: string, productId: string, attribution: any) {
    const shop = init.context.document.location.hostname;
    
    // Using fetch POST
    fetch(TRACK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        shop: shop,
        articleId: attribution.articleId,
        blockId: attribution.blockId,
        productId: productId,
        eventType: eventType,
        sessionId: init.context.document.location.hostname + "-" + Date.now() // Unique enough for pixel
      })
    }).catch(() => {});
  }

  // 1. Listen to page view to extract UTM parameters and set attribution
  analytics.subscribe('page_viewed', async (event) => {
    const urlString = event.context.document.location.href;
    try {
      const url = new URL(urlString);
      const utmMedium = url.searchParams.get("utm_medium");
      
      // If the user came from the Shoppable Blog Widget
      if (utmMedium === "shoppable_blog") {
        const articleId = url.searchParams.get("utm_term") || "unknown";
        const blockId = url.searchParams.get("utm_content") || "default";
        
        if (articleId) {
          await setAttribution(articleId, blockId);
        }
      }
    } catch (e) {}
  });

  // 2. Listen to add to cart
  analytics.subscribe('product_added_to_cart', async (event) => {
    const attribution = await getAttribution();
    if (!attribution) return;

    const productId = event.data?.cartLine?.merchandise?.product?.id;
    if (productId) {
      // The format is usually gid://shopify/Product/123456789
      const idStr = String(productId).split('/').pop() || "";
      sendTrackEvent("add_to_cart", idStr, attribution);
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
          sendTrackEvent("purchase", idStr, attribution);
        }
      }
    }
  });
});

