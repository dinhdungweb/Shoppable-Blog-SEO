import { describe, expect, it } from "vitest";
import { auditLivePage, livePenalty, parseLivePage } from "./live-page-audit";

const url = "https://shop.com/blogs/news/trail-shoes";

function page({
  head = "",
  body = "<h1>Trail shoes</h1><p>Content</p>",
  schema = [{ "@context": "https://schema.org", "@type": "BlogPosting", headline: "Trail shoes" }] as unknown[],
} = {}) {
  const scripts = schema.map((item) => `<script type="application/ld+json">${typeof item === "string" ? item : JSON.stringify(item)}</script>`).join("");
  return `<!doctype html><html><head><title>Trail shoes &amp; socks | Shop</title>
    <meta name="description" content="Pick trail shoes.">
    <link rel="canonical" href="${url}">
    <meta property="og:image" content="https://cdn.shopify.com/a.jpg">${head}${scripts}</head><body>${body}</body></html>`;
}

const types = (html: string) => auditLivePage(parseLivePage(html), { pageUrl: url, expectArticleSchema: true }).map((issue) => issue.type);

describe("parseLivePage", () => {
  it("extracts head metadata and structured data types, including @graph", () => {
    const snapshot = parseLivePage(page({ schema: [{ "@graph": [{ "@type": "WebPage" }, { "@type": ["BlogPosting", "CreativeWork"] }] }] }));
    expect(snapshot.title).toBe("Trail shoes & socks | Shop");
    expect(snapshot.metaDescription).toBe("Pick trail shoes.");
    expect(snapshot.canonical).toBe(url);
    expect(snapshot.h1Count).toBe(1);
    expect(snapshot.jsonLdTypes).toEqual(["WebPage", "BlogPosting", "CreativeWork"]);
    expect(snapshot.hasOgImage).toBe(true);
  });

  it("ignores H1 tags inside scripts and counts invalid JSON-LD", () => {
    const snapshot = parseLivePage(page({ body: "<h1>One</h1><script>var t='<h1>x</h1>'</script>", schema: ["{ bad json"] }));
    expect(snapshot.h1Count).toBe(1);
    expect(snapshot.invalidJsonLdBlocks).toBe(1);
  });
});

describe("auditLivePage", () => {
  it("passes a healthy article page", () => {
    expect(types(page())).toEqual([]);
  });

  it("flags noindex, canonical mismatches and heading problems", () => {
    const html = page({
      head: '<meta name="robots" content="noindex,follow">',
      body: "<h1>Theme title</h1><h1>Content title</h1>",
    }).replace(`href="${url}"`, 'href="https://shop.com/blogs/news"');
    expect(types(html)).toEqual(expect.arrayContaining(["live_noindex", "live_canonical_mismatch", "live_multiple_h1"]));
  });

  it("detects missing and duplicate Article schema", () => {
    expect(types(page({ schema: [] }))).toContain("live_missing_article_schema");
    expect(types(page({ schema: [{ "@type": "Article" }, { "@type": "BlogPosting" }] }))).toContain("live_duplicate_article_schema");
  });

  it("does not require Article schema on non-article pages", () => {
    const issues = auditLivePage(parseLivePage(page({ schema: [] })), { pageUrl: url, expectArticleSchema: false });
    expect(issues).toEqual([]);
  });

  it("skips password-protected storefronts", () => {
    const html = '<html><body class="template-password"><form action="/password" method="post"></form></body></html>';
    const snapshot = parseLivePage(html);
    expect(snapshot.isPasswordPage).toBe(true);
    expect(auditLivePage(snapshot, { pageUrl: url, expectArticleSchema: true })).toEqual([]);
  });

  it("caps the live penalty", () => {
    expect(livePenalty([{ points: 20 }, { points: 10 }])).toBe(25);
  });
});

describe("auditStorePageSnapshot", () => {
  it("scores homepage search listings from live HTML", async () => {
    const { auditStorePageSnapshot } = await import("./live-page-audit");
    const snapshot = parseLivePage(page({ schema: [] }).replace('<meta name="description" content="Pick trail shoes.">', ""));
    const result = auditStorePageSnapshot(snapshot, auditLivePage(snapshot, { pageUrl: url, expectArticleSchema: false }));
    expect(result.issues.map((issue) => issue.type)).toEqual(["missing_meta_description"]);
    expect(result.score).toBe(85);
  });
});
