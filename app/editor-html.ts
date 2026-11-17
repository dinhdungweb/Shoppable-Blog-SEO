import DOMPurify from "dompurify";

/**
 * Sanitizes article HTML before it is placed into the editor's contentEditable
 * (and before AI output is inserted). Article bodies can be edited by other
 * staff, apps or imports; without this, `<img onerror>` or `<script>` would run
 * inside the embedded app with the merchant's session.
 *
 * Browser-only: on the server (SSR) it returns "" because the editor content is
 * set in an effect on the client.
 */

const ALLOWED_IFRAME_HOSTS = [
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "player.vimeo.com",
  "www.tiktok.com",
  "open.spotify.com",
  "www.google.com",
  "w.soundcloud.com",
  "www.loom.com",
];

let purifier: ReturnType<typeof DOMPurify> | null = null;

function getPurifier(win: Window | undefined = typeof window === "undefined" ? undefined : window) {
  if (!win) return null;
  if (purifier) return purifier;
  const instance = DOMPurify(win as unknown as Parameters<typeof DOMPurify>[0]);
  instance.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName !== "iframe") return;
    const element = node as Element;
    if (!isAllowedEmbed(element.getAttribute("src") || "")) element.parentNode?.removeChild(element);
  });
  instance.addHook("afterSanitizeAttributes", (node) => {
    const element = node as Element;
    if (element.tagName === "A" && element.getAttribute("target") === "_blank") {
      const rel = new Set((element.getAttribute("rel") || "").split(/\s+/).filter(Boolean));
      rel.add("noopener");
      element.setAttribute("rel", [...rel].join(" "));
    }
  });
  purifier = instance;
  return instance;
}

export function isAllowedEmbed(src: string) {
  try {
    const url = new URL(src, "https://invalid.example");
    if (url.protocol !== "https:") return false;
    if (!ALLOWED_IFRAME_HOSTS.includes(url.hostname)) return false;
    // Google is only allowed for Maps embeds.
    return url.hostname !== "www.google.com" || url.pathname.startsWith("/maps/embed");
  } catch {
    return false;
  }
}

export function sanitizeArticleHtml(html: string, win?: Window) {
  const instance = getPurifier(win);
  if (!instance) return "";
  return instance.sanitize(html || "", {
    USE_PROFILES: { html: true },
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "target", "loading", "hidden"],
    FORBID_TAGS: ["script", "style", "object", "embed", "form", "input", "button", "textarea", "select", "option", "meta", "link", "base", "noscript", "template"],
    ALLOW_DATA_ATTR: true,
  }) as string;
}
