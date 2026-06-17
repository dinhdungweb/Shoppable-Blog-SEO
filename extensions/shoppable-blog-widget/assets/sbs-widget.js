"use strict";

(function () {
  "use strict";

  const WIDGET_SELECTOR = ".bp-widget";
  const CAROUSEL_TRACK_SELECTOR = ".bp-carousel__track";
  const GRID_CONTAINER_SELECTOR = ".bp-grid__container";
  const LOADING_SELECTOR = ".bp-widget__loading";
  const DEFAULT_BLOCK_ID = "default";
  const MARKER_PATTERN = /\[\[SBS_PRODUCTS(?::([a-zA-Z0-9_-]+)(?::([a-zA-Z0-9_-]+))?)?\]\]/g;

  function init() {
    replaceMarkers();
    loadWidgets();
  }

  function replaceMarkers() {
    const config = document.querySelector(".bp-app-embed-config");
    if (!config) return;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.includes("[[SBS_PRODUCTS")) {
          return NodeFilter.FILTER_REJECT;
        }

        const parent = node.parentElement;
        return !parent || parent.closest("script, style, textarea, template, .bp-widget")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach((node, nodeIndex) => {
      const text = node.nodeValue || "";
      let cursor = 0;
      let match;
      const fragment = document.createDocumentFragment();

      MARKER_PATTERN.lastIndex = 0;
      while ((match = MARKER_PATTERN.exec(text)) !== null) {
        fragment.append(document.createTextNode(text.slice(cursor, match.index)));
        fragment.append(createWidget(config, parseMarker(match[1], match[2], config), nodeIndex));
        cursor = match.index + match[0].length;
      }

      fragment.append(document.createTextNode(text.slice(cursor)));
      if (node.parentNode) node.parentNode.replaceChild(fragment, node);
    });
  }

  function parseMarker(tokenA, tokenB, config) {
    let style = config.dataset.defaultStyle || "carousel";
    let blockId = DEFAULT_BLOCK_ID;

    if (tokenA === "grid" || tokenA === "carousel") {
      style = tokenA;
      blockId = cleanBlockId(tokenB);
    } else {
      blockId = cleanBlockId(tokenA);
    }

    return { style: style === "grid" ? "grid" : "carousel", blockId };
  }

  function createWidget(config, marker, index) {
    const widget = document.createElement("div");
    const style = marker.style === "grid" ? "grid" : "carousel";

    widget.className = style === "grid" ? "bp-widget bp-grid" : "bp-widget bp-carousel";
    widget.dataset.articleId = config.dataset.articleId || "";
    widget.dataset.shop = config.dataset.shop || "";
    widget.dataset.appUrl = config.dataset.appUrl || "/apps/shoppable-blog-seo";
    widget.dataset.style = style;
    widget.dataset.blockId = marker.blockId;
    widget.id = `bp-marker-widget-${Date.now()}-${index}`;

    const heading = config.dataset.heading || "Shop Products from This Article";
    widget.innerHTML =
      style === "grid"
        ? `
          <div class="bp-widget__header">
            <h3 class="bp-widget__title">${escapeHtml(heading)}</h3>
          </div>
          <div class="bp-grid__container">
            ${loadingMarkup()}
          </div>
        `
        : `
          <div class="bp-widget__header">
            <h3 class="bp-widget__title">${escapeHtml(heading)}</h3>
          </div>
          <div class="bp-carousel__wrapper">
            <button class="bp-carousel__nav bp-carousel__prev" aria-label="Previous">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <div class="bp-carousel__track">
              ${loadingMarkup()}
            </div>
            <button class="bp-carousel__nav bp-carousel__next" aria-label="Next">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
          <div class="bp-carousel__dots"></div>
        `;

    return widget;
  }

  function loadWidgets() {
    const widgets = document.querySelectorAll(WIDGET_SELECTOR);

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            loadWidget(entry.target);
            observer.unobserve(entry.target);
          });
        },
        { rootMargin: "200px" },
      );

      widgets.forEach((widget) => observer.observe(widget));
      return;
    }

    widgets.forEach(loadWidget);
  }

  async function loadWidget(widget) {
    if (widget.dataset.loaded === "true") return;
    widget.dataset.loaded = "true";

    const articleId = widget.dataset.articleId;
    const shop = widget.dataset.shop;
    const appUrl = widget.dataset.appUrl || "/apps/shoppable-blog-seo";
    const style = widget.dataset.style || "carousel";
    const blockId = cleanBlockId(widget.dataset.blockId);

    if (!articleId) {
      console.warn("[SBS Widget] Missing article ID");
      showError(widget, "Shoppable Blog marker only works on blog article pages.");
      return;
    }

    if (!shop) {
      console.warn("[SBS Widget] Missing shop domain");
      showError(widget, "Shoppable Blog marker is missing the shop domain.");
      return;
    }

    try {
      const response = await fetch(widgetUrl(appUrl, articleId, shop, blockId));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!(response.headers.get("content-type") || "").includes("application/json")) {
        throw new Error("App proxy returned a non-JSON response");
      }

      const payload = await response.json();
      if (!payload.products || payload.products.length === 0) {
        showEmpty(widget);
        return;
      }

      renderProducts(widget, payload.products, payload.config || {}, style);
      setupCarousel(widget, style);
      trackEvent(appUrl, shop, articleId, blockId, "all", "impression");
    } catch (error) {
      console.error("[SBS Widget] Failed to load products", error);
      showError(widget, "Unable to load products. Check that the app proxy is active.");
    }
  }

  function renderProducts(widget, products, config, style) {
    const container =
      widget.querySelector(CAROUSEL_TRACK_SELECTOR) || widget.querySelector(GRID_CONTAINER_SELECTOR);
    if (!container) return;

    container.innerHTML = "";
    if (style === "grid") container.setAttribute("data-columns", widget.dataset.columns || "3");
    products.forEach((product) => {
      container.appendChild(createProductCard(widget, product, config));
    });
  }

  function createProductCard(widget, product, config) {
    const card = document.createElement("div");
    card.className = "bp-product-card";
    card.setAttribute("role", "article");
    card.setAttribute("aria-label", product.productTitle || "Product");

    const productUrl = `/products/${product.productHandle}`;
    let html = "";

    if (product.productImage) {
      html += `
        <div class="bp-product-card__image-wrapper">
          <img
            class="bp-product-card__image"
            src="${escapeHtml(product.productImage)}"
            alt="${escapeHtml(product.productTitle)}"
            loading="lazy"
            width="300"
            height="300"
          />
        </div>
      `;
    }

    html += '<div class="bp-product-card__body">';
    html += `
      <h4 class="bp-product-card__title">
        <a href="${productUrl}" data-product-id="${escapeHtml(product.productId)}">${escapeHtml(product.productTitle)}</a>
      </h4>
    `;

    if (config.showPrice !== false) {
      html += `<p class="bp-product-card__price">${formatMoney(product.productPrice || "0")}</p>`;
    }

    if (config.showAddToCart !== false) {
      html += `
        <button
          class="bp-product-card__cta"
          data-product-id="${escapeHtml(product.productId)}"
          data-product-handle="${escapeHtml(product.productHandle)}"
          aria-label="Add ${escapeHtml(product.productTitle)} to cart"
        >
          Add to Cart
        </button>
      `;
    }

    html += "</div>";
    card.innerHTML = html;

    card.addEventListener("click", (event) => {
      if (event.target.closest(".bp-product-card__cta")) return;
      trackEvent(
        widget.dataset.appUrl,
        widget.dataset.shop,
        widget.dataset.articleId,
        cleanBlockId(widget.dataset.blockId),
        product.productId,
        "click",
      );
    });

    const cta = card.querySelector(".bp-product-card__cta");
    if (cta) {
      cta.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await addToCart(cta, product, widget);
      });
    }

    return card;
  }

  function setupCarousel(widget, style) {
    if (style !== "carousel") return;

    const track = widget.querySelector(CAROUSEL_TRACK_SELECTOR);
    const prev = widget.querySelector(".bp-carousel__prev");
    const next = widget.querySelector(".bp-carousel__next");
    const dots = widget.querySelector(".bp-carousel__dots");
    if (!track) return;

    const cards = track.querySelectorAll(".bp-product-card");
    if (cards.length === 0) return;

    const step = () => cards[0].offsetWidth + 16;
    if (prev) prev.addEventListener("click", () => track.scrollBy({ left: -step(), behavior: "smooth" }));
    if (next) next.addEventListener("click", () => track.scrollBy({ left: step(), behavior: "smooth" }));
    if (!dots || cards.length <= 1) return;

    const visibleCards = Math.floor(track.offsetWidth / step()) || 1;
    const pageCount = Math.ceil(cards.length / visibleCards);
    dots.innerHTML = "";

    for (let page = 0; page < pageCount; page++) {
      const dot = document.createElement("button");
      dot.className = `bp-carousel__dot${page === 0 ? " bp-carousel__dot--active" : ""}`;
      dot.setAttribute("aria-label", `Page ${page + 1}`);
      dot.addEventListener("click", () => {
        track.scrollTo({ left: page * visibleCards * step(), behavior: "smooth" });
      });
      dots.appendChild(dot);
    }

    track.addEventListener("scroll", () => {
      const page = Math.round(track.scrollLeft / (visibleCards * step()));
      dots.querySelectorAll(".bp-carousel__dot").forEach((dot, index) => {
        dot.classList.toggle("bp-carousel__dot--active", index === page);
      });
    });
  }

  async function addToCart(button, product, widget) {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Adding...";

    try {
      const productResponse = await fetch(`/products/${product.productHandle}.js`);
      const productJson = await productResponse.json();
      if (!productJson.variants || productJson.variants.length === 0) {
        throw new Error("No variants available");
      }

      const variantId = productJson.variants[0].id;
      const cartResponse = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ id: variantId, quantity: 1 }] }),
      });
      if (!cartResponse.ok) throw new Error("Cart error");

      button.textContent = "Added!";
      button.classList.add("bp-product-card__cta--added");
      trackEvent(
        widget.dataset.appUrl,
        widget.dataset.shop,
        widget.dataset.articleId,
        cleanBlockId(widget.dataset.blockId),
        product.productId,
        "add_to_cart",
      );

      if (typeof window.refreshCart === "function") window.refreshCart();
      document.dispatchEvent(new CustomEvent("cart:item-added", { detail: { variantId, quantity: 1 } }));

      setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove("bp-product-card__cta--added");
        button.disabled = false;
      }, 2000);
    } catch (error) {
      console.error("[SBS Widget] Add to cart failed", error);
      button.textContent = "Error - Try Again";
      button.disabled = false;
      setTimeout(() => {
        button.textContent = originalText;
      }, 2000);
    }
  }

  function trackEvent(appUrl, shop, articleId, blockId, productId, eventType) {
    try {
      const sessionId = getSessionId();
      const params = new URLSearchParams({
        shop,
        articleId,
        blockId: cleanBlockId(blockId),
        productId,
        eventType,
        sessionId,
        referrer: document.referrer || "",
      });
      const beacon = new Image();
      beacon.src = `${trackUrl(appUrl)}?${params.toString()}`;
    } catch (error) {}
  }

  function widgetUrl(appUrl, articleId, shop, blockId) {
    const base = normalizeAppUrl(appUrl);
    const path = base.startsWith("/") ? `${base}/widget` : `${base}/api/widget`;
    const params = new URLSearchParams({
      articleId,
      shop,
      blockId: cleanBlockId(blockId),
    });
    return `${path}?${params.toString()}`;
  }

  function trackUrl(appUrl) {
    const base = normalizeAppUrl(appUrl);
    return base.startsWith("/") ? `${base}/track` : `${base}/api/track`;
  }

  function normalizeAppUrl(value) {
    return (value || "/apps/shoppable-blog-seo").replace(/\/+$/, "");
  }

  function cleanBlockId(value) {
    const trimmed = (value || "").trim();
    if (!trimmed || trimmed === "grid" || trimmed === "carousel") return DEFAULT_BLOCK_ID;

    const cleaned = trimmed.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
    return cleaned || DEFAULT_BLOCK_ID;
  }

  function getSessionId() {
    let sessionId = sessionStorage.getItem("bp_sid");
    if (!sessionId) {
      sessionId = `bp_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem("bp_sid", sessionId);
    }
    return sessionId;
  }

  function showEmpty(widget) {
    const loading = widget.querySelector(LOADING_SELECTOR);
    if (loading) loading.innerHTML = '<p class="bp-widget__empty">No products to display.</p>';
  }

  function showError(widget, message) {
    const loading = widget.querySelector(LOADING_SELECTOR);
    if (loading) loading.innerHTML = `<p class="bp-widget__empty">${escapeHtml(message)}</p>`;
  }

  function loadingMarkup() {
    return `
      <div class="bp-widget__loading">
        <div class="bp-widget__spinner"></div>
        <p>Loading products...</p>
      </div>
    `;
  }

  function formatMoney(value) {
    const amount = parseFloat(value || "0");
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: window.Shopify?.currency?.active || "USD",
    }).format(amount);
  }

  function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = value || "";
    return element.innerHTML;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
