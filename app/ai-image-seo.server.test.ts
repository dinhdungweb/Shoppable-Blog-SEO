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
});

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
