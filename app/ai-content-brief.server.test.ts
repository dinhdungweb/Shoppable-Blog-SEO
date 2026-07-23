import { afterEach, describe, expect, it, vi } from "vitest";
import { contentBriefDraftInstruction, generateAiContentBrief } from "./ai-content-brief.server";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NINE_ROUTER_BASE_URL;
  delete process.env.NINE_ROUTER_API_KEY;
  delete process.env.NINE_ROUTER_MODEL;
});

describe("AI Content Brief & Keyword Cluster", () => {
  it("keeps only real Shopify resources and real Search Console rows", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => response({
      title: "Running shoe sizing guide",
      searchIntent: "commercial",
      audience: "New runners",
      objective: "Help readers choose a size",
      contentAngle: "Fit-first buying guide",
      primaryKeyword: "running shoe sizing",
      secondaryKeywords: ["running shoe size chart"],
      entities: ["foot measurement"],
      outline: [{ level: "h2", heading: "Measure your feet", purpose: "Explain the process" }],
      questions: ["Should running shoes be larger?"],
      internalLinks: [
        { articleId: "article-1", anchorIdea: "shoe fit guide", reason: "Adds measurement detail" },
        { articleId: "invented", anchorIdea: "fake", reason: "Fake" },
      ],
      productPlacements: [{ productId: "product-1", section: "Compare fit", reason: "Real shoe example" }],
      cannibalizationRisks: [{ articleId: "article-1", reason: "Similar intent", action: "Differentiate" }],
      sourceQueries: [
        { query: "running shoe size", rationale: "Real demand" },
        { query: "invented query", rationale: "Fake" },
      ],
    })));

    const brief = await generateAiContentBrief(input());
    expect(brief.internalLinks).toEqual([expect.objectContaining({ articleId: "article-1", targetUrl: "/blogs/news/fit-guide" })]);
    expect(brief.productPlacements).toEqual([expect.objectContaining({ productId: "product-1", productUrl: "/products/road-shoe" })]);
    expect(brief.sourceQueries).toHaveLength(1);
    expect(brief.sourceQueries[0]).toMatchObject({ query: "running shoe size", impressions: 100 });
    expect(contentBriefDraftInstruction(brief)).toContain("Measure your feet");
  });

  it("rejects a brief without a usable outline", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => response({
      title: "Guide", searchIntent: "informational", audience: "", objective: "", contentAngle: "",
      primaryKeyword: "running shoes", secondaryKeywords: [], entities: [], outline: [],
      questions: [], internalLinks: [], productPlacements: [], cannibalizationRisks: [], sourceQueries: [],
    })));
    await expect(generateAiContentBrief(input())).rejects.toThrow("no usable content outline");
  });
});

function configure() {
  process.env.NINE_ROUTER_BASE_URL = "http://127.0.0.1:20127/v1";
  process.env.NINE_ROUTER_API_KEY = "test-key";
  process.env.NINE_ROUTER_MODEL = "cx/test-model";
}

function input() {
  return {
    title: "Running shoe sizing guide",
    seedKeyword: "running shoe sizing",
    audience: "New runners",
    objective: "Help choose a size",
    sourceArticleId: "",
    context: {
      articles: [{ id: "article-1", title: "Shoe fit guide", handle: "fit-guide", blogHandle: "news", body: "<p>Measure both feet.</p>", focusKeyword: "shoe fit" }],
      products: [{ id: "product-1", title: "Road shoe", handle: "road-shoe", description: "Road running shoe", productType: "Shoes", vendor: "Store" }],
      queries: [{ pageUrl: "/blogs/news/fit-guide", query: "running shoe size", clicks: 10, impressions: 100, ctr: 0.1, position: 6 }],
    },
  };
}

function response(content: unknown) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
}
