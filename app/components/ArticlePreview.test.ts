// @vitest-environment node
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { buildPreviewHtml } from "./ArticlePreview";

const { window } = new JSDOM("<!doctype html><html><body></body></html>");
const products = [
  { blockId: "default", productTitle: "Trail <Shoe>", productImage: "https://cdn.shopify.com/a.jpg", productPrice: "49.00" },
  { blockId: "abc", productTitle: "Socks", productImage: "", productPrice: "" },
];

describe("buildPreviewHtml", () => {
  it("renders product blocks, TOC and breadcrumbs from markers", () => {
    const html = buildPreviewHtml(
      "<p>[[SBS_BREADCRUMBS]]</p><p>[[SBS_TOC]]</p><h2>Fit</h2><p>Text</p><p>[[SBS_PRODUCTS]]</p><p>[[SBS_PRODUCTS:grid:abc]]</p><p>[[SBS_PRODUCTS:missing]]</p>",
      "Guide",
      "News",
      products,
      window as unknown as Window,
    );
    expect(html).toContain("Home / News / Guide");
    expect(html).toContain('<li class="level-2">Fit</li>');
    expect(html).toContain("Trail &lt;Shoe&gt;");
    expect(html).toContain("<strong>Socks</strong>");
    expect(html).toContain("No products linked to this product block yet.");
    expect(html).not.toContain("[[SBS_");
  });

  it("never renders unsafe article markup", () => {
    const html = buildPreviewHtml('<p>Hi</p><img src="x" onerror="alert(1)">', "T", "B", [], window as unknown as Window);
    expect(html).not.toContain("onerror");
  });
});
