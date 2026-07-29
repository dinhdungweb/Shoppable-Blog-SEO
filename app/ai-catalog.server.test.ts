import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateAiCatalogDraft } from "./ai-catalog.server";

const originalFetch = global.fetch;

beforeEach(() => {
  process.env.NINE_ROUTER_BASE_URL = "https://router.example";
  process.env.NINE_ROUTER_API_KEY = "secret";
  process.env.NINE_ROUTER_MODEL = "test-model";
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("catalog AI", () => {
  it("returns a reviewable product draft grounded in supplied fields", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      title: "Trail Running Shoes",
      descriptionHtml: "<p>Explore trail running shoes from Acme.</p>",
      seoTitle: "Trail Running Shoes | Acme",
      seoDescription: "Explore Acme trail running shoes for your next run.",
      imageAlt: "Existing side view of trail running shoes",
      summary: "Improved clarity and search metadata.",
    })) as any;

    const result = await generateAiCatalogDraft({
      type: "product",
      mode: "improve",
      title: "Trail shoes",
      descriptionHtml: "<p>Trail running shoes from Acme.</p>",
      seoTitle: "",
      seoDescription: "",
      focusKeyword: "trail running shoes",
      instruction: "",
      imageAlt: "Existing side view of trail running shoes",
      hasImage: true,
      vendor: "Acme",
      productType: "Shoes",
      tags: ["trail", "running"],
    });

    expect(result.title).toBe("Trail Running Shoes");
    expect(result.seoTitle).toBe("Trail Running Shoes | Acme");
    expect(result.descriptionHtml).toContain("<p>");
  });

  it("keeps title and description unchanged in SEO-only mode", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      title: "Changed title",
      descriptionHtml: "<p>Changed description.</p>",
      seoTitle: "Summer Collection",
      seoDescription: "Browse the summer collection.",
      imageAlt: "",
      summary: "Optimized search metadata.",
    })) as any;

    const result = await generateAiCatalogDraft({
      type: "collection",
      mode: "seo",
      title: "Summer",
      descriptionHtml: "<p>Original description.</p>",
      seoTitle: "",
      seoDescription: "",
      focusKeyword: "summer collection",
      instruction: "",
      imageAlt: "",
      hasImage: false,
    });

    expect(result.title).toBe("Summer");
    expect(result.descriptionHtml).toBe("<p>Original description.</p>");
    expect(result.seoTitle).toBe("Summer Collection");
  });

  it("can draft conservative alt text when an image exists without current alt text", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      title: "Trail shoes",
      descriptionHtml: "<p>Trail running shoes from Acme.</p>",
      seoTitle: "Trail Running Shoes",
      seoDescription: "Explore trail running shoes from Acme.",
      imageAlt: "Acme trail running shoes",
      summary: "Added concise image alt text.",
    })) as any;

    const result = await generateAiCatalogDraft({
      type: "product",
      mode: "improve",
      title: "Trail shoes",
      descriptionHtml: "<p>Trail running shoes from Acme.</p>",
      seoTitle: "Trail Running Shoes",
      seoDescription: "Explore trail running shoes from Acme.",
      focusKeyword: "trail running shoes",
      instruction: "",
      imageAlt: "",
      hasImage: true,
      vendor: "Acme",
      productType: "Shoes",
      tags: ["trail", "running"],
    });

    expect(result.imageAlt).toBe("Acme trail running shoes");
  });

  it("rejects a rewrite that removes existing links and media", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      title: "Product",
      descriptionHtml: "<p>Rewritten without protected content.</p>",
      seoTitle: "Product title",
      seoDescription: "Product description for search.",
      imageAlt: "",
      summary: "Rewritten.",
    })) as any;

    await expect(generateAiCatalogDraft({
      type: "product",
      mode: "improve",
      title: "Product",
      descriptionHtml: '<p>Read our <a href="/pages/guide">guide</a>.</p><img src="https://cdn.example/image.jpg" alt="">',
      seoTitle: "",
      seoDescription: "",
      focusKeyword: "",
      instruction: "",
      imageAlt: "",
      hasImage: false,
    })).rejects.toThrow(/no safe catalog draft|preserve/i);
  });

  it("rejects unsafe markup returned by every fallback", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      title: "Product",
      descriptionHtml: "<script>alert(1)</script><p>Product</p>",
      seoTitle: "Product title",
      seoDescription: "Product description for search.",
      imageAlt: "",
      summary: "Rewritten.",
    })) as any;

    await expect(generateAiCatalogDraft({
      type: "product",
      mode: "write",
      title: "Product",
      descriptionHtml: "<p>Product.</p>",
      seoTitle: "",
      seoDescription: "",
      focusKeyword: "",
      instruction: "",
      imageAlt: "",
      hasImage: false,
    })).rejects.toThrow(/no safe catalog draft|unsafe/i);
  });
});

function jsonResponse(content: Record<string, unknown>) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
