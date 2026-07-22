import { afterEach, describe, expect, it, vi } from "vitest";
import { generateAiBlogDraft, isAiWritingMode } from "./ai-blog.server";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NINE_ROUTER_BASE_URL;
  delete process.env.NINE_ROUTER_API_KEY;
  delete process.env.NINE_ROUTER_MODEL;
  delete process.env.NINE_ROUTER_TIMEOUT_MS;
});

describe("9Router blog writing assistant", () => {
  it("recognizes supported writing modes", () => {
    expect(isAiWritingMode("draft")).toBe(true);
    expect(isAiWritingMode("improve")).toBe(true);
    expect(isAiWritingMode("translate")).toBe(false);
  });

  it("generates a draft and preserves product block markers", async () => {
    configure();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        bodyHtml: "<p>Better introduction.</p>[[SBS_PRODUCTS:featured]]<h2>Buying tips</h2><p>Useful advice.</p>",
        excerpt: "A concise buying guide.",
        metaTitle: "Buying Guide",
        metaDescription: "Read this practical buying guide before choosing.",
      }) } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateAiBlogDraft({
      mode: "improve",
      title: "Buying Guide",
      body: "<p>Introduction.</p>[[SBS_PRODUCTS:featured]]",
      excerpt: "A guide.",
      focusKeyword: "buying guide",
      instruction: "Make it clearer.",
    });

    expect(result.bodyHtml).toContain("[[SBS_PRODUCTS:featured]]");
    expect(result.metaTitle).toBe("Buying Guide");
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.model).toBe("cx/test-model");
    expect(request.messages[1].content).toContain("Make it clearer.");
  });

  it("rejects output that removes an existing product block", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        bodyHtml: "<p>Rewritten without the block.</p>",
        excerpt: "Excerpt",
        metaTitle: "Title",
        metaDescription: "Description",
      }) } }],
    }), { status: 200 })));

    await expect(generateAiBlogDraft({
      mode: "shorten",
      title: "Title",
      body: "<p>Body</p>[[SBS_PRODUCTS]]",
      excerpt: "",
      focusKeyword: "",
      instruction: "",
    })).rejects.toThrow("preserve the article product blocks");
  });

  it("rejects unsafe markup", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        bodyHtml: "<p>Safe-looking text</p><script>alert(1)</script>",
        excerpt: "Excerpt",
        metaTitle: "Title",
        metaDescription: "Description",
      }) } }],
    }), { status: 200 })));

    await expect(generateAiBlogDraft({
      mode: "draft",
      title: "Title",
      body: "",
      excerpt: "",
      focusKeyword: "",
      instruction: "Write a draft.",
    })).rejects.toThrow("unsafe article markup");
  });
});

function configure() {
  process.env.NINE_ROUTER_BASE_URL = "http://127.0.0.1:20127/v1";
  process.env.NINE_ROUTER_API_KEY = "test-key";
  process.env.NINE_ROUTER_MODEL = "cx/test-model";
}
