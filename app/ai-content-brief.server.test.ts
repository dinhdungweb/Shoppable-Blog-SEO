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
    await expect(generateAiContentBrief(input())).rejects.toThrow("outline repair");
  });

  it("normalizes common outline formats returned by different models", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => response({
      title: "Running shoe sizing guide",
      searchIntent: "commercial",
      audience: "New runners",
      objective: "Help readers choose a size",
      contentAngle: "Fit-first buying guide",
      primaryKeyword: "running shoe sizing",
      secondaryKeywords: [],
      entities: [],
      outline: [
        "## Measure your feet — Explain the measurement process",
        { title: "Compare the size chart", description: "Help readers interpret measurements" },
        { type: "subsection", name: "Check toe room", goal: "Confirm a comfortable fit" },
      ],
      questions: [],
      internalLinks: [],
      productPlacements: [],
      cannibalizationRisks: [],
      sourceQueries: [],
    })));

    const brief = await generateAiContentBrief(input());
    expect(brief.outline).toEqual([
      { level: "h2", heading: "Measure your feet", purpose: "Explain the measurement process" },
      { level: "h2", heading: "Compare the size chart", purpose: "Help readers interpret measurements" },
      { level: "h3", heading: "Check toe room", purpose: "Confirm a comfortable fit" },
    ]);
  });

  it("normalizes outlines grouped under h2 and h3 keys", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => response({
      ...validBrief(),
      outline: {
        h2: ["Measure your feet"],
        h3: [{ title: "Compare both feet", description: "Use the larger measurement" }],
      },
    })));

    const brief = await generateAiContentBrief(input());
    expect(brief.outline).toEqual([
      { level: "h2", heading: "Measure your feet", purpose: "" },
      { level: "h3", heading: "Compare both feet", purpose: "Use the larger measurement" },
    ]);
  });

  it("falls back to JSON object mode when a model rejects JSON schema", async () => {
    configure();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "response_format json_schema is unsupported" } }), { status: 400 }))
      .mockResolvedValueOnce(response(validBrief()));
    vi.stubGlobal("fetch", fetchMock);

    const brief = await generateAiContentBrief(input());
    expect(brief.outline[0].heading).toBe("Measure your feet");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryRequest = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(retryRequest.response_format).toEqual({ type: "json_object" });
  });

  it("uses prompt-only JSON when a model rejects every response_format", async () => {
    configure();
    const unsupported = () => new Response(JSON.stringify({ error: { message: "response_format is unsupported" } }), { status: 400 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unsupported())
      .mockResolvedValueOnce(unsupported())
      .mockResolvedValueOnce(responseContent(`I followed the JSON instructions:
        ${JSON.stringify(validBrief())}
        End of response.`));
    vi.stubGlobal("fetch", fetchMock);

    const brief = await generateAiContentBrief(input());
    expect(brief.primaryKeyword).toBe("running shoe sizing");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const plainRequest = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(plainRequest.response_format).toBeUndefined();
  });

  it("repairs only the outline when full brief retries still omit it", async () => {
    configure();
    const invalid = { ...validBrief(), outline: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(invalid))
      .mockResolvedValueOnce(response(invalid))
      .mockResolvedValueOnce(responseContent('Here is the requested JSON: {"outline":["H2: Measure your feet — Explain the process","H3: Compare both feet"]}'));
    vi.stubGlobal("fetch", fetchMock);

    const brief = await generateAiContentBrief(input());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(brief.outline).toEqual([
      { level: "h2", heading: "Measure your feet", purpose: "Explain the process" },
      { level: "h3", heading: "Compare both feet", purpose: "" },
    ]);
    const repairRequest = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(repairRequest.messages[0].content).toContain("one key named outline");
  });

  it("retries with JSON object mode when the model ignores the schema and returns Markdown", async () => {
    configure();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseContent("### 1. SEO Content Brief\nThis is not JSON."))
      .mockResolvedValueOnce(response({
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
        internalLinks: [],
        productPlacements: [],
        cannibalizationRisks: [],
        sourceQueries: [],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const brief = await generateAiContentBrief(input());
    expect(brief.title).toBe("Running shoe sizing guide");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryRequest = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(retryRequest.response_format).toEqual({ type: "json_object" });
    expect(retryRequest.messages[0].content).toContain("structured-output retry");
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

function responseContent(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

function validBrief() {
  return {
    title: "Running shoe sizing guide",
    searchIntent: "commercial",
    audience: "New runners",
    objective: "Help readers choose a size",
    contentAngle: "Fit-first buying guide",
    primaryKeyword: "running shoe sizing",
    secondaryKeywords: ["running shoe size chart"],
    entities: ["foot measurement"],
    outline: [{ level: "h2", heading: "Measure your feet", purpose: "Explain the process" }],
    questions: [],
    internalLinks: [],
    productPlacements: [],
    cannibalizationRisks: [],
    sourceQueries: [],
  };
}
