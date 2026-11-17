import { useMemo } from "react";
import { BlockStack, Modal, Text } from "@shopify/polaris";
import { sanitizeArticleHtml } from "../editor-html";

export type PreviewProduct = {
  blockId: string;
  productTitle: string;
  productImage: string;
  productPrice: string;
};

const MARKER_PATTERN = /\[\[SBS_(PRODUCTS|TOC|BREADCRUMBS)(?::([a-zA-Z0-9_-]+))?(?::([a-zA-Z0-9_-]+))?\]\]/g;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
}

function productBlockId(tokenA?: string, tokenB?: string) {
  // Same rules as the storefront widget: a leading "grid"/"carousel" token is a style.
  if (tokenA === "grid" || tokenA === "carousel") return tokenB || "default";
  return tokenA || "default";
}

/**
 * Builds preview HTML: sanitized article content with app placeholders rendered
 * the way readers will see them (product cards, table of contents, breadcrumbs).
 */
export function buildPreviewHtml(body: string, title: string, blogTitle: string, products: PreviewProduct[], win?: Window) {
  const safeBody = sanitizeArticleHtml(body, win);
  const headings = Array.from(safeBody.matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi), (match) => ({
    level: Number(match[1]),
    text: match[2].replace(/<[^>]*>/g, "").trim(),
  })).filter((heading) => heading.text);

  const productCards = (blockId: string) => {
    const items = products.filter((product) => (product.blockId || "default") === blockId);
    if (!items.length) return `<div class="bp-preview-empty">No products linked to this product block yet.</div>`;
    return `<div class="bp-preview-products">${items.map((product) => `
      <div class="bp-preview-card">
        ${product.productImage ? `<img src="${escapeHtml(product.productImage)}" alt="${escapeHtml(product.productTitle)}">` : ""}
        <strong>${escapeHtml(product.productTitle)}</strong>
        ${product.productPrice ? `<span>${escapeHtml(product.productPrice)}</span>` : ""}
      </div>`).join("")}</div>`;
  };

  return safeBody
    .replace(/<p>\s*(\[\[SBS_[A-Z]+(?::[a-zA-Z0-9_-]+){0,2}\]\])\s*<\/p>/g, "$1")
    .replace(MARKER_PATTERN, (_match, kind: string, tokenA?: string, tokenB?: string) => {
      if (kind === "PRODUCTS") return productCards(productBlockId(tokenA, tokenB));
      if (kind === "TOC") {
        if (!headings.length) return "";
        return `<nav class="bp-preview-toc"><strong>Table of contents</strong><ol>${headings.map((heading) => `<li class="level-${heading.level}">${escapeHtml(heading.text)}</li>`).join("")}</ol></nav>`;
      }
      return `<nav class="bp-preview-breadcrumbs">Home / ${escapeHtml(blogTitle)} / ${escapeHtml(title)}</nav>`;
    });
}

const PREVIEW_CSS = `
  .bp-preview { max-width: 720px; margin: 0 auto; font-size: 16px; line-height: 1.65; color: var(--p-color-text); }
  .bp-preview h1 { font-size: 30px; line-height: 1.25; margin: 0 0 16px; font-weight: 700; }
  .bp-preview h2 { font-size: 23px; margin: 28px 0 12px; font-weight: 700; }
  .bp-preview h3 { font-size: 19px; margin: 22px 0 10px; font-weight: 650; }
  .bp-preview p, .bp-preview ul, .bp-preview ol { margin: 0 0 14px; }
  .bp-preview img { max-width: 100%; height: auto; border-radius: 8px; }
  .bp-preview a { color: var(--p-color-text-link); }
  .bp-preview blockquote { border-left: 3px solid var(--p-color-border); margin: 0 0 14px; padding-left: 14px; color: var(--p-color-text-secondary); }
  .bp-preview iframe { max-width: 100%; }
  .bp-preview-hero { width: 100%; max-height: 360px; object-fit: cover; margin-bottom: 20px; }
  .bp-preview-products { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin: 18px 0; }
  .bp-preview-card { border: 1px solid var(--p-color-border); border-radius: 10px; padding: 10px; display: grid; gap: 6px; font-size: 14px; line-height: 1.35; }
  .bp-preview-card img { aspect-ratio: 1; object-fit: cover; border-radius: 6px; }
  .bp-preview-empty { border: 1px dashed var(--p-color-border); border-radius: 10px; padding: 14px; margin: 18px 0; font-size: 14px; color: var(--p-color-text-secondary); }
  .bp-preview-toc { background: var(--p-color-bg-surface-secondary); border-radius: 10px; padding: 14px 18px; margin: 18px 0; font-size: 15px; }
  .bp-preview-toc ol { margin: 8px 0 0; padding-left: 20px; }
  .bp-preview-toc .level-3 { margin-left: 16px; list-style: circle; }
  .bp-preview-breadcrumbs { font-size: 13px; color: var(--p-color-text-secondary); margin: 0 0 12px; }
`;

export function ArticlePreviewModal({
  open,
  onClose,
  title,
  blogTitle,
  body,
  featuredImageUrl,
  products,
  livePostUrl,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  blogTitle: string;
  body: string;
  featuredImageUrl: string;
  products: PreviewProduct[];
  livePostUrl?: string;
}) {
  const html = useMemo(() => (open ? buildPreviewHtml(body, title, blogTitle, products) : ""), [open, body, title, blogTitle, products]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Preview"
      size="large"
      secondaryActions={livePostUrl ? [{ content: "Open live post", url: livePostUrl, target: "_blank" }] : undefined}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <Text as="p" variant="bodySm" tone="subdued">
            Unsaved changes included. Fonts, colors and widget styles come from your theme, so the live post can look slightly different.
          </Text>
          <style>{PREVIEW_CSS}</style>
          <article className="bp-preview">
            {featuredImageUrl && <img className="bp-preview-hero" src={featuredImageUrl} alt="" />}
            <h1>{title || "Untitled post"}</h1>
            {/* Sanitized article HTML plus escaped app-generated placeholders. */}
            <div dangerouslySetInnerHTML={{ __html: html }} />
          </article>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
