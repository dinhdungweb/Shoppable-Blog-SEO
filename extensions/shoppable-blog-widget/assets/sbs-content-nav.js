"use strict";

(function () {
  "use strict";

  if (window.__SBSContentNavLoaded) return;
  window.__SBSContentNavLoaded = true;

  const CONFIG_SELECTOR = ".bp-content-nav-config";
  const CONTENT_NAV_SELECTOR = "[data-bp-content-nav]";
  const MARKER_PATTERN = /\[\[SBS_(BREADCRUMBS|TOC)(?::([a-zA-Z0-9_-]+))?\]\]/g;
  const TOC_STYLE_VALUES = ["simple", "boxed", "collapsible"];
  const TOC_LAYOUT_VALUES = ["vertical", "horizontal", "multicolumn", "left-rail", "right-rail"];
  const DEFAULT_CONFIG = {
    appStatus: true,
    breadcrumbsEnabled: true,
    breadcrumbsStyle: "minimal",
    breadcrumbsShowHome: true,
    breadcrumbsHomeLabel: "Home",
    breadcrumbsShowBlog: true,
    breadcrumbsCurrentClickable: false,
    breadcrumbsSeparator: "/",
    tocEnabled: true,
    tocAutoInsertEnabled: true,
    tocAutoInsertPosition: "after-title",
    tocTitle: "Table of contents",
    tocLevels: "h2,h3",
    tocStyle: "boxed",
    tocLayout: "vertical",
    tocNumbering: false,
    tocSmoothScroll: true,
    tocMobileCollapsed: true,
    tocStickyOffset: 96,
    contentNavPrimaryColor: "#6366f1",
    contentNavCustomCss: "",
  };
  const DISABLED_CONFIG = {
    ...DEFAULT_CONFIG,
    breadcrumbsEnabled: false,
    tocEnabled: false,
    tocAutoInsertEnabled: false,
    contentNavCustomCss: "",
  };

  function init() {
    loadConfig()
      .then((config) => {
        applyCustomCss(config);
        replaceMarkers(config);
        insertAutoToc(config);
        renderContentNavigation(config);
      })
      .catch(() => {
        replaceMarkers(DISABLED_CONFIG);
        insertAutoToc(DISABLED_CONFIG);
        renderContentNavigation(DISABLED_CONFIG);
      });
  }

  async function loadConfig() {
    const source = document.querySelector(`${CONFIG_SELECTOR}, ${CONTENT_NAV_SELECTOR}`);
    if (!source) return DEFAULT_CONFIG;

    const shop = source.dataset.shop || "";
    const appUrl = normalizeAppUrl(source.dataset.appUrl || "/apps/rankai-seo-audit-optimizer");
    if (!shop) return DISABLED_CONFIG;

    const response = await fetch(contentNavUrl(appUrl, shop), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return DISABLED_CONFIG;
    if (!(response.headers.get("content-type") || "").includes("application/json")) {
      throw new Error("App proxy returned a non-JSON response");
    }

    const payload = await response.json();
    return normalizeConfig(payload.config || {});
  }

  function replaceMarkers(config) {
    const context = document.querySelector(CONFIG_SELECTOR);
    if (!context) return;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.includes("[[SBS_")) {
          return NodeFilter.FILTER_REJECT;
        }

        const parent = node.parentElement;
        return !parent || parent.closest("script, style, textarea, template, .bp-content-nav, .bp-widget")
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
        const type = match[1] === "TOC" ? "toc" : "breadcrumbs";
        fragment.append(createContentNavElement(type, context, match[2], nodeIndex));
        cursor = match.index + match[0].length;
      }

      fragment.append(document.createTextNode(text.slice(cursor)));
      if (node.parentNode) node.parentNode.replaceChild(fragment, node);
    });
  }

  function createContentNavElement(type, context, styleToken, index) {
    const element = document.createElement(type === "toc" ? "section" : "nav");
    element.className = type === "toc" ? "bp-content-nav bp-toc" : "bp-content-nav bp-breadcrumbs";
    element.dataset.bpContentNav = type;
    element.dataset.shop = context.dataset.shop || "";
    element.dataset.appUrl = context.dataset.appUrl || "/apps/rankai-seo-audit-optimizer";
    element.dataset.homeLabel = context.dataset.homeLabel || "";
    element.dataset.homeUrl = context.dataset.homeUrl || "/";
    element.dataset.blogTitle = context.dataset.blogTitle || "";
    element.dataset.blogUrl = context.dataset.blogUrl || "";
    element.dataset.articleTitle = context.dataset.articleTitle || document.title || "";
    element.dataset.articleUrl = context.dataset.articleUrl || window.location.href;
    if (styleToken) {
      if (type === "toc" && TOC_LAYOUT_VALUES.includes(styleToken)) {
        element.dataset.layout = styleToken;
      } else {
        element.dataset.style = styleToken;
      }
    }
    element.id = `bp-content-nav-${type}-${Date.now()}-${index}`;
    return element;
  }

  function renderContentNavigation(config) {
    document.querySelectorAll(CONTENT_NAV_SELECTOR).forEach((element) => {
      if (element.dataset.bpContentNav === "toc") {
        renderToc(element, config);
      } else if (element.dataset.bpContentNav === "breadcrumbs") {
        renderBreadcrumbs(element, config);
      }
    });
  }

  function insertAutoToc(config) {
    if (
      !readBool(config.appStatus, true) ||
      !readBool(config.tocEnabled, true) ||
      !readBool(config.tocAutoInsertEnabled, true)
    ) {
      return;
    }

    const context = document.querySelector(CONFIG_SELECTOR);
    if (!context || context.dataset.contentType !== "article" || document.querySelector('[data-bp-content-nav="toc"]')) return;

    const root = getArticleRoot();
    const anchor = findAutoTocAnchor(root, config.tocAutoInsertPosition);
    if (!anchor || !anchor.parentNode) return;

    const toc = createContentNavElement("toc", context, "", "auto");
    toc.dataset.autoInserted = "true";
    anchor.parentNode.insertBefore(toc, anchor.nextSibling);
  }

  function renderBreadcrumbs(element, config) {
    const appEnabled = readBool(config.appStatus, true);
    const globalEnabled = readBool(config.breadcrumbsEnabled, true);
    const blockEnabled = readBool(element.dataset.enabled, true);

    if (!appEnabled || !globalEnabled || !blockEnabled) {
      element.hidden = true;
      return;
    }

    const style = readChoice(element.dataset.style, ["minimal", "slash", "pills", "boxed"], config.breadcrumbsStyle);
    const showHome = readBool(element.dataset.showHome, config.breadcrumbsShowHome);
    const showBlog = readBool(element.dataset.showBlog, config.breadcrumbsShowBlog);
    const currentClickable = readBool(element.dataset.currentClickable, config.breadcrumbsCurrentClickable);
    const separator = element.dataset.separator || config.breadcrumbsSeparator || "/";
    const items = [];

    if (showHome) {
      items.push({
        label: element.dataset.homeLabel || config.breadcrumbsHomeLabel || "Home",
        href: element.dataset.homeUrl || "/",
        schemaHref: element.dataset.homeUrl || "/",
      });
    }

    if (showBlog && element.dataset.blogTitle) {
      items.push({
        label: element.dataset.blogTitle,
        href: element.dataset.blogUrl || "",
        schemaHref: element.dataset.blogUrl || "",
      });
    }

    items.push({
      label: element.dataset.articleTitle || document.title || "Article",
      href: currentClickable ? element.dataset.articleUrl || window.location.href : "",
      schemaHref: element.dataset.articleUrl || window.location.href,
      current: true,
    });

    element.hidden = false;
    element.className = `bp-content-nav bp-breadcrumbs bp-breadcrumbs--${style}`;
    element.style.setProperty("--bp-content-nav-primary", config.contentNavPrimaryColor);
    element.setAttribute("aria-label", "Breadcrumbs");
    element.innerHTML = `
      <ol class="bp-breadcrumbs__list">
        ${items
          .map((item, index) => {
            const separatorMarkup =
              index > 0 ? `<span class="bp-breadcrumbs__separator" aria-hidden="true">${escapeHtml(separator)}</span>` : "";
            const linkMarkup = item.href
              ? `<a class="bp-breadcrumbs__link" href="${escapeAttr(item.href)}"${item.current ? ' aria-current="page"' : ""}>${escapeHtml(item.label)}</a>`
              : `<span class="bp-breadcrumbs__current" aria-current="page">${escapeHtml(item.label)}</span>`;
            return `<li class="bp-breadcrumbs__item">${separatorMarkup}${linkMarkup}</li>`;
          })
          .join("")}
      </ol>
    `;
    injectBreadcrumbJsonLd(items);
  }

  function renderToc(element, config) {
    const appEnabled = readBool(config.appStatus, true);
    const globalEnabled = readBool(config.tocEnabled, true);
    const blockEnabled = readBool(element.dataset.enabled, true);

    if (!appEnabled || !globalEnabled || !blockEnabled) {
      element.hidden = true;
      return;
    }

    const style = readChoice(element.dataset.style, TOC_STYLE_VALUES, config.tocStyle);
    const layout = readChoice(
      element.dataset.layout,
      TOC_LAYOUT_VALUES,
      config.tocLayout || DEFAULT_CONFIG.tocLayout,
    );
    const levelSource =
      !element.dataset.levels || element.dataset.levels === "global" ? config.tocLevels : element.dataset.levels;
    const levels = normalizeLevels(levelSource);
    const headings = getArticleHeadings(levels);
    if (!headings.length) {
      element.hidden = true;
      return;
    }

    const title = element.dataset.title || config.tocTitle || "Table of contents";
    const numbering = readBool(element.dataset.numbering, config.tocNumbering);
    const smoothScroll = readBool(element.dataset.smoothScroll, config.tocSmoothScroll);
    const mobileCollapsed = readBool(element.dataset.mobileCollapsed, config.tocMobileCollapsed);
    const offset = clampNumber(element.dataset.stickyOffset || config.tocStickyOffset, 0, 240, 96);
    const listTag = numbering ? "ol" : "ul";
    const startsCollapsed =
      style === "collapsible" || (mobileCollapsed && window.matchMedia("(max-width: 749px)").matches);

    element.hidden = false;
    element.className = [
      "bp-content-nav",
      "bp-toc",
      `bp-toc--${style}`,
      `bp-toc--layout-${layout}`,
      numbering ? "bp-toc--numbered" : "",
      startsCollapsed ? "is-collapsed" : "",
    ]
      .filter(Boolean)
      .join(" ");
    element.style.setProperty("--bp-content-nav-primary", config.contentNavPrimaryColor);
    element.style.setProperty("--bp-toc-sticky-offset", `${offset}px`);
    element.setAttribute("aria-label", title);

    element.innerHTML = `
      <div class="bp-toc__panel">
        <button class="bp-toc__toggle" type="button" aria-expanded="${startsCollapsed ? "false" : "true"}">
          <span>${escapeHtml(title)}</span>
          <span class="bp-toc__chevron" aria-hidden="true"></span>
        </button>
        <${listTag} class="bp-toc__list">
          ${headings
            .map((heading) => {
              const depth = heading.tagName.toLowerCase().replace("h", "");
              return `
                <li class="bp-toc__item bp-toc__item--h${depth}">
                  <a class="bp-toc__link" href="#${escapeAttr(heading.id)}" data-bp-toc-target="${escapeAttr(heading.id)}">
                    ${escapeHtml(heading.textContent || "")}
                  </a>
                </li>
              `;
            })
            .join("")}
        </${listTag}>
      </div>
    `;

    setupTocInteractions(element, headings, { smoothScroll, offset });
    injectTocJsonLd(title, headings);
  }

  function getArticleHeadings(levels) {
    const selector = levels.join(",");
    const root = getArticleRoot();
    const seen = new Set();

    return Array.from(root.querySelectorAll(selector))
      .filter((heading) => {
        const text = (heading.textContent || "").trim();
        return (
          text &&
          !heading.closest(".bp-content-nav, .bp-widget, header, footer, nav, aside, .shopify-section-header, .shopify-section-footer")
        );
      })
      .map((heading) => {
        if (!heading.id) {
          heading.id = uniqueSlug(heading.textContent || "section", seen);
        } else if (seen.has(heading.id)) {
          heading.id = uniqueSlug(heading.id, seen);
        }
        seen.add(heading.id);
        return heading;
      });
  }

  function getArticleRoot() {
    return document.querySelector("article") || document.querySelector("main") || document.body;
  }

  function findAutoTocAnchor(root, position) {
    const selectedPosition = readChoice(
      position,
      ["after-title", "after-paragraph-1", "after-paragraph-2", "after-paragraph-3"],
      DEFAULT_CONFIG.tocAutoInsertPosition,
    );

    if (selectedPosition.startsWith("after-paragraph-")) {
      const paragraphIndex = Number(selectedPosition.replace("after-paragraph-", "")) - 1;
      const paragraph = getArticleParagraphs(root)[paragraphIndex];
      if (paragraph) return paragraph;
    }

    return findArticleTitle(root) || getArticleParagraphs(root)[0] || root.querySelector("h2,h3,h4");
  }

  function findArticleTitle(root) {
    const candidates = Array.from(root.querySelectorAll("h1"));
    if (root !== document.body) {
      candidates.push(...Array.from(document.body.querySelectorAll("main h1, article h1")));
    }

    return (
      candidates.find((heading) => {
        const text = (heading.textContent || "").trim();
        return text && !heading.closest(".bp-content-nav, .bp-widget, nav, footer, aside, .shopify-section-header, .shopify-section-footer");
      }) || null
    );
  }

  function getArticleParagraphs(root) {
    return Array.from(root.querySelectorAll("p")).filter((paragraph) => {
      const text = (paragraph.textContent || "").trim();
      return (
        text &&
        !paragraph.closest(".bp-content-nav, .bp-widget, header, footer, nav, aside, .shopify-section-header, .shopify-section-footer")
      );
    });
  }

  function setupTocInteractions(container, headings, options) {
    const toggle = container.querySelector(".bp-toc__toggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        const collapsed = container.classList.toggle("is-collapsed");
        toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      });
    }

    container.querySelectorAll(".bp-toc__link").forEach((link) => {
      link.addEventListener("click", (event) => {
        const id = link.getAttribute("data-bp-toc-target") || "";
        const target = document.getElementById(id);
        if (!target || !options.smoothScroll) return;

        event.preventDefault();
        window.scrollTo({
          top: target.getBoundingClientRect().top + window.scrollY - options.offset,
          behavior: "smooth",
        });
        history.replaceState(null, "", `#${id}`);
      });
    });

    const updateActive = () => updateActiveLink(container, headings, options.offset);
    updateActive();
    window.addEventListener("scroll", updateActive, { passive: true });
    window.addEventListener("resize", updateActive);
  }

  function updateActiveLink(container, headings, offset) {
    let active = headings[0];
    headings.forEach((heading) => {
      if (heading.getBoundingClientRect().top + window.scrollY - offset <= window.scrollY + 8) {
        active = heading;
      }
    });

    container.querySelectorAll(".bp-toc__link").forEach((link) => {
      link.classList.toggle("is-active", link.getAttribute("data-bp-toc-target") === active.id);
    });
  }

  function injectBreadcrumbJsonLd(items) {
    const schemaItems = items
      .map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.label,
        item: absoluteUrl(item.schemaHref || item.href || window.location.href),
      }))
      .filter((item) => item.name && item.item);

    if (schemaItems.length < 2) return;

    injectJsonLd("bp-breadcrumbs-jsonld", {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: schemaItems,
    });
  }

  function injectTocJsonLd(title, headings) {
    const pageUrl = window.location.href.split("#")[0];
    const schemaItems = headings.map((heading, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: (heading.textContent || "").trim(),
      url: `${pageUrl}#${heading.id}`,
    }));

    if (!schemaItems.length) return;

    injectJsonLd("bp-toc-jsonld", {
      "@context": "https://schema.org",
      "@type": "ItemList",
      "@id": `${pageUrl}#table-of-contents`,
      name: title || "Table of contents",
      itemListOrder: "https://schema.org/ItemListOrderAscending",
      numberOfItems: schemaItems.length,
      itemListElement: schemaItems,
    });
  }

  function injectJsonLd(id, data) {
    let script = document.getElementById(id);
    if (!script) {
      script = document.createElement("script");
      script.id = id;
      script.type = "application/ld+json";
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(data);
  }

  function normalizeConfig(config) {
    return {
      ...DEFAULT_CONFIG,
      ...config,
      breadcrumbsStyle: readChoice(config.breadcrumbsStyle, ["minimal", "slash", "pills", "boxed"], DEFAULT_CONFIG.breadcrumbsStyle),
      tocStyle: readChoice(config.tocStyle, TOC_STYLE_VALUES, DEFAULT_CONFIG.tocStyle),
      tocLayout: readChoice(config.tocLayout, TOC_LAYOUT_VALUES, DEFAULT_CONFIG.tocLayout),
      tocAutoInsertEnabled: readBool(config.tocAutoInsertEnabled, DEFAULT_CONFIG.tocAutoInsertEnabled),
      tocAutoInsertPosition: readChoice(
        config.tocAutoInsertPosition,
        ["after-title", "after-paragraph-1", "after-paragraph-2", "after-paragraph-3"],
        DEFAULT_CONFIG.tocAutoInsertPosition,
      ),
      tocLevels: normalizeLevels(config.tocLevels).join(","),
      tocStickyOffset: clampNumber(config.tocStickyOffset, 0, 240, DEFAULT_CONFIG.tocStickyOffset),
      contentNavPrimaryColor: normalizeHexColor(config.contentNavPrimaryColor),
      contentNavCustomCss: config.contentNavCustomCss || "",
    };
  }

  function setupWhenReady() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  function contentNavUrl(appUrl, shop) {
    const path = appUrl.startsWith("/") ? `${appUrl}/content-nav` : `${appUrl}/api/content-nav`;
    const url = new URL(path, window.location.origin);
    url.searchParams.set("shop", shop);
    return url.toString();
  }

  function applyCustomCss(config) {
    if (!config.contentNavCustomCss) return;
    let style = document.getElementById("bp-content-nav-custom-css");
    if (!style) {
      style = document.createElement("style");
      style.id = "bp-content-nav-custom-css";
      document.head.appendChild(style);
    }
    style.textContent = config.contentNavCustomCss;
  }

  function normalizeLevels(value) {
    const levels = String(value || "h2,h3")
      .split(",")
      .map((level) => level.trim().toLowerCase())
      .filter((level) => ["h2", "h3", "h4"].includes(level));
    return levels.length ? levels : ["h2", "h3"];
  }

  function readBool(value, fallback) {
    if (value === "true" || value === true) return true;
    if (value === "false" || value === false) return false;
    return Boolean(fallback);
  }

  function readChoice(value, allowed, fallback) {
    return allowed.includes(String(value)) ? String(value) : fallback;
  }

  function clampNumber(value, min, max, fallback) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return fallback;
    return Math.max(min, Math.min(max, Math.round(numericValue)));
  }

  function normalizeHexColor(value) {
    const text = String(value || "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(text)) return text;
    if (/^[0-9a-fA-F]{6}$/.test(text)) return `#${text}`;
    return DEFAULT_CONFIG.contentNavPrimaryColor;
  }

  function normalizeAppUrl(value) {
    return (value || "/apps/rankai-seo-audit-optimizer").replace(/\/+$/, "");
  }

  function absoluteUrl(value) {
    try {
      return new URL(value || window.location.href, window.location.origin).toString();
    } catch {
      return window.location.href;
    }
  }

  function uniqueSlug(value, seen) {
    const base =
      String(value || "section")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64) || "section";
    let slug = base;
    let index = 2;
    while (seen.has(slug) || document.getElementById(slug)) {
      slug = `${base}-${index}`;
      index += 1;
    }
    return slug;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  setupWhenReady();
})();
