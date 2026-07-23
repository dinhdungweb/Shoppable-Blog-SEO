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
