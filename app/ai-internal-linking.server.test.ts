import { afterEach, describe, expect, it, vi } from "vitest";
import { generateAiInternalLinkSuggestions } from "./ai-internal-linking.server";
import type { LinkArticle, LinkSuggestion } from "./internal-linking";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NINE_ROUTER_BASE_URL;
  delete process.env.NINE_ROUTER_API_KEY;
  delete process.env.NINE_ROUTER_MODEL;
  delete process.env.NINE_ROUTER_TIMEOUT_MS;
});

const articles: LinkArticle[] = [
  {
    id: "source",
    title: "Running shoe guide",
    handle: "running-shoe-guide",
    blogHandle: "news",
    body: "<p>Check our shoe sizing advice before choosing running shoes.</p>",
  },
  {
    id: "target",
    title: "Shoe sizing advice",
    handle: "shoe-sizing",
    blogHandle: "news",
    body: "<p>Measure both feet and compare the result with the size chart.</p>",
  },
];

const suggestions: LinkSuggestion[] = [{
  id: "source:target",
  sourceId: "source",
  sourceTitle: "Running shoe guide",
  targetId: "target",
  targetTitle: "Shoe sizing advice",
  targetUrl: "/blogs/news/shoe-sizing",
  anchorText: "shoe sizing advice",
  score: 32,
}];

describe("AI Internal Link Copilot", () => {
  it("accepts only known pairs and exact source anchors", async () => {
    configure();
    const fetchMock = vi.fn(async () => aiResponse({
      recommendations: [
        {
          suggestionId: "invented:article",
          relevanceScore: 99,
          explanation: "Invented destination.",
          anchorOptions: ["running shoes"],
          warnings: [],
        },
        {
          suggestionId: "source:target",
          relevanceScore: 86,
          explanation: "The sizing guide helps readers choose the right fit.",
          anchorOptions: ["shoe sizing advice", "phrase not in the source"],
          warnings: ["anchor_overuse", "invented_warning"],
        },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateAiInternalLinkSuggestions({ articles, suggestions });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "source:target",
      targetId: "target",
      targetUrl: "/blogs/news/shoe-sizing",
      anchorText: "shoe sizing advice",
      aiScore: 86,
      aiWarnings: ["anchor_overuse"],
      insertedInContext: true,
    });
    expect(result[0].anchorOptions).toEqual(["shoe sizing advice"]);
    expect(result[0].previewAfter).toContain('<a href="/blogs/news/shoe-sizing">shoe sizing advice</a>');
    const call = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    const request = JSON.parse(String(call[1]?.body));
    expect(request.stream).toBe(false);
    expect(request.response_format.type).toBe("json_schema");
  });

  it("rejects output when AI does not return an exact unlinked anchor", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => aiResponse({
      recommendations: [{
        suggestionId: "source:target",
        relevanceScore: 90,
        explanation: "Related subject.",
        anchorOptions: ["not present anywhere"],
        warnings: [],
      }],
    })));

    await expect(generateAiInternalLinkSuggestions({
      articles,
      suggestions: [{ ...suggestions[0], anchorText: "also missing" }],
    })).rejects.toThrow("no safe, context-matched");
  });

  it("extracts JSON from commentary and normalizes common model field names", async () => {
    configure();
    const fetchMock = vi.fn(async () => aiResponseContent(`Here is the review:
      {
        "suggestions": [{
          "suggestion_id": "source:target",
          "score": 88,
          "reason": "The sizing article answers the reader's next question.",
          "anchor_text": "shoe sizing advice",
          "flags": ["ambiguous_anchor"]
        }]
      }
      End of review.`));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateAiInternalLinkSuggestions({ articles, suggestions });
    expect(result[0]).toMatchObject({
      id: "source:target",
      aiScore: 88,
      aiExplanation: "The sizing article answers the reader's next question.",
      aiWarnings: ["ambiguous_anchor"],
      anchorText: "shoe sizing advice",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back when a model rejects JSON schema", async () => {
    configure();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unsupportedResponse("json_schema is unsupported"))
      .mockResolvedValueOnce(aiResponse(validRecommendation()));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateAiInternalLinkSuggestions({ articles, suggestions });
    expect(result[0].aiScore).toBe(86);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryRequest = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(retryRequest.response_format).toEqual({ type: "json_object" });
  });

  it("uses prompt-only JSON when response_format is unsupported", async () => {
    configure();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unsupportedResponse("response_format is unsupported"))
      .mockResolvedValueOnce(unsupportedResponse("response_format is unsupported"))
      .mockResolvedValueOnce(aiResponseContent(JSON.stringify([validRecommendation().recommendations[0]])));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateAiInternalLinkSuggestions({ articles, suggestions });
    expect(result[0].anchorText).toBe("shoe sizing advice");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const plainRequest = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(plainRequest.response_format).toBeUndefined();
  });

  it("repairs malformed recommendation containers after normal fallbacks", async () => {
    configure();
    const malformed = aiResponse({ result: "Use shoe sizing advice" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(malformed)
      .mockResolvedValueOnce(aiResponse({ result: "Still malformed" }))
      .mockResolvedValueOnce(aiResponse({ result: "Still malformed" }))
      .mockResolvedValueOnce(aiResponse(validRecommendation()));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateAiInternalLinkSuggestions({ articles, suggestions });
    expect(result[0].aiScore).toBe(86);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const repairRequest = JSON.parse(String(fetchMock.mock.calls[3][1]?.body));
    expect(repairRequest.messages[0].content).toContain("Repair your previous output");
  });
});

function configure() {
  process.env.NINE_ROUTER_BASE_URL = "http://127.0.0.1:20127/v1";
  process.env.NINE_ROUTER_API_KEY = "test-key";
  process.env.NINE_ROUTER_MODEL = "cx/test-model";
}

function aiResponse(content: unknown) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }],
  }), { status: 200 });
}

function aiResponseContent(content: string) {
  return new Response(JSON.stringify({
    choices: [{ message: { content } }],
  }), { status: 200 });
}

function unsupportedResponse(message: string) {
  return new Response(JSON.stringify({ error: { message } }), { status: 400 });
}

function validRecommendation() {
  return {
    recommendations: [{
      suggestionId: "source:target",
      relevanceScore: 86,
      explanation: "The sizing guide helps readers choose the right fit.",
      anchorOptions: ["shoe sizing advice"],
      warnings: [],
    }],
  };
}
