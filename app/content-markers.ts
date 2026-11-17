/**
 * Placeholders for app content inside Shopify article HTML.
 *
 * The editor works with readable text markers such as [[SBS_PRODUCTS:id]].
 * Stored as text, those markers leak into search snippets, RSS, excerpts and
 * remain visible when the app embed is off or the app is uninstalled. So at the
 * Shopify boundary they are stored as empty hidden elements instead:
 *
 *   <div data-sbs-products="id:grid" hidden></div>
 *
 * markersToStorage() runs before saving to Shopify; storageToMarkers() runs when
 * loading an article into the editor. The storefront widgets understand both.
 */

const KINDS = { PRODUCTS: "products", TOC: "toc", BREADCRUMBS: "breadcrumbs" } as const;
type MarkerKind = keyof typeof KINDS;

const MARKER_SOURCE = "\\[\\[SBS_(PRODUCTS|TOC|BREADCRUMBS)((?::[a-zA-Z0-9_-]+){0,2})\\]\\]";
const FILLER = "(?:\\s|&nbsp;|<br\\s*\\/?>)*";

export function containsTextMarkers(html: string) {
  return new RegExp(MARKER_SOURCE).test(html || "");
}

function storedElement(tag: "div" | "span", kind: MarkerKind, tokens: string) {
  return `<${tag} data-sbs-${KINDS[kind]}="${tokens.replace(/^:/, "")}" hidden></${tag}>`;
}

export function markersToStorage(html: string) {
  if (!html || !containsTextMarkers(html)) return html || "";
  // A paragraph that only holds a marker becomes a block placeholder.
  const blockPattern = new RegExp(`<(p|div|h[1-6])\\b[^>]*>${FILLER}${MARKER_SOURCE}${FILLER}<\\/\\1>`, "gi");
  let result = html.replace(blockPattern, (_match, _tag: string, kind: MarkerKind, tokens: string) => storedElement("div", kind.toUpperCase() as MarkerKind, tokens));
  // Markers inside running text become inline placeholders.
  result = result.replace(new RegExp(MARKER_SOURCE, "g"), (_match, kind: MarkerKind, tokens: string) => storedElement("span", kind.toUpperCase() as MarkerKind, tokens));
  return result;
}

export function storageToMarkers(html: string) {
  if (!html || !/data-sbs-(products|toc|breadcrumbs)/i.test(html)) return html || "";
  return html.replace(/<(div|span)\b([^>]*)>\s*<\/\1>/gi, (match, tag: string, attrs: string) => {
    const found = attrs.match(/\bdata-sbs-(products|toc|breadcrumbs)\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if (!found) return match;
    const tokens = (found[2] ?? found[3] ?? "").trim();
    if (tokens && !/^[a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+)?$/.test(tokens)) return match;
    const marker = `[[SBS_${found[1].toUpperCase()}${tokens ? `:${tokens}` : ""}]]`;
    return tag.toLowerCase() === "div" ? `<p>${marker}</p>` : marker;
  });
}
