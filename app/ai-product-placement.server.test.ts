import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateAiProductRecommendations,
  rankCatalogProductsForArticle,
  type AiCatalogProduct,
} from "./ai-product-placement.server";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NINE_ROUTER_BASE_URL;
  delete process.env.NINE_ROUTER_API_KEY;
  delete process.env.NINE_ROUTER_MODEL;
});

const products: AiCatalogProduct[] = [
  makeProduct("1", "Trail Running Shoes", "Shoes for technical trails", ["running", "outdoor"]),
  makeProduct("2", "Ceramic Coffee Mug", "A mug for hot drinks", ["kitchen"]),
  makeProduct("3", "Running Socks", "Breathable socks for runners", ["running", "apparel"]),
];

describe("AI product placement", () => {
  it("ranks contextually matching products before unrelated products", () => {
    const ranked = rankCatalogProductsForArticle(products, {
      title: "Trail running essentials",
      body: "<p>Choose shoes and socks for technical trails.</p>",
      focusKeyword: "trail running",
    });
    expect(ranked.map((product) => product.id)).toEqual(["1", "3", "2"]);
  });

  it("accepts only recommendations from the supplied catalog", async () => {
    configure();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ recommendations: [
        { productId: "1", reason: "Useful for the trail shoe section.", placementHint: "After Choosing trail shoes" },
        { productId: "unknown", reason: "Invented product.", placementHint: "Introduction" },
        { productId: "1", reason: "Duplicate.", placementHint: "End" },
      ] }) } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateAiProductRecommendations({
      articleTitle: "Trail running essentials",
      articleBody: "<h2>Choosing trail shoes</h2>",
      focusKeyword: "trail running",
      products,
    });

    expect(result).toEqual([{ productId: "1", reason: "Useful for the trail shoe section.", placementHint: "After Choosing trail shoes" }]);
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.model).toBe("cx/test-model");
    expect(request.messages[1].content).toContain("Trail Running Shoes");
  });

  it("fails when AI returns no valid catalog match", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ recommendations: [
        { productId: "not-in-catalog", reason: "No match", placementHint: "End" },
      ] }) } }],
    }), { status: 200 })));

    await expect(generateAiProductRecommendations({
      articleTitle: "Article",
      articleBody: "<p>Body</p>",
      focusKeyword: "",
      products,
    })).rejects.toThrow("no relevant catalog products");
  });
});

function configure() {
  process.env.NINE_ROUTER_BASE_URL = "http://127.0.0.1:20127/v1";
  process.env.NINE_ROUTER_API_KEY = "test-key";
  process.env.NINE_ROUTER_MODEL = "cx/test-model";
}

function makeProduct(id: string, title: string, description: string, tags: string[]): AiCatalogProduct {
  return {
    id,
    title,
    handle: title.toLowerCase().replace(/\s+/g, "-"),
    description,
    productType: "",
    vendor: "",
    tags,
    imageUrl: "",
    imageAlt: "",
    price: "10.00",
  };
}
