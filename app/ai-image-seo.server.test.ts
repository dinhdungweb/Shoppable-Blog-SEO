import { afterEach, describe, expect, it, vi } from "vitest";
import { generateAiImageAltSuggestions } from "./ai-image-seo.server";
import type { ImageSeoCandidate } from "./image-seo";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NINE_ROUTER_BASE_URL;
  delete process.env.NINE_ROUTER_API_KEY;
  delete process.env.NINE_ROUTER_MODEL;
});

describe("AI Image SEO", () => {
  it("keeps only supplied IDs, validates natural alt text and empties decorative alt", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ suggestions: [
        { id: "article|inline|0", altText: "Carry-on travel bag beside a suitcase", reason: "Describes the useful product context." },
        { id: "article|inline|1", altText: "", reason: "The divider is decorative." },
        { id: "invented", altText: "Invented image", reason: "Invalid." },
      ] }) } }],
    }), { status: 200 })));

    const suggestions = await generateAiImageAltSuggestions({ candidates: candidates() });
    expect(suggestions).toEqual([
      expect.objectContaining({ id: "article|inline|0", altText: "Carry-on travel bag beside a suitcase", issues: ["missing_alt"] }),
      expect.objectContaining({ id: "article|inline|1", altText: "", issues: ["decorative_alt"] }),
    ]);
  });

  it("rejects output that remains keyword stuffed", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ suggestions: [
        { id: "article|inline|0", altText: "bag bag bag bag bag", reason: "Bad output." },
      ] }) } }],
    }), { status: 200 })));
    await expect(generateAiImageAltSuggestions({ candidates: candidates().slice(0, 1) })).rejects.toThrow("no usable");
  });

  it("falls back to JSON object mode when the model rejects JSON schema", async () => {
    configure();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: "json_schema is unsupported" },
      }), { status: 400 }))
      .mockResolvedValueOnce(aiResponse({
        suggestions: [
          { id: "article|inline|0", altText: "Carry-on travel bag beside a suitcase", reason: "Describes the useful context." },
        ],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const suggestions = await generateAiImageAltSuggestions({ candidates: candidates().slice(0, 1) });

    expect(suggestions).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(retryRequest.response_format).toEqual({ type: "json_object" });
  });

  it("uses prompt-only JSON and extracts an object from commentary", async () => {
    configure();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: "response_format is unsupported" },
      }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: "response_format is unsupported" },
      }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: [
          { type: "text", text: "Here is the result:\n" },
          { type: "text", text: '{"results":[{"image_id":"article|inline|0","alt_text":"Carry-on travel bag beside a suitcase","explanation":"Useful context."}]}\nDone.' },
        ] } }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const suggestions = await generateAiImageAltSuggestions({ candidates: candidates().slice(0, 1) });

    expect(suggestions[0]).toEqual(expect.objectContaining({
      id: "article|inline|0",
      altText: "Carry-on travel bag beside a suitcase",
    }));
    const plainRequest = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(plainRequest.response_format).toBeUndefined();
  });

  it("reports a clear error after every JSON mode returns invalid content", async () => {
    configure();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "This is not JSON." } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateAiImageAltSuggestions({ candidates: candidates().slice(0, 1) }))
      .rejects.toThrow("after JSON fallback");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

function aiResponse(content: unknown) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }],
  }), { status: 200 });
}

function configure() {
  process.env.NINE_ROUTER_BASE_URL = "http://127.0.0.1:20127/v1";
  process.env.NINE_ROUTER_API_KEY = "test";
  process.env.NINE_ROUTER_MODEL = "cx/test";
}

function candidates(): ImageSeoCandidate[] {
  return [
    {
      id: "article|inline|0", articleId: "article", articleTitle: "Travel bag guide", kind: "inline", index: 0,
      src: "https://cdn.shopify.com/bag.jpg", currentAlt: "", decorative: false, issues: ["missing_alt"],
      context: "Compare a carry-on travel bag beside a suitcase.", bodyHash: "hash",
    },
    {
      id: "article|inline|1", articleId: "article", articleTitle: "Travel bag guide", kind: "inline", index: 1,
      src: "https://cdn.shopify.com/divider.png", currentAlt: "Divider", decorative: true, issues: ["decorative_alt"],
      context: "A decorative section divider.", bodyHash: "hash",
    },
  ];
}
