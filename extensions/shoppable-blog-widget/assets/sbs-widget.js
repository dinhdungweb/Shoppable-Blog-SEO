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
    let styleLocked = false;

    if (tokenA === "grid" || tokenA === "carousel") {
      style = tokenA;
      blockId = cleanBlockId(tokenB);
      styleLocked = true;
    } else {
      blockId = cleanBlockId(tokenA);
    }

    return { style: style === "grid" ? "grid" : "carousel", blockId, styleLocked };
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
    widget.dataset.styleLocked = marker.styleLocked ? "true" : "false";
    widget.id = `bp-marker-widget-${Date.now()}-${index}`;

    widget.innerHTML = widgetShellMarkup(style);

    return widget;
  }

  function widgetShellMarkup(style) {
    return style === "grid"
      ? `
        <div class="bp-grid__container">
          ${loadingMarkup()}
        </div>
      `
      : `
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
  }

  function rebuildWidgetShell(widget, style) {
    widget.classList.toggle("bp-grid", style === "grid");
    widget.classList.toggle("bp-carousel", style !== "grid");
    widget.dataset.style = style;
    widget.innerHTML = widgetShellMarkup(style);
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
      if (payload.config && payload.config.appStatus === false) {
        hideWidget(widget);
        return;
      }

      const config = payload.config || {};
      if (!payload.products || payload.products.length === 0) {
        showEmpty(widget);
        return;
      }

      applyWidgetConfig(widget, config);
      const effectiveStyle =
        widget.dataset.styleLocked === "true" ? style : normalizeWidgetStyle(config.widgetStyle || style);
      if (effectiveStyle !== style) rebuildWidgetShell(widget, effectiveStyle);
      renderProducts(widget, payload.products, config, effectiveStyle);
      setupCarousel(widget, effectiveStyle, config);
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
    const cardLayout = normalizeCardLayout(config.productCardLayout);
    widget.classList.toggle("bp-widget--compact", cardLayout === "compact");

    if (style === "grid") {
      container.setAttribute("data-columns", normalizeGridColumns(config.gridColumns || widget.dataset.columns || "3"));
    } else {
      container.setAttribute("data-visible", normalizeCarouselItemsVisible(config.carouselItemsVisible || "4"));
    }

    products.forEach((product) => {
      container.appendChild(createProductCard(widget, product, { ...config, productCardLayout: cardLayout }));
    });
  }

  function createProductCard(widget, product, config) {
    const card = document.createElement("div");
    const cardLayout = normalizeCardLayout(config.productCardLayout);
    card.className = `bp-product-card bp-product-card--${cardLayout}`;
    card.setAttribute("role", "article");
    card.setAttribute("aria-label", product.productTitle || "Product");

    const productUrl = productUrlFor(product, config, widget);
    const productLinkAttrs = productLinkAttributes(productUrl, product.productId, config);
    const ctaText = buttonText(config);
    let html = "";

    if (product.productImage && cardLayout !== "minimal") {
      html += `
        <div class="bp-product-card__image-wrapper">
          <a ${productLinkAttrs} aria-hidden="true" tabindex="-1">
            <img
              class="bp-product-card__image"
              src="${escapeHtml(product.productImage)}"
              alt="${escapeHtml(product.productTitle)}"
              loading="lazy"
              width="300"
              height="300"
            />
          </a>
        </div>
      `;
    }

    html += '<div class="bp-product-card__body">';
    html += `
      <h4 class="bp-product-card__title">
        <a ${productLinkAttrs}>${escapeHtml(product.productTitle)}</a>
      </h4>
    `;

    if (config.showPrice !== false) {
      html += `<p class="bp-product-card__price">${formatMoney(product.productPrice || "0")}</p>`;
    }

    if (config.showAddToCart !== false) {
      html += `
        <a
          class="bp-product-card__cta"
          ${productLinkAttrs}
          aria-label="${escapeHtml(ctaText)}: ${escapeHtml(product.productTitle)}"
        >
          ${escapeHtml(ctaText)}
        </a>
      `;
    }

    html += "</div>";
    card.innerHTML = html;

    card.addEventListener("click", (event) => {
      // If we are suppressing clicks due to dragging, stop here
      if (card.closest(".bp-carousel__track") && card.closest(".bp-carousel__track")._suppressClickUntil > Date.now()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      trackEvent(
        widget.dataset.appUrl,
        widget.dataset.shop,
        widget.dataset.articleId,
        cleanBlockId(widget.dataset.blockId),
        product.productId,
        "click",
      );
      
      event.preventDefault();
      event.stopPropagation();
      
      if (config.openInNewTab === false) {
        window.location.href = productUrl;
      } else {
        window.open(productUrl, "_blank", "noopener,noreferrer");
      }
    });

    return card;
  }

  function setupCarousel(widget, style, config = {}) {
    if (style !== "carousel") return;

    const track = widget.querySelector(CAROUSEL_TRACK_SELECTOR);
    const prev = widget.querySelector(".bp-carousel__prev");
    const next = widget.querySelector(".bp-carousel__next");
    const dots = widget.querySelector(".bp-carousel__dots");
    if (!track) return;

    const cards = track.querySelectorAll(".bp-product-card");
    if (cards.length === 0) return;

    const step = () => cards[0].offsetWidth + carouselGap(track);
    if (config.showCarouselArrows === false) {
      if (prev) prev.hidden = true;
      if (next) next.hidden = true;
    } else {
      if (prev) prev.addEventListener("click", () => animateCarouselTo(track, track.scrollLeft - step()));
      if (next) next.addEventListener("click", () => animateCarouselTo(track, track.scrollLeft + step()));
    }

    setupCarouselDrag(track);
    if (!dots || cards.length <= 1 || config.showCarouselDots === false) {
      if (dots) dots.hidden = true;
      return;
    }

    const visibleCards = Math.floor(track.offsetWidth / step()) || 1;
    const pageCount = Math.ceil(cards.length / visibleCards);
    dots.innerHTML = "";

    for (let page = 0; page < pageCount; page++) {
      const dot = document.createElement("button");
      dot.className = `bp-carousel__dot${page === 0 ? " bp-carousel__dot--active" : ""}`;
      dot.setAttribute("aria-label", `Page ${page + 1}`);
      dot.addEventListener("click", () => {
        animateCarouselTo(track, page * visibleCards * step());
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

  function animateCarouselTo(track, targetLeft) {
    const maxLeft = Math.max(0, track.scrollWidth - track.clientWidth);
    const target = Math.max(0, Math.min(targetLeft, maxLeft));
    const start = track.scrollLeft;
    const distance = target - start;

    if (Math.abs(distance) < 1) return;

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      track.scrollLeft = target;
      return;
    }

    if (track._bpCarouselAnimationFrame) {
      window.cancelAnimationFrame(track._bpCarouselAnimationFrame);
    }

    const duration = Math.min(520, Math.max(280, Math.abs(distance) * 0.55));
    let startTime = 0;
    track.classList.add("bp-carousel__track--animating");

    const easeOutCubic = (progress) => 1 - Math.pow(1 - progress, 3);
    const tick = (timestamp) => {
      if (!startTime) startTime = timestamp;

      const progress = Math.min(1, (timestamp - startTime) / duration);
      track.scrollLeft = start + distance * easeOutCubic(progress);

      if (progress < 1) {
        track._bpCarouselAnimationFrame = window.requestAnimationFrame(tick);
        return;
      }

      track.scrollLeft = target;
      track.classList.remove("bp-carousel__track--animating");
      track._bpCarouselAnimationFrame = null;
    };

    track._bpCarouselAnimationFrame = window.requestAnimationFrame(tick);
  }

  function setupCarouselDrag(track) {
    let pointerDown = false;
    let dragging = false;
    let startX = 0;
    let startScrollLeft = 0;

    track.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      pointerDown = true;
      dragging = false;
      startX = event.clientX;
      startScrollLeft = track.scrollLeft;
      track.classList.add("bp-carousel__track--dragging");
    });

    track.addEventListener("pointermove", (event) => {
      if (!pointerDown) return;

      const deltaX = event.clientX - startX;
      if (Math.abs(deltaX) > 4) dragging = true;
      if (!dragging) return;

      event.preventDefault();
      track.scrollLeft = startScrollLeft - deltaX;
    });

    const endDrag = (event) => {
      if (!pointerDown) return;
      pointerDown = false;
      track.classList.remove("bp-carousel__track--dragging");
      if (dragging) track._suppressClickUntil = Date.now() + 250;
    };

    track.addEventListener("pointerup", endDrag);
    track.addEventListener("pointercancel", endDrag);
  }

  function normalizeCardLayout(value) {
    const layout = String(value || "").toLowerCase();
    if (["compact", "minimal", "featured"].includes(layout)) return layout;
    return "standard";
  }

  function carouselGap(track) {
    const styles = window.getComputedStyle(track);
    const gap = parseFloat(styles.columnGap || styles.gap || "16");
    return Number.isFinite(gap) ? gap : 16;
  }

  function normalizeWidgetStyle(value) {
    return String(value || "").toLowerCase() === "grid" ? "grid" : "carousel";
  }

  function normalizeGridColumns(value) {
    const columns = Number(value || 3);
    if (columns === 2 || columns === 3 || columns === 4) return String(columns);
    return "3";
  }

  function normalizeCarouselItemsVisible(value) {
    const items = Number(value || 4);
    if (items >= 1 && items <= 5) return String(items);
    return "4";
  }

  function buttonText(config) {
    const text = String(config.buttonText || "").trim();
    return text || "View product";
  }

  function productUrlFor(product, config, widget) {
    const baseUrl = `/products/${product.productHandle}`;
    if (!shouldAppendUtm(config)) return baseUrl;

    const rawArticleId = (widget.dataset.articleId || "").split("/").pop() || "";

    const params = new URLSearchParams({
      utm_source: "blog",
      utm_medium: "shoppable_blog",
      utm_campaign: "shoppable_blog_products",
      utm_content: cleanBlockId(widget.dataset.blockId),
      ...(rawArticleId ? { utm_term: rawArticleId } : {})
    });

    return `${baseUrl}?${params.toString()}`;
  }

  function shouldAppendUtm(config) {
    return String(config.utmRules || "").toLowerCase() !== "do not append";
  }

  function productLinkAttributes(url, productId, config) {
    const targetAttrs = config.openInNewTab === false ? "" : ' target="_blank" rel="noopener noreferrer"';
    return `href="${escapeHtml(url)}" data-product-id="${escapeHtml(productId)}"${targetAttrs}`;
  }

  function applyWidgetConfig(widget, config) {
    const primaryColor = normalizeCssColor(config.primaryColor);
    if (primaryColor) {
      widget.style.setProperty("--bp-primary", primaryColor);
      widget.style.setProperty("--bp-primary-hover", primaryColor);
    }

    const borderRadius = normalizeCssSize(config.borderRadius);
    if (borderRadius) {
      widget.style.setProperty("--bp-radius", borderRadius);
      widget.style.setProperty("--bp-radius-sm", borderRadius);
    }

    replaceClassByPrefix(widget, "bp-density--", normalizeToken(config.cardDensity, ["compact", "comfortable", "spacious"], "comfortable"));
    replaceClassByPrefix(widget, "bp-image--", normalizeToken(config.imageAspectRatio, ["square", "portrait", "wide"], "square"));
    replaceClassByPrefix(widget, "bp-fit--", normalizeToken(config.imageFit, ["cover", "contain"], "cover"));
    replaceClassByPrefix(widget, "bp-align--", normalizeToken(config.textAlignment, ["left", "center"], "left"));
    replaceClassByPrefix(widget, "bp-button--", normalizeToken(config.buttonStyle, ["solid", "outline", "subtle", "link"], "solid"));
    replaceClassByPrefix(widget, "bp-shadow--", normalizeToken(config.shadowStyle, ["none", "soft", "lifted"], "soft"));

    injectCustomCss(config.customCss);
  }

  function normalizeToken(value, allowed, fallback) {
    const token = String(value || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
    return allowed.includes(token) ? token : fallback;
  }

  function replaceClassByPrefix(element, prefix, value) {
    Array.from(element.classList).forEach((className) => {
      if (className.startsWith(prefix)) element.classList.remove(className);
    });
    element.classList.add(`${prefix}${value}`);
  }

  function normalizeCssColor(value) {
    const color = String(value || "").trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) return color;
    return "";
  }

  function normalizeCssSize(value) {
    const size = String(value || "").trim();
    if (/^\d+(\.\d+)?(px|rem|em|%)$/.test(size)) return size;
    return "";
  }

  function injectCustomCss(css) {
    const customCss = String(css || "").trim();
    let style = document.getElementById("bp-widget-custom-css");

    if (!customCss) {
      if (style) style.remove();
      return;
    }

    if (!style) {
      style = document.createElement("style");
      style.id = "bp-widget-custom-css";
      document.head.appendChild(style);
    }

    style.textContent = customCss;
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

  function hideWidget(widget) {
    widget.innerHTML = "";
    widget.style.display = "none";
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
