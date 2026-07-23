import { afterEach, describe, expect, it, vi } from "vitest";
import { generateAiSeoFix, isManualOnlySeoIssue } from "./ai-seo-fix.server";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NINE_ROUTER_BASE_URL;
  delete process.env.NINE_ROUTER_API_KEY;
  delete process.env.NINE_ROUTER_MODEL;
  delete process.env.NINE_ROUTER_REASONING_EFFORT;
});

describe("AI SEO Fix Copilot", () => {
  it("returns reviewable fixes and preserves article assets", async () => {
    configure();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        summary: "Improved the opening and metadata.",
        changes: [
          {
            field: "body",
            after: '<p>A direct answer for readers.</p><img src="https://cdn.example.com/a.jpg" alt="Blue travel bag">[[SBS_PRODUCTS:featured]]',
            explanation: "Answers the reader sooner and adds useful alt text.",
            issueTypes: ["kw_early", "inline_images_missing_alt"],
          },
          {
            field: "metaTitle",
            after: "Travel Bag Buying Guide",
            explanation: "Uses the focus phrase naturally.",
            issueTypes: ["kw_title"],
          },
        ],
        manualActions: [],
      }) } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateAiSeoFix(baseInput());

    expect(result.changes.map((change) => change.field)).toEqual(["body", "metaTitle"]);
    expect(result.changes[0].after).toContain("[[SBS_PRODUCTS:featured]]");
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.stream).toBe(false);
    expect(request.response_format.type).toBe("json_schema");
    expect(request.response_format.json_schema.strict).toBe(true);
    expect(request.reasoning_effort).toBe("low");
    expect(request.temperature).toBeUndefined();
  });

  it("turns body changes that invent links into manual actions", async () => {
    configure();
    stubResult({
      summary: "Added a link.",
      changes: [{
        field: "body",
        after: '<p>Text <a href="https://invented.example">source</a></p><img src="https://cdn.example.com/a.jpg">[[SBS_PRODUCTS:featured]]',
        explanation: "Adds evidence.",
        issueTypes: ["kw_early"],
      }],
      manualActions: [],
    });

    const result = await generateAiSeoFix(baseInput());
    expect(result.changes).toEqual([]);
    expect(result.manualActions).toEqual([expect.objectContaining({ issueType: "kw_early" })]);
  });

  it("applies small exact body replacements without regenerating the article", async () => {
    configure();
    stubResult({
      summary: "Improved the introduction.",
      changes: [{
        field: "body",
        after: "",
        replacements: [{ find: "Original introduction.", replace: "A practical travel bag introduction." }],
        explanation: "Makes the topic clear early.",
        issueTypes: ["kw_early"],
      }],
      manualActions: [],
    });

    const result = await generateAiSeoFix(baseInput());

    expect(result.changes[0]).toEqual(expect.objectContaining({
      field: "body",
      after: '<p>A practical travel bag introduction.</p><img src="https://cdn.example.com/a.jpg">[[SBS_PRODUCTS:featured]]',
      replacements: [{ find: "Original introduction.", replace: "A practical travel bag introduction." }],
    }));
  });

  it("allows a paragraph fix when unchanged legacy inline styles already exist", async () => {
    configure();
    stubResult({
      summary: "Split the long paragraph for readability.",
      changes: [{
        field: "body",
        after: "",
        replacements: [{
          find: "First sentence. Second sentence.",
          replace: "First sentence.</p><p>Second sentence.",
        }],
        explanation: "Splits only the affected paragraph.",
        issueTypes: ["paragraph_length"],
      }],
      manualActions: [],
    });

    const result = await generateAiSeoFix({
      ...baseInput(),
      body: '<p style="text-align: left">First sentence. Second sentence.</p>',
      issues: [{
        type: "paragraph_length",
        label: "Paragraph Length",
        message: "1 paragraph is over 120 words.",
        severity: "warning",
        details: [{ index: 1, wordCount: 146, preview: "First sentence. Second sentence." }],
      }],
    });

    expect(result.changes[0]).toEqual(expect.objectContaining({
      field: "body",
      after: '<p style="text-align: left">First sentence.</p><p>Second sentence.</p>',
      replacements: [{
        find: "First sentence. Second sentence.",
        replace: "First sentence.</p><p>Second sentence.",
      }],
    }));
    expect(result.manualActions).toEqual([]);
  });

  it("still rejects a body fix that introduces a new inline style", async () => {
    configure();
    stubResult({
      summary: "Changed the paragraph.",
      changes: [{
        field: "body",
        after: "",
        replacements: [{ find: "<p>Original introduction.</p>", replace: '<p style="display:none">Changed.</p>' }],
        explanation: "Changes the paragraph.",
        issueTypes: ["kw_early"],
      }],
      manualActions: [],
    });

    const result = await generateAiSeoFix(baseInput());
    expect(result.changes).toEqual([]);
    expect(result.manualActions).toEqual([expect.objectContaining({ issueType: "kw_early" })]);
  });

  it("keeps valid metadata when an unsafe body change is rejected", async () => {
    configure();
    stubResult({
      summary: "Improved metadata.",
      changes: [
        {
          field: "body",
          after: '<p>Changed.</p><script>alert(1)</script><img src="https://cdn.example.com/a.jpg">[[SBS_PRODUCTS:featured]]',
          explanation: "Rewrites the body.",
          issueTypes: ["kw_early"],
        },
        {
          field: "metaTitle",
          after: "Travel Bag Guide and Tips",
          explanation: "Improves the title.",
          issueTypes: ["kw_title"],
        },
      ],
      manualActions: [],
    });

    const result = await generateAiSeoFix(baseInput());

    expect(result.changes).toEqual([expect.objectContaining({ field: "metaTitle", after: "Travel Bag Guide and Tips" })]);
  });

  it("keeps unsafe tasks as manual actions", async () => {
    configure();
    stubResult({
      summary: "One action needs your input.",
      changes: [{
        field: "body",
        after: "<p>Changed text.</p>",
        explanation: "Adds a source.",
        issueTypes: ["external_links"],
      }],
      manualActions: [],
    });

    const result = await generateAiSeoFix({
      ...baseInput(),
      body: "<p>Original text.</p>",
      issues: [{ type: "external_links", label: "External links", message: "Add one.", severity: "warning" }],
    });
    expect(result.changes).toEqual([]);
    expect(result.manualActions).toHaveLength(1);
    expect(isManualOnlySeoIssue("external_links")).toBe(true);
  });

  it("returns only safe public HTTPS source suggestions", async () => {
    configure();
    stubResult({
      summary: "Suggested sources are ready to review.",
      changes: [],
      manualActions: [{
        issueType: "external_links",
        explanation: "These sources may support the article.",
        action: "Open and verify a source before adding it.",
        suggestedLinks: [
          {
            url: "https://www.iso.org/standard/63500.html#details",
            title: "ISO standard",
            anchorText: "relevant ISO standard",
            reason: "Supports the standards claim.",
          },
          {
            url: "http://127.0.0.1/private",
            title: "Unsafe URL",
            anchorText: "private",
            reason: "Must be rejected.",
          },
        ],
      }],
    });

    const result = await generateAiSeoFix({
      ...baseInput(),
      issues: [{ type: "external_links", label: "External links", message: "Add one.", severity: "warning" }],
    });

    expect(result.manualActions[0]?.suggestedLinks).toEqual([expect.objectContaining({
      url: "https://www.iso.org/standard/63500.html",
      anchorText: "relevant ISO standard",
    })]);
  });

  it("generates only the article title for an inline title request", async () => {
    configure();
    stubResult({
      summary: "A title is ready to review.",
      changes: [
        {
          field: "title",
          after: "A Practical Guide to Travel Bags",
          replacements: [],
          explanation: "Describes the article clearly.",
          issueTypes: ["article_title"],
        },
        {
          field: "excerpt",
          after: "This unrelated field must be ignored.",
          replacements: [],
          explanation: "Not requested.",
          issueTypes: ["article_title"],
        },
      ],
      manualActions: [],
    });

    const result = await generateAiSeoFix({
      ...baseInput(),
      issues: [{ type: "article_title", label: "Article title", message: "Write a title.", severity: "warning" }],
    });

    expect(result.changes).toEqual([expect.objectContaining({
      field: "title",
      after: "A Practical Guide to Travel Bags",
    })]);
  });

  it("generates only the excerpt for an inline summary request", async () => {
    configure();
    stubResult({
      summary: "An excerpt is ready to review.",
      changes: [{
        field: "excerpt",
        after: "A concise guide to choosing a practical travel bag.",
        replacements: [],
        explanation: "Summarizes the supplied article.",
        issueTypes: ["excerpt_summary"],
      }],
      manualActions: [],
    });

    const result = await generateAiSeoFix({
      ...baseInput(),
      issues: [{ type: "excerpt_summary", label: "Excerpt", message: "Write a summary.", severity: "warning" }],
    });

    expect(result.changes).toEqual([expect.objectContaining({
      field: "excerpt",
      after: "A concise guide to choosing a practical travel bag.",
    })]);
  });

  it("turns output that removes product blocks into manual actions", async () => {
    configure();
    stubResult({
      summary: "Rewrote the opening.",
      changes: [{
        field: "body",
        after: '<p>Changed.</p><img src="https://cdn.example.com/a.jpg">',
        explanation: "Improves readability.",
        issueTypes: ["kw_early"],
      }],
      manualActions: [],
    });

    const result = await generateAiSeoFix(baseInput());
    expect(result.changes).toEqual([]);
    expect(result.manualActions).toEqual([expect.objectContaining({ issueType: "kw_early" })]);
  });
});

function baseInput() {
  return {
    title: "Travel bags",
    body: '<p>Original introduction.</p><img src="https://cdn.example.com/a.jpg">[[SBS_PRODUCTS:featured]]',
    excerpt: "A travel bag guide.",
    metaTitle: "Travel bags",
    metaDescription: "A travel bag guide.",
    featuredImageAlt: "Travel bag",
    hasFeaturedImage: true,
    focusKeyword: "travel bag",
    issues: [
      { type: "kw_early", label: "Keyword in introduction", message: "Add it early.", severity: "warning" as const },
      { type: "inline_images_missing_alt", label: "Inline alt", message: "Alt is missing.", severity: "warning" as const },
      { type: "kw_title", label: "Keyword in title", message: "Add it.", severity: "warning" as const },
    ],
  };
}

function configure() {
  process.env.NINE_ROUTER_BASE_URL = "http://127.0.0.1:20127/v1";
  process.env.NINE_ROUTER_API_KEY = "test-key";
  process.env.NINE_ROUTER_MODEL = "codex/gpt-5.5";
}

function stubResult(result: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(result) } }],
  }), { status: 200 })));
}
