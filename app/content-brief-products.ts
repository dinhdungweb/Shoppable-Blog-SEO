export type ContentBriefProductPlacement = {
  productId: string;
  productTitle: string;
  productUrl: string;
  section: string;
  reason: string;
};

const ANY_PRODUCT_MARKER_PATTERN = /\[\[SBS_PRODUCTS[^\]]*\]\]/gi;
const VALID_PRODUCT_MARKER_PATTERN = /^\[\[SBS_PRODUCTS(?::[a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+)?)?\]\]$/;

export function getContentBriefProductBlockId(briefId: string) {
  const cleaned = briefId.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 54);
  return `brief_${cleaned || "products"}`.slice(0, 64);
}

export function stripInvalidProductMarkers(bodyHtml: string) {
  return bodyHtml.replace(ANY_PRODUCT_MARKER_PATTERN, (marker) =>
    VALID_PRODUCT_MARKER_PATTERN.test(marker) ? marker : "",
  );
}

export function removeContentBriefProductBlock(bodyHtml: string, briefId: string) {
  const marker = `[[SBS_PRODUCTS:${getContentBriefProductBlockId(briefId)}]]`;
  return bodyHtml
    .replace(new RegExp(`<p>\\s*${escapeRegExp(marker)}\\s*</p>`, "gi"), "")
    .split(marker)
    .join("");
}

export function prepareContentBriefProductBody(
  bodyHtml: string,
  briefId: string,
  products: Array<Pick<ContentBriefProductPlacement, "productTitle">>,
) {
  const cleanedBody = stripInvalidProductMarkers(bodyHtml).trim();
  if (!products.length) return cleanedBody;

  const blockId = getContentBriefProductBlockId(briefId);
  const marker = `[[SBS_PRODUCTS:${blockId}]]`;
  if (cleanedBody.includes(marker)) return cleanedBody;

  const markerHtml = `<p>${marker}</p>`;
  if (!cleanedBody) return markerHtml;

  const mentionIndex = firstProductMentionIndex(
    cleanedBody,
    products.map((product) => product.productTitle),
  );
  const insertionIndex = findInsertionIndex(cleanedBody, mentionIndex);

  return `${cleanedBody.slice(0, insertionIndex)}${markerHtml}${cleanedBody.slice(insertionIndex)}`;
}

function firstProductMentionIndex(bodyHtml: string, productTitles: string[]) {
  const normalizedBody = bodyHtml.toLocaleLowerCase();
  let earliest = -1;

  for (const title of productTitles) {
    const normalizedTitle = title.trim().toLocaleLowerCase();
    if (!normalizedTitle) continue;
    const index = normalizedBody.indexOf(normalizedTitle);
    if (index >= 0 && (earliest < 0 || index < earliest)) earliest = index;
  }

  return earliest;
}

function findInsertionIndex(bodyHtml: string, mentionIndex: number) {
  const normalizedBody = bodyHtml.toLocaleLowerCase();
  if (mentionIndex >= 0) {
    const list = activeListAt(normalizedBody, mentionIndex);
    if (list) {
      const listEnd = normalizedBody.indexOf(`</${list}>`, mentionIndex);
      if (listEnd >= 0) return listEnd + list.length + 3;
    }

    for (const closingTag of ["</p>", "</blockquote>", "</li>"]) {
      const end = normalizedBody.indexOf(closingTag, mentionIndex);
      if (end >= 0) return end + closingTag.length;
    }
  }

  const firstParagraphEnd = normalizedBody.indexOf("</p>");
  return firstParagraphEnd >= 0 ? firstParagraphEnd + 4 : bodyHtml.length;
}

function activeListAt(bodyHtml: string, index: number): "ul" | "ol" | null {
  for (const tag of ["ul", "ol"] as const) {
    const opening = bodyHtml.lastIndexOf(`<${tag}`, index);
    const closing = bodyHtml.lastIndexOf(`</${tag}>`, index);
    if (opening > closing) return tag;
  }
  return null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
