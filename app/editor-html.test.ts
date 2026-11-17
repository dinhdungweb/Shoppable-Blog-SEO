// @vitest-environment node
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { isAllowedEmbed, sanitizeArticleHtml } from "./editor-html";

const { window } = new JSDOM("<!doctype html><html><body></body></html>");
const clean = (html: string) => sanitizeArticleHtml(html, window as unknown as Window);

describe("sanitizeArticleHtml", () => {
  it("removes scripts, event handlers and javascript: URLs", () => {
    const result = clean('<p onclick="steal()">Hi</p><img src="x" onerror="steal()"><script>steal()</script><a href="javascript:steal()">x</a>');
    expect(result).not.toMatch(/onerror|onclick|<script|javascript:/i);
    expect(result).toContain("<p>Hi</p>");
  });

  it("keeps article formatting, images, links and app placeholders", () => {
    const html = '<h2 id="fit">Fit</h2><p><strong>Bold</strong> <a href="/products/shoe" target="_blank">shoe</a></p><img src="https://cdn.shopify.com/a.jpg" alt="Shoe" width="800" height="600" style="float:left"><p>[[SBS_PRODUCTS:abc]]</p><div data-sbs-products="abc" hidden=""></div>';
    const result = clean(html);
    expect(result).toContain('<h2 id="fit">Fit</h2>');
    expect(result).toContain('rel="noopener"');
    expect(result).toContain('alt="Shoe"');
    expect(result).toContain("[[SBS_PRODUCTS:abc]]");
    expect(result).toContain('data-sbs-products="abc"');
  });

  it("keeps trusted video embeds and drops other iframes and forms", () => {
    const result = clean('<iframe src="https://www.youtube.com/embed/abc" allowfullscreen></iframe><iframe src="https://evil.example/x"></iframe><form action="/x"><input name="a"></form>');
    expect(result).toContain("youtube.com/embed/abc");
    expect(result).not.toContain("evil.example");
    expect(result).not.toMatch(/<form|<input/);
  });

  it("returns an empty string without a DOM (server render)", () => {
    expect(sanitizeArticleHtml("<p>x</p>")).toBe("");
  });
});

describe("isAllowedEmbed", () => {
  it("allows only HTTPS embeds from known providers", () => {
    expect(isAllowedEmbed("https://player.vimeo.com/video/1")).toBe(true);
    expect(isAllowedEmbed("https://www.google.com/maps/embed?pb=1")).toBe(true);
    expect(isAllowedEmbed("https://www.google.com/search?q=1")).toBe(false);
    expect(isAllowedEmbed("http://www.youtube.com/embed/1")).toBe(false);
  });
});
