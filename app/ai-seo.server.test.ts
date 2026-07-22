import { afterEach, describe, expect, it, vi } from "vitest";
import { generateAiSeoSuggestion, isNineRouterConfigured } from "./ai-seo.server";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NINE_ROUTER_BASE_URL;
  delete process.env.NINE_ROUTER_API_KEY;
  delete process.env.NINE_ROUTER_MODEL;
  delete process.env.NINE_ROUTER_TIMEOUT_MS;
});

describe("9Router SEO suggestions", () => {
  it("detects a complete server configuration", () => {
    expect(isNineRouterConfigured()).toBe(false);
    configure();
    expect(isNineRouterConfigured()).toBe(true);
  });

  it("calls the OpenAI-compatible endpoint and parses JSON", async () => {
    configure();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: "```json\n{\"metaTitle\":\"Summer Shoes\",\"metaDescription\":\"Shop lightweight summer shoes for everyday comfort.\",\"imageAlt\":\"White summer shoes\"}\n```" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateAiSeoSuggestion({
      id: "gid://shopify/Article/1",
      title: "Summer Shoes",
      summary: "A seasonal guide",
      body: "<p>Choose lightweight shoes &amp; stay comfortable.</p>",
      hasImage: true,
    });

    expect(result).toEqual({
      id: "gid://shopify/Article/1",
      metaTitle: "Summer Shoes",
      metaDescription: "Shop lightweight summer shoes for everyday comfort.",
      imageAlt: "White summer shoes",
    });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:20128/v1/chat/completions", expect.objectContaining({ method: "POST" }));
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.model).toBe("combo/seo");
    expect(request.messages[1].content).toContain("Choose lightweight shoes & stay comfortable.");
  });

  it("rejects output that exceeds Shopify field limits", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ metaTitle: "x".repeat(71), metaDescription: "Valid description", imageAlt: "" }) } }],
    }), { status: 200 })));

    await expect(generateAiSeoSuggestion({ id: "1", title: "Title", summary: "", body: "", hasImage: false }))
      .rejects.toThrow("over the allowed length");
  });
});

function configure() {
  process.env.NINE_ROUTER_BASE_URL = "http://127.0.0.1:20128/v1/";
  process.env.NINE_ROUTER_API_KEY = "test-key";
  process.env.NINE_ROUTER_MODEL = "combo/seo";
}
