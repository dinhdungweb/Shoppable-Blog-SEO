import { afterEach, describe, expect, it, vi } from "vitest";
import { generateContentRefresh, isManualContentRefreshSignal } from "./ai-content-refresh.server";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NINE_ROUTER_BASE_URL;
  delete process.env.NINE_ROUTER_API_KEY;
  delete process.env.NINE_ROUTER_MODEL;
});

describe("AI Content Refresh Copilot", () => {
  it("uses Search Console signals and returns reviewable changes", async () => {
    configure();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({
      strategy: "Answer the high-impression query sooner.",
      changes: [
        { field: "title", after: "How to Choose a Travel Bag", explanation: "Matches reader intent.", signalIds: ["traffic"], queries: ["how to choose travel bag"] },
        { field: "body", after: '<p>Choose by trip length and carry needs.</p><a href="/collections/bags">See bags</a>[[SBS_PRODUCTS]]', explanation: "Gives a direct answer.", signalIds: ["traffic"], queries: ["how to choose travel bag"] },
      ],
      manualActions: [],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateContentRefresh(baseInput());
    expect(result.changes.map((change) => change.field)).toEqual(["title", "body"]);
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.reasoning_effort).toBe("low");
    expect(request.messages[1].content).toContain("how to choose travel bag");
  });

  it("moves a refresh that invents a link to manual review", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => response({
      strategy: "Add a source.",
      changes: [{ field: "body", after: '<p>Updated</p><a href="https://invented.example">Source</a>[[SBS_PRODUCTS]]', explanation: "Adds proof.", signalIds: ["traffic"], queries: [] }],
      manualActions: [],
    })));
    const result = await generateContentRefresh(baseInput());
    expect(result.changes).toEqual([]);
    expect(result.manualActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: "traffic", title: "Review article content manually" }),
    ]));
  });

  it("keeps unsafe decay signals manual and adds a stale fact checklist", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => response({ strategy: "Review manually.", changes: [], manualActions: [] })));
    const result = await generateContentRefresh({
      ...baseInput(),
      queries: [],
      signals: [
        { id: "broken", type: "broken_outbound", message: "Broken link", previousValue: "URL", currentValue: "Broken", recommendation: "Verify and replace it." },
        { id: "stale", type: "stale_content", message: "Old article", previousValue: "2024", currentValue: "700 days", recommendation: "Review facts." },
      ],
    });
    expect(result.manualActions.map((action) => action.sourceId)).toEqual(["broken", "stale"]);
    expect(isManualContentRefreshSignal("broken_outbound")).toBe(true);
  });

  it("moves a refresh that removes product blocks to manual review", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => response({
      strategy: "Rewrite.",
      changes: [{ field: "body", after: '<p>Updated</p><a href="/collections/bags">See bags</a>', explanation: "Improves clarity.", signalIds: ["traffic"], queries: [] }],
      manualActions: [],
    })));
    const result = await generateContentRefresh(baseInput());
    expect(result.changes).toEqual([]);
    expect(result.manualActions.map((action) => action.sourceId)).toEqual(expect.arrayContaining(["traffic"]));
  });

  it("moves an unverified year update to manual review", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => response({
      strategy: "Update the title.",
      changes: [{ field: "title", after: "Best Travel Bags 2026", explanation: "Looks current.", signalIds: ["old-year"], queries: ["travel bags"] }],
      manualActions: [],
    })));
    const result = await generateContentRefresh({
      ...baseInput(),
      title: "Best Travel Bags 2025",
      signals: [{ id: "old-year", type: "outdated_year", message: "Older year", previousValue: "2025", currentValue: "2026", recommendation: "Verify the content first." }],
      queries: [{ ...baseInput().queries[0], query: "travel bags" }],
    });
    expect(result.changes).toEqual([]);
    expect(result.manualActions.map((action) => action.sourceId)).toEqual(expect.arrayContaining(["old-year", "travel bags"]));
  });

  it("keeps safe metadata when an invalid body changes image alt text", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => response({
      strategy: "Refresh the article.",
      changes: [
        { field: "metaTitle", after: "Travel Bag Guide for Better Trips", explanation: "Improves relevance.", signalIds: ["traffic"], queries: [] },
        { field: "body", after: '<p>Updated.</p><img src="/bag.jpg" alt="Changed alt"><a href="/collections/bags">See bags</a>[[SBS_PRODUCTS]]', explanation: "Updates content.", signalIds: ["traffic"], queries: [] },
      ],
      manualActions: [],
    })));
    const result = await generateContentRefresh({
      ...baseInput(),
      body: '<p>Original.</p><img src="/bag.jpg" alt="Travel bag"><a href="/collections/bags">See bags</a>[[SBS_PRODUCTS]]',
    });
    expect(result.changes).toEqual([expect.objectContaining({ field: "metaTitle" })]);
    expect(result.manualActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: "traffic" }),
    ]));
  });
});

function baseInput() {
  return {
    title: "Travel bags",
    body: '<p>Original.</p><a href="/collections/bags">See bags</a>[[SBS_PRODUCTS]]',
    excerpt: "Travel bag guide.",
    metaTitle: "Travel bags",
    metaDescription: "Travel bag guide.",
    focusKeyword: "travel bag",
    signals: [{ id: "traffic", type: "traffic_decline", message: "Clicks declined", previousValue: "20", currentValue: "10", recommendation: "Refresh useful sections." }],
    queries: [{ query: "how to choose travel bag", clicks: 2, impressions: 300, ctr: 0.0067, position: 8, previousClicks: 10, previousImpressions: 250, previousCtr: 0.04, previousPosition: 6 }],
  };
}

function configure() {
  process.env.NINE_ROUTER_BASE_URL = "http://127.0.0.1:20127/v1";
  process.env.NINE_ROUTER_API_KEY = "test-key";
  process.env.NINE_ROUTER_MODEL = "codex/gpt-5.5";
}

function response(content: unknown) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
}
