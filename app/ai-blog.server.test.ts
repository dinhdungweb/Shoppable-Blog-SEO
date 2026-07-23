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
        title: "Practical Buying Guide",
        bodyHtml: "<p>Better introduction.</p>[[SBS_PRODUCTS:featured]]<h2>Buying tips</h2><p>Useful advice.</p>",
        excerpt: "A concise buying guide.",
        metaTitle: "Buying Guide",
        metaDescription: "Read this practical buying guide before choosing.",
        suggestedLinks: [],
      }) } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateAiBlogDraft({
      mode: "improve",
      title: "Buying Guide",
      body: "<p>Introduction.</p>[[SBS_PRODUCTS:featured]]",
      excerpt: "A guide.",
      primaryKeyword: "buying guide",
      secondaryKeywords: ["buying tips"],
      instruction: "Make it clearer.",
    });

    expect(result.bodyHtml).toContain("[[SBS_PRODUCTS:featured]]");
    expect(result.metaTitle).toBe("Buying Guide");
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.model).toBe("cx/test-model");
    expect(request.messages[1].content).toContain("Make it clearer.");
    expect(request.messages[1].content).toContain("buying tips");
    expect(request.response_format.type).toBe("json_schema");
  });

  it("rejects output that removes an existing product block", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        title: "Title",
        bodyHtml: "<p>Rewritten without the block.</p>",
        excerpt: "Excerpt",
        metaTitle: "Title",
        metaDescription: "Description",
        suggestedLinks: [],
      }) } }],
    }), { status: 200 })));

    await expect(generateAiBlogDraft({
      mode: "shorten",
      title: "Title",
      body: "<p>Body</p>[[SBS_PRODUCTS]]",
      excerpt: "",
      primaryKeyword: "title",
      secondaryKeywords: [],
      instruction: "",
    })).rejects.toThrow("preserve the article product blocks");
  });

  it("restores the exact app-managed FAQ after a writing revision", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        title: "Title",
        bodyHtml: "<p>Improved article body.</p>",
        excerpt: "Excerpt",
        metaTitle: "Title",
        metaDescription: "Description",
        suggestedLinks: [],
      }) } }],
    }), { status: 200 })));
    const faq = '<section id="sbs-faq" class="sbs-faq"><h2 class="sbs-faq__title">FAQ</h2><details class="sbs-faq__item"><summary class="sbs-faq__question">Question?</summary><p class="sbs-faq__answer">Article-backed answer.</p></details></section>';
    const result = await generateAiBlogDraft({
      mode: "improve",
      title: "Title",
      body: `<p>Original body.</p>${faq}`,
      excerpt: "",
      primaryKeyword: "title",
      secondaryKeywords: [],
      instruction: "",
    });
    expect(result.bodyHtml).toContain("<p>Improved article body.</p>");
    expect(result.bodyHtml.endsWith(faq)).toBe(true);
  });

  it("removes unsupported product-title markers invented by the model", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        title: "Draft",
        bodyHtml: "<p>Useful copy.</p>[[SBS_PRODUCTS:Ontario Lotus Silver]]",
        excerpt: "Useful copy.",
        metaTitle: "Draft",
        metaDescription: "Useful copy.",
        suggestedLinks: [],
      }) } }],
    }), { status: 200 })));

    const result = await generateAiBlogDraft({
      mode: "draft",
      title: "Draft",
      body: "",
      excerpt: "",
      primaryKeyword: "silver ring",
      secondaryKeywords: [],
      instruction: "Write the article.",
    });

    expect(result.bodyHtml).toBe("<p>Useful copy.</p>");
  });

  it("rejects unsafe markup", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        title: "Title",
        bodyHtml: "<p>Safe-looking text</p><script>alert(1)</script>",
        excerpt: "Excerpt",
        metaTitle: "Title",
        metaDescription: "Description",
        suggestedLinks: [],
      }) } }],
    }), { status: 200 })));

    await expect(generateAiBlogDraft({
      mode: "draft",
      title: "Title",
      body: "",
      excerpt: "",
      primaryKeyword: "title",
      secondaryKeywords: [],
      instruction: "Write a draft.",
    })).rejects.toThrow("unsafe article markup");
  });

  it("keeps only public HTTPS source suggestions", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        title: "Travel Bag Guide",
        bodyHtml: "<p>Useful guidance.</p>",
        excerpt: "A concise guide.",
        metaTitle: "Travel Bag Guide",
        metaDescription: "Practical guidance for choosing a travel bag.",
        suggestedLinks: [
          { url: "https://www.iata.org/en/programs/ops-infra/baggage/", title: "IATA baggage guidance", anchorText: "baggage guidance", reason: "Authoritative travel guidance." },
          { url: "http://127.0.0.1/private", title: "Private", anchorText: "private", reason: "Unsafe." },
        ],
      }) } }],
    }), { status: 200 })));

    const result = await generateAiBlogDraft({
      mode: "draft",
      title: "",
      body: "",
      excerpt: "",
      primaryKeyword: "travel bag",
      secondaryKeywords: ["carry-on bag"],
      instruction: "",
    });

    expect(result.title).toBe("Travel Bag Guide");
    expect(result.suggestedLinks).toEqual([
      expect.objectContaining({ url: "https://www.iata.org/en/programs/ops-infra/baggage/" }),
    ]);
  });

  it("restores existing href values when AI changes their destinations", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        title: "Buying Guide",
        bodyHtml: '<p>Read our <a href="https://changed.example/path">size guide</a>.</p>',
        excerpt: "A useful buying guide.",
        metaTitle: "Buying Guide",
        metaDescription: "Read this practical buying guide.",
        suggestedLinks: [],
      }) } }],
    }), { status: 200 })));

    const result = await generateAiBlogDraft({
      mode: "improve",
      title: "Buying Guide",
      body: '<p>Read our <a href="/pages/size-guide">size guide</a>.</p>',
      excerpt: "A guide.",
      primaryKeyword: "buying guide",
      secondaryKeywords: [],
      instruction: "Improve the article.",
    });

    expect(result.bodyHtml).toContain('href="/pages/size-guide"');
    expect(result.bodyHtml).not.toContain("changed.example");
  });

  it("rejects output that removes an existing article link", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        title: "Buying Guide",
        bodyHtml: "<p>The size guide was removed.</p>",
        excerpt: "A useful buying guide.",
        metaTitle: "Buying Guide",
        metaDescription: "Read this practical buying guide.",
        suggestedLinks: [],
      }) } }],
    }), { status: 200 })));

    await expect(generateAiBlogDraft({
      mode: "improve",
      title: "Buying Guide",
      body: '<p>Read our <a href="/pages/size-guide">size guide</a>.</p>',
      excerpt: "A guide.",
      primaryKeyword: "buying guide",
      secondaryKeywords: [],
      instruction: "Improve the article.",
    })).rejects.toThrow("preserve the article links");
  });
});

function configure() {
  process.env.NINE_ROUTER_BASE_URL = "http://127.0.0.1:20127/v1";
  process.env.NINE_ROUTER_API_KEY = "test-key";
  process.env.NINE_ROUTER_MODEL = "cx/test-model";
}
